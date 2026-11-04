import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.fcjy.fcboard",
  appName: "Fcboard",
  webDir: "build",
  // PCM, image payloads and credentials must not be formatted into a log for
  // every native call. Debuggable WebView and surfaced errors remain available.
  android: { path: "../android", loggingBehavior: "none" },
};

export default config;
