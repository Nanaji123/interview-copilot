import { clipboard, contextBridge, ipcRenderer } from "electron";

// Security: Validate URLs before opening externally
function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const allowedDomains = ["coprep.ai", "api.coprep.ai", "localhost", "aicoprepare.vercel.app", "aicoprepare-backend.onrender.com"];
    return allowedDomains.some(
      (domain) =>
        parsedUrl.hostname === domain ||
        parsedUrl.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

// Security: Only expose necessary APIs
contextBridge.exposeInMainWorld("coprep", {
  // Version and app info
  getVersion: () => ipcRenderer.invoke("app:get-version"),

  // Screen permission functions
  checkScreenPermission: () => ipcRenderer.invoke("check-screen-permission"),
  requestScreenPermission: () =>
    ipcRenderer.invoke("request-screen-permission"),

  // Secure external URL opening
  openExternal: (url: string) => {
    if (typeof url === "string" && isValidUrl(url)) {
      ipcRenderer.send("open-external", url);
    } else {
      console.warn("[CoPrep] Blocked external URL:", url);
    }
  },

  // Screen capture functions
  getScreenSources: () => ipcRenderer.invoke("get-screen-sources"),

  // App control
  minimizeToTray: () => ipcRenderer.invoke("app:minimize-to-tray"),
  showApp: () => ipcRenderer.invoke("app:show"),
  quitApp: () => ipcRenderer.send("app:end"),
  copyTextToClipboard: (text: string) => {
    if (typeof text === "string") {
      clipboard.writeText(text);
    }
  },

  // Click-through with scroll: when ignore=true the window passes clicks
  // through to apps below but still forwards pointer events (forward:true)
  // so scroll events on panels still work.
  setIgnoreMouseEvents: (ignore: boolean) =>
    ipcRenderer.send("set-ignore-mouse-events", ignore, { forward: true }),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),

  // Event listeners with cleanup
  onScreenPermissionStatus: (callback: (hasPermission: boolean) => void) => {
    const listener = (_event: any, hasPermission: boolean) =>
      callback(hasPermission);
    ipcRenderer.on("screen:permission:status", listener);
    return () =>
      ipcRenderer.removeListener("screen:permission:status", listener);
  },

  onSessionStart: (callback: (payload: any) => void) => {
    const listener = (_event: any, payload: any) => callback(payload);
    ipcRenderer.on("session:start", listener);
    return () => ipcRenderer.removeListener("session:start", listener);
  },

  onAnalyzeScreenShortcut: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:analyze-screen", listener);
    return () =>
      ipcRenderer.removeListener("shortcut:analyze-screen", listener);
  },

  // Auto-updater events
  onUpdateAvailable: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("update-available", listener);
    return () => ipcRenderer.removeListener("update-available", listener);
  },

  onUpdateDownloaded: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("update-downloaded", listener);
    return () => ipcRenderer.removeListener("update-downloaded", listener);
  },

  onUpdateProgress: (callback: (progress: any) => void) => {
    const listener = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on("download-progress", listener);
    return () => ipcRenderer.removeListener("download-progress", listener);
  },

  // Audio capture controls (uses hidden capture window)
  startAudioCapture: () => ipcRenderer.invoke("audio:start-capture"),
  stopAudioCapture: () => ipcRenderer.invoke("audio:stop-capture"),

  // Audio data from capture window
  onAudioData: (callback: (data: ArrayBuffer) => void) => {
    const listener = (_event: any, data: ArrayBuffer) => callback(data);
    ipcRenderer.on("audio:data-to-renderer", listener);
    return () => ipcRenderer.removeListener("audio:data-to-renderer", listener);
  },

  // Audio capture status events
  onAudioCaptureStarted: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("audio:capture-started", listener);
    return () => ipcRenderer.removeListener("audio:capture-started", listener);
  },

  onAudioCaptureStopped: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("audio:capture-stopped", listener);
    return () => ipcRenderer.removeListener("audio:capture-stopped", listener);
  },

  onAudioCaptureError: (callback: (error: string) => void) => {
    const listener = (_event: any, error: string) => callback(error);
    ipcRenderer.on("audio:capture-error", listener);
    return () => ipcRenderer.removeListener("audio:capture-error", listener);
  },
});

// Security: Remove any potential node access
delete (window as any).require;
delete (window as any).exports;
delete (window as any).module;
delete (window as any).global;
