import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

export default defineConfig({
  root: ".",
  build: {
    outDir: "../static/dist",
    emptyOutDir: true,
  },
  plugins: [
    {
      name: "sw-version-replace",
      writeBundle(options) {
        const swPath = resolve(options.dir, "sw.js");
        const src = readFileSync(swPath, "utf-8");
        writeFileSync(swPath, src.replaceAll("__APP_VERSION__", pkg.version));
      },
    },
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
