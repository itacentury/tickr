import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const includeMarker = /<!--\s*@include\s+(\S+)\s*-->/g;

// Recursively inline `<!-- @include path -->` partials so the browser still
// receives one fully-assembled index.html. `root` is the base directory paths
// resolve against; `stack` is the current resolution chain. We key cycle
// detection on the resolved path so different spellings of the same file
// (`b.html` vs `./b.html`) can't slip past it, while keeping the raw spellings
// for the error chain. A repeat means a circular include, which we fail loudly
// on rather than recurse forever.
export function inlinePartials(html, root = ".", stack = []) {
  return html.replaceAll(includeMarker, (_match, path) => {
    const resolved = resolve(root, path);
    if (stack.some((entry) => entry.resolved === resolved)) {
      const chain = [...stack.map((entry) => entry.path), path].join(" -> ");
      throw new Error(`Circular @include detected: ${chain}`);
    }
    let partial;
    try {
      partial = readFileSync(resolved, "utf-8").trimEnd();
    } catch (cause) {
      const source = stack.length ? `"${stack.at(-1).path}"` : "index.html";
      throw new Error(`@include: cannot read "${path}" (included from ${source})`, {
        cause,
      });
    }
    return inlinePartials(partial, root, [...stack, { path, resolved }]);
  });
}
