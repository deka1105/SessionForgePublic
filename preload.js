// SessionForge Browser — preload bridge.
//
// Runs in an isolated context with access to Node + Electron's ipcRenderer.
// Exposes a tiny `window.api` surface to the renderer so the rest of the UI
// can stay sandboxed.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onMenu: (channel, callback) => ipcRenderer.on(channel, callback),
  listSessions:  ()           => ipcRenderer.invoke("sessions:list"),
  saveSessions:  (sessions)   => ipcRenderer.invoke("sessions:save", sessions),
  clearSession:  (id)         => ipcRenderer.invoke("sessions:clear", id),

  // Bookmarks
  getBookmarks:     (sessionId) => ipcRenderer.invoke("bookmarks:get", sessionId),
  addBookmark:      (sessionId, bm) => ipcRenderer.invoke("bookmarks:add", sessionId, bm),
  removeBookmark:   (sessionId, id) => ipcRenderer.invoke("bookmarks:remove", sessionId, id),
  getAllBookmarks:   ()          => ipcRenderer.invoke("bookmarks:all"),

  // History
  addHistory:       (sessionId, entry) => ipcRenderer.invoke("history:add", sessionId, entry),
  getHistory:       (sessionId) => ipcRenderer.invoke("history:get", sessionId),
  clearHistory:     (sessionId) => ipcRenderer.invoke("history:clear", sessionId),

  // Export / Import
  exportIdentity:   (sessionId) => ipcRenderer.invoke("identity:export", sessionId),
  importIdentity:   ()          => ipcRenderer.invoke("identity:import"),

  // Automation
  saveScreenshot:   (pngBase64) => ipcRenderer.invoke("automation:save-screenshot", pngBase64),
  savePdf:          (pdfBase64) => ipcRenderer.invoke("automation:save-pdf", pdfBase64),
  listScripts:      ()            => ipcRenderer.invoke("automation:list-scripts"),
  saveScript:       (scriptData)  => ipcRenderer.invoke("automation:save-script", scriptData),
  deleteScript:     (filename)    => ipcRenderer.invoke("automation:delete-script", filename),
  sendInput:        (webContentsId, inputEvent) => ipcRenderer.invoke("automation:send-input", webContentsId, inputEvent),
  insertText:       (webContentsId, text) => ipcRenderer.invoke("automation:insert-text", webContentsId, text),
});
