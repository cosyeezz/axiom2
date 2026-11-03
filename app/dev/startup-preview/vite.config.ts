import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Deliberately separate from desktop/vite.config.ts and both production entry points.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  cacheDir: "/tmp/axiom-startup-preview-6316280f/vite-cache",
  server: {
    host: "127.0.0.1", port: 5198, strictPort: true, hmr: false, watch: null,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    headers: { "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'" },
  },
});
