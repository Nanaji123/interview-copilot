// Quick diagnostic: check what systemPreferences returns for screen permission
const { app, systemPreferences, desktopCapturer } = require("electron");

app.whenReady().then(async () => {
  console.log("=== Screen Permission Diagnostic ===");
  console.log("Platform:", process.platform);
  console.log("Electron:", process.versions.electron);
  console.log("macOS:", process.getSystemVersion?.() || "N/A");
  
  try {
    const status = systemPreferences.getMediaAccessStatus("screen");
    console.log("getMediaAccessStatus('screen'):", JSON.stringify(status));
  } catch (e) {
    console.log("getMediaAccessStatus('screen') ERROR:", e.message);
  }

  try {
    const status2 = systemPreferences.getMediaAccessStatus("microphone");
    console.log("getMediaAccessStatus('microphone'):", JSON.stringify(status2));
  } catch (e) {
    console.log("getMediaAccessStatus('microphone') ERROR:", e.message);
  }

  try {
    const status3 = systemPreferences.getMediaAccessStatus("camera");
    console.log("getMediaAccessStatus('camera'):", JSON.stringify(status3));
  } catch (e) {
    console.log("getMediaAccessStatus('camera') ERROR:", e.message);
  }

  try {
    console.log("Attempting desktopCapturer.getSources...");
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 1, height: 1 },
    });
    console.log("desktopCapturer sources count:", sources.length);
    sources.forEach((s, i) => console.log(`  Source ${i}: ${s.name} (${s.id})`));
  } catch (e) {
    console.log("desktopCapturer.getSources ERROR:", e.message);
  }

  // Re-check after attempt
  try {
    const statusAfter = systemPreferences.getMediaAccessStatus("screen");
    console.log("getMediaAccessStatus('screen') AFTER attempt:", JSON.stringify(statusAfter));
  } catch (e) {
    console.log("getMediaAccessStatus('screen') AFTER ERROR:", e.message);
  }

  console.log("=== Done ===");
  app.quit();
});
