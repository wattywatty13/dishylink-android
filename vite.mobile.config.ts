// Build for the Android app (Capacitor). The web bundle lands in dist-mobile/,
// which `npx cap sync android` copies into the native project.
//
// It mounts the same src/App as every other host, bound to the browser
// extension's host modules; `wxt/browser` and `#imports` resolve to the Android
// stand-ins in mobile/shim instead of the real WebExtension API.
import path from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const appVersion: string = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
).version;

export default defineConfig({
  root: path.resolve(__dirname, "mobile"),
  publicDir: path.resolve(__dirname, "public"),
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@core": path.resolve(__dirname, "./core"),
      "@cloud": path.resolve(__dirname, "./cloud"),
      "wxt/browser": path.resolve(__dirname, "./mobile/shim/browser.ts"),
      "#imports": path.resolve(__dirname, "./mobile/shim/imports.ts"),
    },
  },
  worker: { format: "es" },
  build: {
    outDir: path.resolve(__dirname, "dist-mobile"),
    emptyOutDir: true,
    // Android System WebView updates with Chrome; anything from the last few years
    // handles the top-level await satellite.js uses.
    target: "es2022",
  },
  server: {
    port: 5180,
    // Development only: dev/fakeDish.mts behind the dev server, for layout work
    // without the hardware (see mobile/nativeFetch.ts devRewrite).
    proxy: {
      "/fake-dish": {
        target: "http://127.0.0.1:9201",
        rewrite: (p) => p.replace(/^\/fake-dish/, ""),
      },
      "/fake-router": {
        target: "http://127.0.0.1:9001",
        rewrite: (p) => p.replace(/^\/fake-router/, ""),
      },
    },
  },
});
