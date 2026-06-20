import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

const includeMarker = /<!--\s*@include\s+(\S+)\s*-->/g;

// Recursively inline `<!-- @include path -->` partials so the browser still
// receives one fully-assembled index.html. `root` is the base directory every
// path resolves against — including nested includes inside a partial, since the
// same `root` is passed down (line below). So a nested include must be written
// relative to the frontend root (e.g. `partials/x.html`), not relative to the
// including partial. `stack` is the current resolution chain. We key cycle
// detection on the realpath-canonicalized path so distinct spellings of the
// same file can't slip past it — not just textual variants (`b.html` vs
// `./b.html`) but symlink aliases and case-insensitive-filesystem collisions
// (`B.html` vs `b.html`) too — while keeping the raw spellings for the error
// chain. A repeat means a circular include, which we fail loudly on rather than
// recurse forever.
export function inlinePartials(html, root = ".", stack = []) {
  return html.replaceAll(includeMarker, (_match, path) => {
    const resolved = resolve(root, path);
    // Canonicalize to an inode-true key so symlink aliases and case-insensitive
    // collisions collapse to one entry; a missing file can't be in the stack, so
    // fall back to the resolved path and let readFileSync below report it.
    let canonical;
    try {
      canonical = realpathSync(resolved);
    } catch {
      canonical = resolved;
    }
    if (stack.some((entry) => entry.resolved === canonical)) {
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
    return inlinePartials(partial, root, [...stack, { path, resolved: canonical }]);
  });
}
