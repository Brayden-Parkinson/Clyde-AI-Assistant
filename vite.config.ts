import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";
import { resolve } from "path";

/**
 * CRXJS injects Vite's modulepreload polyfill into every chunk it generates.
 * That polyfill calls `document.getElementsByTagName` and `document.querySelector`,
 * which crash in Chrome MV3 service workers (no DOM).
 *
 * This plugin patches the two unsafe calls in every output chunk so they
 * short-circuit gracefully when `document` is not defined.
 */
function serviceWorkerSafePreload(): Plugin {
  return {
    name: "sw-safe-modulepreload",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        // The Vite/CRXJS modulepreload polyfill contains DOM + window calls that
        // crash in service workers (no document/window). Patch them to be safe:
        chunk.code = chunk.code
          // 1. Skip the entire preload block when document is absent
          .replace(
            /if\((\w+)&&\1\.length>0\)\{/g,
            'if($1&&$1.length>0&&typeof document!=="undefined"){',
          )
          // 2. Guard window.dispatchEvent(arg) in the preload error handler
          .replace(
            /window\.dispatchEvent\((\w+)\)/g,
            '(typeof window!=="undefined"&&window.dispatchEvent($1))',
          );
      }
    },
  };
}

export default defineConfig({
  base: "",
  plugins: [react(), crx({ manifest }), serviceWorkerSafePreload()],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        options: resolve(__dirname, "src/options/index.html"),
      },
    },
  },
});
