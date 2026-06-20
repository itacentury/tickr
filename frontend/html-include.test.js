// @vitest-environment jsdom
// jsdom is required so the assembled markup can be loaded into a document and
// dom.js (which resolves every [data-el] hook at module-load time) re-imported
// against it — that is exactly the contract this test guards.
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inlinePartials } from "./html-include.js";

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const assembled = inlinePartials(
  readFileSync(resolve(frontendRoot, "index.html"), "utf-8"),
  frontendRoot,
);

describe("assembled index.html", () => {
  it("leaves no @include markers behind", () => {
    expect(assembled).not.toMatch(/<!--\s*@include/);
  });

  describe("dom.js contract", () => {
    beforeAll(() => {
      // Parse the assembled markup into a detached document (no script
      // execution) and graft its root onto the live document so dom.js can
      // resolve hooks against the global `document` it queries.
      const parsed = new DOMParser().parseFromString(assembled, "text/html");
      document.replaceChild(
        document.importNode(parsed.documentElement, true),
        document.documentElement,
      );
    });

    it("resolves every dom.js element hook", async () => {
      const dom = await import("./src/dom.js");
      for (const [name, value] of Object.entries(dom)) {
        if (typeof value === "function") continue;
        expect(value, `dom.js export "${name}" resolved to null`).not.toBeNull();
      }
    });
  });
});

describe("inlinePartials error paths", () => {
  let fixtureRoot;

  beforeAll(() => {
    fixtureRoot = mkdtempSync(resolve(tmpdir(), "tickr-include-"));
    writeFileSync(resolve(fixtureRoot, "a.html"), "<!-- @include b.html -->");
    writeFileSync(resolve(fixtureRoot, "b.html"), "<!-- @include a.html -->");
    // Self-include written with a different spelling of the same file; the
    // cycle guard must key on the resolved path, not the raw marker string.
    writeFileSync(resolve(fixtureRoot, "c.html"), "<!-- @include ./c.html -->");
    // Cycle that only exists once symlinks are resolved: s.html includes a
    // symlink that points back at s.html. Textual resolution sees two distinct
    // paths; realpath collapses them to one inode.
    writeFileSync(resolve(fixtureRoot, "s.html"), "<!-- @include s-link.html -->");
    symlinkSync(resolve(fixtureRoot, "s.html"), resolve(fixtureRoot, "s-link.html"));
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("fails loudly on a circular include", () => {
    expect(() => inlinePartials("<!-- @include a.html -->", fixtureRoot)).toThrow(
      /^Circular @include detected: a\.html -> b\.html -> a\.html$/,
    );
  });

  it("detects a cycle across different spellings of the same file", () => {
    expect(() => inlinePartials("<!-- @include c.html -->", fixtureRoot)).toThrow(
      /^Circular @include detected: c\.html -> \.\/c\.html$/,
    );
  });

  it("detects a cycle through a symlink alias of the same file", () => {
    expect(() => inlinePartials("<!-- @include s.html -->", fixtureRoot)).toThrow(
      /^Circular @include detected: s\.html -> s-link\.html$/,
    );
  });

  it("reports the source when a partial is missing", () => {
    expect(() =>
      inlinePartials("<!-- @include nope.html -->", fixtureRoot),
    ).toThrow(/cannot read "nope\.html" \(included from index\.html\)/);
  });
});
