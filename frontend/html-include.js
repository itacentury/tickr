import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const includeMarker = /<!--\s*@include\s+(\S+)\s*-->/g;

// Recursively inline `<!-- @include path -->` partials so the browser still
// receives one fully-assembled index.html. `root` is the base directory paths
// resolve against; `stack` is the current resolution chain, so a repeated path
// means a circular include, which we fail loudly on rather than recurse forever.
export function inlinePartials(html, root = ".", stack = []) {
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
    return inlinePartials(partial, root, [...stack, path]);
  });
}
