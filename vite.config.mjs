import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./desktop/renderer", import.meta.url)),
  base: "./",
  build: {
    outDir: "../ui",
    emptyOutDir: true,
    target: "chrome148",
    sourcemap: false,
  },
});
