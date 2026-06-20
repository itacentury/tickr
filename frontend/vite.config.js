import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { defineConfig } from "vite";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

const root = ".";
const includeMarker = /<!--\s*@include\s+(\S+)\s*-->/g;

// Recursively inline `<!-- @include path -->` partials so the browser still
// receives one fully-assembled index.html. `stack` is the current resolution
// chain; a repeated path means a circular include, which we fail loudly on
// rather than recurse forever.
function inlinePartials(html, stack = []) {
  return html.replaceAll(includeMarker, (_match, path) => {
    if (stack.includes(path)) {
      throw new Error(
        `Circular @include detected: ${[...stack, path].join(" -> ")}`,
      );
    }
    let partial;
    try {
      partial = readFileSync(resolve(root, path), "utf-8").trimEnd();
    } catch (cause) {
      const source = stack.length ? `"${stack.at(-1)}"` : "index.html";
      throw new Error(`@include: cannot read "${path}" (included from ${source})`, {
        cause,
      });
    }
    return inlinePartials(partial, [...stack, path]);
  });
}

export default defineConfig({
  root,
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
    {
      // Inline `<!-- @include path -->` partials so the browser still receives
      // one fully-assembled index.html (dom.js resolves every [data-el] hook at
      // module-load time). Runs before Vite's own index-html asset processing.
      name: "html-include",
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          return inlinePartials(html);
        },
      },
      configureServer(server) {
        const partialsDir = resolve(root, "partials");
        server.watcher.add(partialsDir);
        server.watcher.on("change", (file) => {
          if (file.startsWith(partialsDir + sep)) {
            server.ws.send({ type: "full-reload" });
          }
        });
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
