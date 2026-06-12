// SessionForge Browser — preload bridge.
//
// Runs in an isolated context with access to Node + Electron's ipcRenderer.
// Exposes a tiny `window.api` surface to the renderer so the rest of the UI
// can stay sandboxed.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listSessions:  ()           => ipcRenderer.invoke("sessions:list"),
  saveSessions:  (sessions)   => ipcRenderer.invoke("sessions:save", sessions),
  clearSession:  (id)         => ipcRenderer.invoke("sessions:clear", id),

  // Automation
  saveScreenshot:   (pngBase64) => ipcRenderer.invoke("automation:save-screenshot", pngBase64),
  savePdf:          (pdfBase64) => ipcRenderer.invoke("automation:save-pdf", pdfBase64),
  listScripts:      ()            => ipcRenderer.invoke("automation:list-scripts"),
  saveScript:       (scriptData)  => ipcRenderer.invoke("automation:save-script", scriptData),
  deleteScript:     (filename)    => ipcRenderer.invoke("automation:delete-script", filename),
  sendInput:        (webContentsId, inputEvent) => ipcRenderer.invoke("automation:send-input", webContentsId, inputEvent),
  insertText:       (webContentsId, text) => ipcRenderer.invoke("automation:insert-text", webContentsId, text),
});
