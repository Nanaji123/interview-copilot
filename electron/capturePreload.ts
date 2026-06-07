import { contextBridge, ipcRenderer } from "electron";

/**
 * Capture Window Preload Script
 * This runs in the hidden capture window that handles audio capture
 * since the main window has contentProtection enabled which blocks desktopCapturer
 */

contextBridge.exposeInMainWorld("captureAPI", {
  // Get screen sources for audio capture
  getScreenSources: () => ipcRenderer.invoke("get-screen-sources"),

  // Send audio data to main process for relay to main window
  sendAudioData: (data: ArrayBuffer) => {
    ipcRenderer.send("audio:data", data);
  },

  // Notify main process that capture has started
  notifyCaptureStarted: () => {
    ipcRenderer.send("audio:capture-started");
  },

  // Notify main process that capture has stopped
  notifyCaptureStopped: () => {
    ipcRenderer.send("audio:capture-stopped");
  },

  // Notify main process that capture is auto-restarting
  notifyCaptureRestarting: (attempt: number, maxRetries: number) => {
    ipcRenderer.send("audio:capture-restarting", attempt, maxRetries);
  },

  // Notify main process of capture error
  notifyCaptureError: (error: string) => {
    ipcRenderer.send("audio:capture-error", error);
  },

  // Listen for start capture command
  onStartCapture: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("audio:start-capture", listener);
    return () => ipcRenderer.removeListener("audio:start-capture", listener);
  },

  // Listen for stop capture command
  onStopCapture: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("audio:stop-capture", listener);
    return () => ipcRenderer.removeListener("audio:stop-capture", listener);
  },
});
