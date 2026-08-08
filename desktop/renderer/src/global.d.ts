import type { DesktopApi } from "../../../src/desktop-contract";

declare global {
  interface Window {
    localbuddy: DesktopApi;
  }
}

export {};
