// SessionForge Browser — Electron main process.
//
// Responsibilities:
//   - create the main window
//   - persist the list of "sessions" (named identities) to disk
//   - expose IPC handlers consumed by the renderer via preload.js
//
// Each session in the renderer becomes a `partition="persist:<id>"` on a
// <webview> element. Electron stores that partition's cookies + storage under
// userData/Partitions/<id>, which gives us full isolation between sessions
// even when they're loading the same URL.

const { app, BrowserWindow, ipcMain, session, dialog, Menu } = require("electron");
const path = require("node:path");
const fs   = require("node:fs");

// Make the dock tooltip and menu show "SessionForge" instead of "Electron".
// Must be called before app is ready.
app.setName("SessionForge");
// setName() also changes userData to ~/Library/Application Support/SessionForge.
// Pin it back to the original path so existing identities + partitions survive
// the rename.
app.setPath("userData", path.join(app.getPath("appData"), "sessionforge-browser"));

// ─── Persistence ──────────────────────────────────────────────────────────
// We store only the *metadata* of sessions (id, name, colour). The actual
// cookies/storage live inside Electron's per-partition cache directory and
// are managed by Chromium itself.

const sessionsFile = () => path.join(app.getPath("userData"), "sessions.json");

function loadSessions() {
  try {
    return JSON.parse(fs.readFileSync(sessionsFile(), "utf8"));
  } catch {
    // First run — seed with a single default identity.
    const seed = [
      { id: "default", name: "Default", color: "#6ea8ff" },
    ];
    saveSessions(seed);
    return seed;
  }
}

function saveSessions(sessions) {
  fs.mkdirSync(path.dirname(sessionsFile()), { recursive: true });
  fs.writeFileSync(sessionsFile(), JSON.stringify(sessions, null, 2));
}

// ─── Window ───────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width:  1280,
    height: 800,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f1115",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
      webviewTag:       true,    // we use <webview partition="persist:..."> tags
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Surface renderer errors in the terminal so a blank window has something
  // to debug against. Auto-open DevTools when SFOX_DEVTOOLS=1.
  win.webContents.on("console-message", (_e, level, message, line, source) => {
    console.log(`[renderer ${["log","warn","error"][level] || level}] ${source}:${line} — ${message}`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.log(`[renderer did-fail-load] ${code} ${desc} url=${url}`);
  });
  if (process.env.SFOX_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

// ─── IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle("sessions:list",   ()             => loadSessions());
ipcMain.handle("sessions:save",   (_e, sessions) => { saveSessions(sessions); return true; });

// Wipe an identity's cookies + storage. Called when the renderer deletes a
// session from the sidebar. Without this, the partition would linger on disk.
ipcMain.handle("sessions:clear", async (_e, id) => {
  const part = session.fromPartition(`persist:${id}`);
  await part.clearStorageData();
  return true;
});

// ─── Bookmarks (per-identity) ────────────────────────────────────────────
const bookmarksFile = () => path.join(app.getPath("userData"), "bookmarks.json");

function loadBookmarks() {
  try { return JSON.parse(fs.readFileSync(bookmarksFile(), "utf8")); }
  catch { return {}; }
}
function saveBookmarks(data) {
  fs.writeFileSync(bookmarksFile(), JSON.stringify(data, null, 2));
}

ipcMain.handle("bookmarks:get", (_e, sessionId) => {
  const all = loadBookmarks();
  return all[sessionId] || [];
});

ipcMain.handle("bookmarks:add", (_e, sessionId, bookmark) => {
  const all = loadBookmarks();
  if (!all[sessionId]) all[sessionId] = [];
  bookmark.id = Date.now().toString(36);
  bookmark.created = new Date().toISOString();
  all[sessionId].push(bookmark);
  saveBookmarks(all);
  return bookmark;
});

ipcMain.handle("bookmarks:remove", (_e, sessionId, bookmarkId) => {
  const all = loadBookmarks();
  if (all[sessionId]) {
    all[sessionId] = all[sessionId].filter(b => b.id !== bookmarkId);
    saveBookmarks(all);
  }
  return true;
});

ipcMain.handle("bookmarks:all", () => loadBookmarks());

// ─── Per-identity history ────────────────────────────────────────────────
const historyFile = () => path.join(app.getPath("userData"), "history.json");

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(historyFile(), "utf8")); }
  catch { return {}; }
}
function saveHistory(data) {
  fs.writeFileSync(historyFile(), JSON.stringify(data, null, 2));
}

ipcMain.handle("history:add", (_e, sessionId, entry) => {
  const all = loadHistory();
  if (!all[sessionId]) all[sessionId] = [];
  entry.timestamp = new Date().toISOString();
  all[sessionId].unshift(entry);
  if (all[sessionId].length > 500) all[sessionId] = all[sessionId].slice(0, 500);
  saveHistory(all);
  return true;
});

ipcMain.handle("history:get", (_e, sessionId) => {
  const all = loadHistory();
  return all[sessionId] || [];
});

ipcMain.handle("history:clear", (_e, sessionId) => {
  const all = loadHistory();
  all[sessionId] = [];
  saveHistory(all);
  return true;
});

// ─── Export / Import identity ────────────────────────────────────────────
ipcMain.handle("identity:export", async (_e, sessionId) => {
  const win = BrowserWindow.getFocusedWindow();
  const sessions = loadSessions();
  const identity = sessions.find(s => s.id === sessionId);
  if (!identity) return null;

  const bookmarks = loadBookmarks()[sessionId] || [];
  const history = loadHistory()[sessionId] || [];

  const part = session.fromPartition(`persist:${sessionId}`);
  const cookies = await part.cookies.get({});

  const bundle = { identity, bookmarks, history, cookies };

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Export Identity",
    defaultPath: `${identity.name.replace(/[^a-z0-9]/gi, "_")}-identity.json`,
    filters: [{ name: "SessionForge Identity", extensions: ["json"] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2));
  return filePath;
});

ipcMain.handle("identity:import", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Import Identity",
    filters: [{ name: "SessionForge Identity", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths.length) return null;

  const raw = JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
  if (!raw.identity) return null;

  const newId = raw.identity.id + "_" + Date.now().toString(36).slice(-4);
  const newIdentity = { ...raw.identity, id: newId, name: raw.identity.name + " (imported)" };

  // Save identity
  const sessions = loadSessions();
  sessions.push(newIdentity);
  saveSessions(sessions);

  // Restore bookmarks
  if (raw.bookmarks?.length) {
    const allBm = loadBookmarks();
    allBm[newId] = raw.bookmarks;
    saveBookmarks(allBm);
  }

  // Restore history
  if (raw.history?.length) {
    const allHist = loadHistory();
    allHist[newId] = raw.history;
    saveHistory(allHist);
  }

  // Restore cookies
  if (raw.cookies?.length) {
    const part = session.fromPartition(`persist:${newId}`);
    for (const cookie of raw.cookies) {
      try {
        const url = `http${cookie.secure ? "s" : ""}://${cookie.domain?.replace(/^\./, "")}${cookie.path || "/"}`;
        await part.cookies.set({ ...cookie, url });
      } catch { /* skip invalid cookies */ }
    }
  }

  return newIdentity;
});

// ─── Automation: input simulation via webContents ────────────────────────
// The renderer can't directly call sendInputEvent on a webview's guest
// webContents. We route it through IPC using the webContents ID.
ipcMain.handle("automation:send-input", (_e, webContentsId, inputEvent) => {
  const { webContents } = require("electron");
  const wc = webContents.fromId(webContentsId);
  if (!wc) return false;
  wc.sendInputEvent(inputEvent);
  return true;
});

// Insert text into the focused element of a webview's guest page.
ipcMain.handle("automation:insert-text", async (_e, webContentsId, text) => {
  const { webContents } = require("electron");
  const wc = webContents.fromId(webContentsId);
  if (!wc) return false;
  await wc.insertText(text);
  return true;
});

// ─── Automation IPC ──────────────────────────────────────────────────────
// Save a screenshot (NativeImage buffer) to disk via a save dialog.
ipcMain.handle("automation:save-screenshot", async (_e, pngBase64) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Save Screenshot",
    defaultPath: `screenshot-${Date.now()}.png`,
    filters: [{ name: "PNG Image", extensions: ["png"] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, Buffer.from(pngBase64, "base64"));
  return filePath;
});

// Save a PDF (from printToPDF) to disk via a save dialog.
ipcMain.handle("automation:save-pdf", async (_e, pdfBase64) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Save Page as PDF",
    defaultPath: `page-${Date.now()}.pdf`,
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, Buffer.from(pdfBase64, "base64"));
  return filePath;
});

// Save/load automation scripts to/from disk.
const automationsDir = () => path.join(app.getPath("userData"), "automations");

ipcMain.handle("automation:list-scripts", () => {
  const dir = automationsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      return { filename: f, ...raw };
    } catch { return null; }
  }).filter(Boolean);
});

ipcMain.handle("automation:save-script", (_e, scriptData) => {
  const dir = automationsDir();
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const data = {
    name: scriptData.name || "Untitled",
    description: scriptData.description || "",
    website: scriptData.website || "",
    created: scriptData.created || now,
    modified: now,
    steps: scriptData.steps || [],
  };
  const filename = (scriptData.filename) ||
    (data.name.replace(/[^a-z0-9_-]/gi, "_") + ".json");
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
  return filename;
});

ipcMain.handle("automation:delete-script", (_e, filename) => {
  const filepath = path.join(automationsDir(), filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  return true;
});

// ─── Native menu bar ─────────────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{
      label: "SessionForge",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Tab", accelerator: "CmdOrCtrl+T", click: () => sendToRenderer("menu:new-tab") },
        { label: "New Identity", accelerator: "CmdOrCtrl+N", click: () => sendToRenderer("menu:new-identity") },
        { type: "separator" },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => sendToRenderer("menu:close-tab") },
        { type: "separator" },
        ...(isMac ? [] : [{ role: "quit" }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "Find…", accelerator: "CmdOrCtrl+F", click: () => sendToRenderer("menu:find") },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Reload Page", accelerator: "CmdOrCtrl+R", click: () => sendToRenderer("menu:reload") },
        { type: "separator" },
        { role: "togglefullscreen" },
        { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+B", click: () => sendToRenderer("menu:toggle-sidebar") },
        { label: "Toggle DevTools", accelerator: "CmdOrCtrl+Shift+I", role: "toggleDevTools" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sendToRenderer(channel) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send(channel);
}

// ─── App lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Replace the Electron-default dock icon with ours (macOS only).
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "assets", "icon.png"));
  }
  buildMenu();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
