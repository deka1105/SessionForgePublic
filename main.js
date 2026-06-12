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

const { app, BrowserWindow, ipcMain, session, dialog } = require("electron");
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
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return { filename: f, ...raw };
  });
});

ipcMain.handle("automation:save-script", (_e, name, steps) => {
  const dir = automationsDir();
  fs.mkdirSync(dir, { recursive: true });
  const filename = name.replace(/[^a-z0-9_-]/gi, "_") + ".json";
  fs.writeFileSync(path.join(dir, filename), JSON.stringify({ name, steps }, null, 2));
  return filename;
});

ipcMain.handle("automation:delete-script", (_e, filename) => {
  const filepath = path.join(automationsDir(), filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  return true;
});

// ─── App lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Replace the Electron-default dock icon with ours (macOS only).
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "assets", "icon.png"));
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
