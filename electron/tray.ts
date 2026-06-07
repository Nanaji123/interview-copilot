import { Tray, Menu, nativeImage, app } from "electron";
import { join } from "path";

export function createTray(getMainWindow: () => any) {
  const pngPath = join(__dirname, "..", "assets", "tray-logo.png");
  let icon = nativeImage.createFromPath(pngPath);
  try {
    icon.setTemplateImage(true);
  } catch {}

  const tray = new Tray(icon);
  tray.setToolTip(app.getName());

  const buildMenu = () =>
    Menu.buildFromTemplate([
      {
        label: getMainWindow()?.isVisible() ? "Hide" : "Show",
        click: () => {
          const w = getMainWindow();
          if (!w) return;
          if (w.isVisible()) w.hide();
          else {
            w.show();
            w.focus();
          }
        },
      },
      {
        label: "Always on Top",
        type: "checkbox",
        checked: !!getMainWindow()?.isAlwaysOnTop(),
        click: (menuItem: any) => {
          const w = getMainWindow();
          if (!w) return;
          w.setAlwaysOnTop(menuItem.checked, "floating");
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]);

  tray.setContextMenu(buildMenu());
  tray.on("click", () => {
    const w = getMainWindow();
    if (!w) return;
    if (w.isVisible()) w.hide();
    else {
      w.show();
      w.focus();
    }
  });

  return tray;
}
