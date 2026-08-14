import { autoUpdater } from "electron";

import type {
  DesktopUpdateTransport,
} from "../src/desktop-update.js";

export function electronDesktopUpdateTransport(): DesktopUpdateTransport {
  return {
    configure(feedUrl) {
      autoUpdater.setFeedURL({ url: feedUrl });
    },
    async checkForUpdates() {
      await autoUpdater.checkForUpdates();
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall();
    },
    subscribe(listener) {
      const available = () => listener({ type: "available" } as const);
      const notAvailable = () => listener({ type: "not_available" } as const);
      const downloaded = (_event: Electron.Event, _releaseNotes: string, releaseName: string) => {
        listener({ type: "downloaded", releaseName });
      };
      const error = (cause: Error) => listener({ type: "error", error: cause });
      autoUpdater.on("update-available", available);
      autoUpdater.on("update-not-available", notAvailable);
      autoUpdater.on("update-downloaded", downloaded);
      autoUpdater.on("error", error);
      return () => {
        autoUpdater.removeListener("update-available", available);
        autoUpdater.removeListener("update-not-available", notAvailable);
        autoUpdater.removeListener("update-downloaded", downloaded);
        autoUpdater.removeListener("error", error);
      };
    },
  };
}
