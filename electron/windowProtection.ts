import { BrowserWindow } from "electron";

/**
 * Windows Content Protection Utility
 *
 * Electron's setContentProtection(true) uses WDA_MONITOR (Chromium upstream decision),
 * which makes the window appear as a BLACK RECTANGLE during screen capture.
 *
 * This module calls SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) directly
 * via user32.dll using koffi, which makes the window FULLY INVISIBLE during capture.
 *
 * Falls back to Electron's setContentProtection on non-Windows platforms or
 * if the native call fails (e.g., older Windows versions).
 */

// WDA constants from Windows SDK
const WDA_EXCLUDEFROMCAPTURE = 0x00000011;

/**
 * Apply content protection to a BrowserWindow.
 * On Windows 10 2004+: uses WDA_EXCLUDEFROMCAPTURE (fully invisible from capture)
 * On macOS: uses Electron's setContentProtection (works natively)
 * On other platforms: uses Electron's setContentProtection as fallback
 */
export function applyContentProtection(win: BrowserWindow): void {
  if (process.platform === "win32") {
    try {
      // Dynamic import to avoid loading koffi on non-Windows platforms
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const koffi = require("koffi");

      const user32 = koffi.load("user32.dll");

      // BOOL SetWindowDisplayAffinity(HWND hWnd, DWORD dwAffinity)
      const SetWindowDisplayAffinity = user32.func(
        "SetWindowDisplayAffinity",
        "bool",
        ["pointer", "uint32"],
      );

      // Get the native window handle (HWND) from Electron
      const hwndBuffer = win.getNativeWindowHandle();

      const result = SetWindowDisplayAffinity(
        hwndBuffer,
        WDA_EXCLUDEFROMCAPTURE,
      );

      if (result) {
        console.log(
          "[PathMaker4u] Window protection applied via WDA_EXCLUDEFROMCAPTURE (fully invisible from capture)",
        );
      } else {
        console.warn(
          "[PathMaker4u] SetWindowDisplayAffinity failed, falling back to Electron's setContentProtection",
        );
        win.setContentProtection(true);
      }
    } catch (error) {
      console.error(
        "[PathMaker4u] Failed to apply native content protection, falling back to Electron:",
        error,
      );
      win.setContentProtection(true);
    }
  } else {
    // macOS and Linux: Electron's built-in method works correctly
    win.setContentProtection(true);
  }
}
