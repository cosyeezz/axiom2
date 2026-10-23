import { defineConfig } from "vite";
import { displayTypography } from "./scripts/display-typography.js";

export default defineConfig({
  root: "src/client",
  css: { postcss: { plugins: [displayTypography()] } },
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: { host: "127.0.0.1" },
});
