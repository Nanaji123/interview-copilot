import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  systemPreferences,
} from "electron";
import path, { join } from "path";
import { autoUpdater } from "electron-updater";
import { createTray } from "./tray";
import { applyContentProtection } from "./windowProtection";

let win: BrowserWindow | null = null;
let captureWin: BrowserWindow | null = null;
const PROTOCOL = "coprep";

const EVENTS = {
  SESSION_START: "session:start",
  SCREEN_PERMISSION_STATUS: "screen:permission:status",
  ANALYZE_SCREEN_SHORTCUT: "shortcut:analyze-screen",
};

function checkScreenSharingPermissionStatus(): boolean {
  // Screen sharing permissions are mainly required on macOS
  if (process.platform !== "darwin") {
    return true; // Other platforms don't require explicit screen sharing permissions
  }

  try {
    // Check if we already have screen recording permission
    const hasPermission =
      systemPreferences.getMediaAccessStatus("screen") === "granted";
    console.log(
      "[CoPrep] Screen sharing permission status:",
      hasPermission ? "granted" : "not granted",
    );
    return hasPermission;
  } catch (error) {
    console.error("[CoPrep] Error checking screen sharing permission:", error);
    return false;
  }
}

async function checkAndRequestScreenSharingPermission(): Promise<boolean> {
  // Screen sharing permissions are mainly required on macOS
  if (process.platform !== "darwin") {
    return true; // Other platforms don't require explicit screen sharing permissions
  }

  try {
    // Check if we already have screen recording permission
    const hasPermission =
      systemPreferences.getMediaAccessStatus("screen") === "granted";

    if (hasPermission) {
      console.log("[CoPrep] Screen sharing permission already granted");
      return true;
    }

    console.log(
      "[CoPrep] Screen sharing permission not granted, requesting...",
    );

    // On macOS, screen recording permission is cached at process launch.
    // Even after the user grants permission in System Settings, the running
    // process will still see "denied" until the app is restarted.
    // Strategy:
    //   1. Try desktopCapturer.getSources() to trigger the initial system prompt
    //   2. Open System Settings directly to Screen Recording pane
    //   3. Show a dialog telling the user to grant permission and restart
    try {
      // Attempt to get screen sources — this triggers the initial macOS
      // permission prompt the very first time, and is a no-op afterwards
      await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 1, height: 1 },
      });
    } catch (triggerError) {
      console.log(
        "[CoPrep] desktopCapturer.getSources() threw (expected when permission not yet granted):",
        triggerError,
      );
    }

    // Re-check after the trigger attempt
    const permissionAfterAttempt =
      systemPreferences.getMediaAccessStatus("screen");

    if (permissionAfterAttempt === "granted") {
      console.log("[CoPrep] Screen sharing permission granted");
      return true;
    }

    // Permission still not granted — the user either hasn't toggled it on yet,
    // or they have but macOS requires an app restart for it to take effect.
    // Open System Settings to the Screen Recording pane so the user can act.
    console.log(
      "[CoPrep] Opening System Settings > Screen Recording for user...",
    );
    shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );

    // Import dialog at the top level would be cleaner, but we keep it here to
    // minimise changes to existing imports.
    const { dialog } = require("electron") as typeof import("electron");

    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "Screen Recording Permission Required",
      message:
        "CoPrep needs Screen Recording permission to capture your screen.\n\n" +
        "1. In the System Settings window that just opened, find \"CoPrep\" (or \"Electron\") and toggle it ON.\n" +
        "2. macOS requires you to restart the app after granting this permission.\n\n" +
        "Click \"Restart Now\" to restart CoPrep, or \"Later\" to continue without screen capture.",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      // Restart the app so the new permission takes effect
      console.log("[CoPrep] User chose to restart for screen permission");
      app.relaunch();
      app.exit(0);
    }

    console.log("[CoPrep] Screen sharing permission not yet effective (needs restart)");
    return false;
  } catch (error) {
    console.error("[CoPrep] Error checking screen sharing permission:", error);
    return false;
  }
}

/**
 * Creates a hidden capture window for audio capture.
 * This window runs without contentProtection, allowing desktopCapturer API to work.
 * Audio data is relayed to the main window via IPC.
 */
function createCaptureWindow() {
  // Guard: ensure app is ready before creating windows
  if (!app.isReady()) {
    console.warn(
      "[CoPrep] createCaptureWindow called before app is ready, deferring...",
    );
    app.whenReady().then(() => createCaptureWindow());
    return;
  }

  if (captureWin) {
    console.log("[CoPrep] Capture window already exists");
    return;
  }

  // Use the main window's session if available, so they share screen recording permissions
  const sessionToUse = win?.webContents?.session;

  captureWin = new BrowserWindow({
    width: 1,
    height: 1,
    x: -100, // Off-screen
    y: -100,
    show: false,
    frame: false,
    skipTaskbar: true, // Hide from Windows taskbar
    hiddenInMissionControl: true,
    webPreferences: {
      preload: path.join(__dirname, "capturePreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Required for desktop capture
      sandbox: false,
      // Share session with main window for permission sharing
      ...(sessionToUse && { session: sessionToUse }),
    },
  });

  // contentProtection is NOT set here - this is intentional!
  // This window needs to access desktopCapturer API

  // Set up permission handlers for media access
  captureWin.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      if (permission === "media" || permission === "mediaKeySystem") {
        callback(true);
      } else {
        callback(false);
      }
    },
  );

  captureWin.webContents.session.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      if (permission === "media" || permission === "mediaKeySystem") {
        return true;
      }
      return false;
    },
  );

  // Handle display media requests for the capture window
  captureWin.webContents.session.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen", "window"] })
        .then((sources) => {
          if (sources.length > 0) {
            // Request loopback anywhere Electron/Chromium supports it.
            // On unsupported platforms the returned stream may simply omit audio;
            // capture.html handles that without falling back to the mic.
            if (process.platform === "linux") {
              callback({ video: sources[0] });
            } else {
              callback({ video: sources[0], audio: "loopback" });
            }
          } else {
            callback({});
          }
        });
    },
  );

  // Load the capture page
  // In dev: __dirname is /path/to/project/dist/electron (compiled)
  // In prod: __dirname is /path/to/app.asar/dist/electron
  // Both cases: capture.html is at ../renderer/capture.html relative to __dirname
  const captureHtmlPath = path.join(
    __dirname,
    "..",
    "renderer",
    "capture.html",
  );
  console.log("[CoPrep] Loading capture.html from:", captureHtmlPath);

  // Forward console messages from capture window to main process
  captureWin.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      const levelMap: { [key: number]: string } = {
        0: "DEBUG",
        1: "INFO",
        2: "WARNING",
        3: "ERROR",
      };
      console.log(`[CaptureWindow] [${levelMap[level] || level}] ${message}`);
    },
  );

  // Log any load errors
  captureWin.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDesc, validatedURL) => {
      console.error(
        "[CoPrep] Capture window failed to load:",
        errorCode,
        errorDesc,
        validatedURL,
      );
    },
  );

  captureWin.loadFile(captureHtmlPath);

  captureWin.on("closed", () => {
    captureWin = null;
  });

  console.log("[CoPrep] Capture window created");
}

function createWindow() {
  // Guard: screen module can only be used after app is ready
  if (!app.isReady()) {
    console.warn(
      "[CoPrep] createWindow called before app is ready, deferring...",
    );
    app.whenReady().then(() => createWindow());
    return;
  }

  const display = screen.getPrimaryDisplay();
  const screenBounds = display.bounds;
  const winWidth = 800;
  const winHeight = Math.floor(screenBounds.height * 0.8);
  const x = Math.round(screenBounds.x + (screenBounds.width - winWidth) / 2);
  const y = screenBounds.y;

  win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x,
    y,
    frame: false, // remove title bar and window controls
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false, // Prevent the window from stealing focus when clicked
    show: false, // Don't show until ready-to-show
    hiddenInMissionControl: true,
    transparent: true,
    backgroundColor: "#00000000",
    icon: path.join(
      __dirname,
      "..",
      "..",
      "assets",
      process.platform === "darwin" ? "logo.icns" : "logo.ico",
    ),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Disabled to allow desktop capturer API
      sandbox: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  // Security: Show window only when ready
  win.once("ready-to-show", () => {
    win?.show();
  });

  // Security: Prevent new window creation and control external navigation
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow specific trusted domains
    const allowedDomains = [
      "https://coprep.ai",
      "https://www.coprep.ai",
      "https://aicoprepare.vercel.app",
      "https://aicoprepare-backend.onrender.com",
      "http://localhost:5173",
      "http://localhost:5174",
    ];

    if (allowedDomains.some((domain) => url.startsWith(domain))) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Security: Block navigation to external sites
  win.webContents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const allowedOrigins = [
      "http://localhost:5173",
      "http://localhost:5174",
      "file://",
      "https://coprep.ai",
      "https://www.coprep.ai",
      "https://aicoprepare.vercel.app",
      "https://aicoprepare-backend.onrender.com",
    ];

    if (!allowedOrigins.some((origin) => navigationUrl.startsWith(origin))) {
      event.preventDefault();
    }
  });

  // Constrain resizing: allow width changes, lock height
  win.setMinimumSize(400, winHeight);
  win.setMaximumSize(10000, winHeight);

  // keep window on top of others
  win.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin") {
    win.setHiddenInMissionControl(true);
  }

  // Make window visible on all workspaces/Spaces (including fullscreen apps on macOS)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Prevent the window from appearing in screenshots and screen sharing
  // On Windows: uses WDA_EXCLUDEFROMCAPTURE via native call (fully invisible)
  // On macOS: uses Electron's built-in setContentProtection
  // Audio capture is handled by a separate hidden window without content protection
  applyContentProtection(win);

  // Hide from taskbar on Windows/Linux
  if (process.platform !== "darwin") {
    win.setSkipTaskbar(true);
  }

  // Set up CSP headers
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self' http://localhost:* blob: filesystem:;" +
          "connect-src 'self' https://coprep.ai https://www.coprep.ai https://aicoprepare-backend.onrender.com wss://aicoprepare-backend.onrender.com http://localhost:* ws://localhost:* wss://localhost:* blob: filesystem: wss://api.deepgram.com;" +
          "media-src 'self' http://localhost:* blob: filesystem:;" +
          "img-src 'self' blob: data: filesystem:;" +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval';" +
          "style-src 'self' 'unsafe-inline';" +
          "worker-src 'self' blob:;",
        ],
      },
    });
  });

  // Set up permission handlers for media access (required for getUserMedia with desktop capturer)
  win.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      // Allow media permissions (microphone, camera, desktop audio)
      if (permission === "media" || permission === "mediaKeySystem") {
        callback(true);
      } else {
        callback(false);
      }
    },
  );

  // Handle permission check requests
  win.webContents.session.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      // Allow media permissions from our app
      if (permission === "media" || permission === "mediaKeySystem") {
        return true;
      }
      return false;
    },
  );

  // Handle display media (screen capture) requests
  // This is required for getDisplayMedia on the capture/main window
  win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ["screen", "window"] })
      .then((sources) => {
        if (sources.length > 0) {
          // Request loopback anywhere Electron/Chromium supports it.
          // On unsupported platforms the returned stream may simply omit audio;
          // capture.html handles that without falling back to the mic.
          if (process.platform === "linux") {
            callback({ video: sources[0] });
          } else {
            callback({ video: sources[0], audio: "loopback" });
          }
        } else {
          callback({});
        }
      });
  });

  // Load from Vite dev server in development, or built files in production
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools(); // Open DevTools in dev mode for debugging
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  win.on("closed", () => {
    win = null;
  });

  // Send initial screen permission status when window is ready
  win.webContents.once("did-finish-load", () => {
    const hasScreenPermission = checkScreenSharingPermissionStatus();
    win?.webContents.send(EVENTS.SCREEN_PERMISSION_STATUS, hasScreenPermission);
  });

  // Forward console messages from main window to main process
  win.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      const levelMap: { [key: number]: string } = {
        0: "DEBUG",
        1: "INFO",
        2: "WARNING",
        3: "ERROR",
      };
      console.log(`[MainWindow] [${levelMap[level] || level}] ${message}`);
    },
  );
}

function handleDeepLink(rawUrl: string) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== `${PROTOCOL}:`) return;
    const isStart =
      u.host === "start" || u.pathname.replace(/^\/+/, "") === "start";
    if (!isStart) return;
    const token = u.searchParams.get("token");
    const userId = u.searchParams.get("userId");
    const sessionParam = u.searchParams.get("session");
    const credits = u.searchParams.get("credits");
    let session: any = undefined;
    if (sessionParam) {
      try {
        // Value may already be percent-encoded by URLSearchParams
        const decoded = decodeURIComponent(sessionParam);
        session = JSON.parse(decoded);
      } catch (e) {
        // Fallback: try raw JSON parse if not double-encoded
        try {
          session = JSON.parse(sessionParam);
        } catch {
          session = undefined;
        }
      }
    }

    // Log received deep link data to the main process console
    console.log("[CoPrep] Deep link received:", {
      userId,
      token: token ? `${token.slice(0, 6)}…` : undefined,
      credits: credits,
      sessionPreview:
        session && typeof session === "object"
          ? {
            keys: Object.keys(session),
            values: Object.values(session),
            size: JSON.stringify(session).length,
          }
          : undefined,
    });

    const payload = {
      token: token ?? undefined,
      userId: userId ?? undefined,
      session: session ?? undefined,
      credits: credits ? parseInt(credits, 10) : 0,
    } as const;
    if (!win) createWindow();
    win?.show();

    // Immediately hide dock icon again
    if (process.platform === "darwin" && app.dock) {
      app.dock.hide();
    }

    win?.webContents.send(EVENTS.SESSION_START, payload);
  } catch (e) {
    console.error("Deep link parse error", e);
  }
}

function toggleWindowVisibility() {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
  }
}

function moveWindow(deltaX: number, deltaY: number = 0) {
  if (!win) return;
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);

  // Horizontal bounds
  const minX = display.workArea.x;
  const maxX = display.workArea.x + display.workArea.width - bounds.width;
  const nextX = Math.max(minX, Math.min(bounds.x + deltaX, maxX));

  // Vertical bounds
  const minY = display.workArea.y;
  const maxY = display.workArea.y + display.workArea.height - bounds.height;
  const nextY = Math.max(minY, Math.min(bounds.y + deltaY, maxY));

  win.setPosition(nextX, nextY);
}

function registerShortcuts() {
  // Toggle show/hide
  globalShortcut.register("CommandOrControl+Shift+H", () => {
    toggleWindowVisibility();
  });
  // Analyze the screen during an active session
  globalShortcut.register("CommandOrControl+Shift+A", () => {
    if (!win) {
      createWindow();
      return;
    }
    if (!win.isVisible()) {
      win.show();
    }
    win.webContents.send(EVENTS.ANALYZE_SCREEN_SHORTCUT);
  });
  // Move left/right/up/down
  globalShortcut.register("Alt+Left", () => moveWindow(-20, 0));
  globalShortcut.register("Alt+Right", () => moveWindow(20, 0));
  globalShortcut.register("Alt+Up", () => moveWindow(0, -20));
  globalShortcut.register("Alt+Down", () => moveWindow(0, 20));
}

function registerIpcHandlers() {
  // IPC: End/quit the app
  ipcMain.on("app:end", () => {
    app.quit();
  });

  // IPC: Toggle click-through mode (ignore mouse events) while keeping
  // forward:true so scroll events are still received by the renderer
  // even when the window is in click-through mode.
  ipcMain.on(
    "set-ignore-mouse-events",
    (_event, ignore: boolean, options?: { forward?: boolean }) => {
      if (!win) return;
      win.setIgnoreMouseEvents(ignore, { forward: options?.forward ?? true });
    },
  );

  // IPC: Open external links via main for reliability
  ipcMain.on("open-external", (_e, url: string) => {
    if (!url || typeof url !== "string") return;
    shell.openExternal(url, { activate: true }).catch((err) => {
      console.error("openExternal failed:", err);
    });
  });

  // IPC: Check screen sharing permission status
  ipcMain.handle("check-screen-permission", () => {
    return checkScreenSharingPermissionStatus();
  });

  // IPC: Request screen sharing permission
  ipcMain.handle("request-screen-permission", async () => {
    const result = await checkAndRequestScreenSharingPermission();
    // Send updated permission status to renderer
    if (win) {
      win.webContents.send(EVENTS.SCREEN_PERMISSION_STATUS, result);
    }
    return result;
  });

  // IPC: Get screen sources for screen capture
  ipcMain.handle("get-screen-sources", async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: { width: 1, height: 1 }, // Minimal thumbnail to reduce IPC message size
      });
      // Return only essential fields to avoid IPC message size issues
      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        display_id: source.display_id,
      }));
    } catch (error) {
      console.error("Failed to get screen sources:", error);
      return [];
    }
  });

  // IPC: Auto-updater handlers
  ipcMain.handle("check-for-updates", () => {
    return autoUpdater.checkForUpdatesAndNotify();
  });

  ipcMain.handle("quit-and-install", () => {
    autoUpdater.quitAndInstall();
  });

  // IPC: App control handlers
  ipcMain.handle("app:get-version", () => {
    return app.getVersion();
  });

  ipcMain.handle("app:minimize-to-tray", () => {
    if (win) {
      win.hide();
    }
  });

  ipcMain.handle("app:show", () => {
    if (win) {
      win.show();
    }
  });

  // Register screen capture handler
  //   registerScreenCaptureHandler();

  // ============================================
  // Audio Capture IPC Handlers (Dual-Window Architecture)
  // ============================================

  // IPC: Start audio capture via hidden capture window
  ipcMain.handle("audio:start-capture", async () => {
    console.log("[CoPrep] audio:start-capture IPC received");

    try {
      if (!captureWin) {
        console.log("[CoPrep] Creating capture window...");
        createCaptureWindow();

        // Wait for capture window to be created and load
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Capture window creation timeout"));
          }, 10000);

          const checkWindow = () => {
            if (captureWin) {
              captureWin.webContents.once("did-finish-load", () => {
                clearTimeout(timeout);
                console.log("[CoPrep] Capture window loaded");
                resolve();
              });

              captureWin.webContents.once(
                "did-fail-load",
                (_event, errorCode, errorDesc) => {
                  clearTimeout(timeout);
                  console.error(
                    "[CoPrep] Capture window failed to load:",
                    errorCode,
                    errorDesc,
                  );
                  reject(new Error(`Failed to load: ${errorDesc}`));
                },
              );
            } else {
              // Window not created yet, check again
              setTimeout(checkWindow, 100);
            }
          };
          checkWindow();
        });
      }

      if (captureWin) {
        console.log("[CoPrep] Sending start-capture to capture window");
        captureWin.webContents.send("audio:start-capture");
        return true;
      } else {
        console.error("[CoPrep] Capture window not available after creation");
        return false;
      }
    } catch (error) {
      console.error("[CoPrep] Failed to start audio capture:", error);
      return false;
    }
  });

  // IPC: Stop audio capture
  ipcMain.handle("audio:stop-capture", async () => {
    console.log("[CoPrep] Stopping audio capture...");
    if (captureWin) {
      captureWin.webContents.send("audio:stop-capture");
    }
    return true;
  });

  // IPC: Relay audio data from capture window to main window
  ipcMain.on("audio:data", (_event, data: ArrayBuffer) => {
    if (win) {
      win.webContents.send("audio:data-to-renderer", data);
    }
  });

  // IPC: Relay capture started event
  ipcMain.on("audio:capture-started", () => {
    console.log("[CoPrep] Audio capture started");
    if (win) {
      win.webContents.send("audio:capture-started");
    }
  });

  // IPC: Relay capture stopped event
  ipcMain.on("audio:capture-stopped", () => {
    console.log("[CoPrep] Audio capture stopped");
    if (win) {
      win.webContents.send("audio:capture-stopped");
    }
    // Destroy capture window so a fresh one is created on next capture start
    if (captureWin) {
      captureWin.close();
      captureWin = null;
    }
  });

  // IPC: Relay capture restarting event (auto-recovery in progress)
  ipcMain.on(
    "audio:capture-restarting",
    (_event, attempt: number, maxRetries: number) => {
      console.log(
        `[CoPrep] Audio capture restarting (attempt ${attempt}/${maxRetries})...`,
      );
      if (win) {
        win.webContents.send("audio:capture-restarting", attempt, maxRetries);
      }
    },
  );

  // IPC: Relay capture error event
  ipcMain.on("audio:capture-error", (_event, error: string) => {
    console.error("[CoPrep] Audio capture error:", error);
    if (win) {
      win.webContents.send("audio:capture-error", error);
    }
  });
}

// Ensure single instance to funnel deep links
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const linkArg = argv.find((a) => a.startsWith?.(`${PROTOCOL}://`));
    if (linkArg) handleDeepLink(linkArg);
    if (win) {
      win.show();
    }
  });
}

// On Windows, use targeted GPU flags instead of blanket disableHardwareAcceleration
// (disabling HW accel can degrade DWM compositing and content protection)
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

// Electron/Chromium 39+ defaults macOS 14.2+ desktop audio capture to the
// CoreAudio Tap API, which requires NSAudioCaptureUsageDescription on the
// launched parent app in dev. Keep the older Screen & System Audio Recording
// path so local dev and packaged builds use the same permission surface.
if (process.platform === "darwin") {
  app.commandLine.appendSwitch(
    "disable-features",
    "MacCatapLoopbackAudioForScreenShare",
  );
}

app.setName("CoPrep AI");
// Rename the process title shown in Activity Monitor / Task Manager
// to something generic so it is less conspicuous.
process.title = "System Audio Host";

// Hide Dock icon as early as possible (synchronously, before whenReady).
// This prevents any flash of the Dock icon in dev mode.
// Production builds use LSUIElement=true in Info.plist (electron-builder.json)
// which achieves the same at the OS level without requiring this call.
if (process.platform === "darwin" && app.dock) {
  app.dock.hide();
}

// Wire up lifecycle - use whenReady() instead of ready event
app.whenReady().then(async () => {
  // Auto-updater setup
  autoUpdater.autoDownload = true;

  autoUpdater.on("update-available", () => {
    win?.webContents.send("update-available");
  });
  autoUpdater.on("update-not-available", () => {
    win?.webContents.send("update-not-available");
  });
  autoUpdater.on("download-progress", (progressObj) => {
    win?.webContents.send("download-progress", progressObj);
  });
  autoUpdater.on("update-downloaded", () => {
    win?.webContents.send("update-downloaded");
  });
  autoUpdater.on("error", (err) => {
    win?.webContents.send(
      "update-error",
      err == null ? "unknown" : err.message || err.toString(),
    );
  });

  autoUpdater.checkForUpdatesAndNotify();

  // Hide dock icon immediately on macOS so the app never appears
  // in the Dock or Cmd+Tab switcher, even briefly at launch.
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide();
    try {
      // In dev mode, __dirname is dist/electron, so we need ../../assets
      // In prod mode, it might be different but catch handles it
      try {
        app.dock.setIcon(join(__dirname, "..", "..", "assets", "logo.icns"));
      } catch {
        app.dock.setIcon(join(__dirname, "..", "assets", "logo.icns"));
      }
    } catch (error) {
      console.log("Could not set dock icon:", error);
    }
  }

  try {
    if (!app.isPackaged) {
      // In dev mode, register protocol with the path to electron binary + project dir
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        path.resolve(process.cwd()),
      ]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }
  } catch { }

  // Register all IPC handlers
  registerIpcHandlers();

  createWindow();
  createTray(() => win);
  registerShortcuts();

  // Dev convenience: if URL passed as argv
  const argUrl = process.argv.find((a) => a.startsWith?.(`${PROTOCOL}://`));
  if (argUrl) handleDeepLink(argUrl);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("will-quit", () => {
  if (app.isReady()) {
    globalShortcut.unregisterAll();
  }
});

// macOS deep link
app.on("open-url", (e, urlStr) => {
  e.preventDefault();
  handleDeepLink(urlStr);
});
