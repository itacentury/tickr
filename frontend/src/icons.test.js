import { describe, it, expect } from "vitest";
import { iconLabels, icons } from "./icons.js";

/** SVG basenames in `icons/` — the source of truth the picker is built from. */
const fileKeys = Object.keys(import.meta.glob("./icons/*.svg")).map((path) =>
  path.slice(path.lastIndexOf("/") + 1, -".svg".length),
);

describe("list icon registry", () => {
  it("keeps iconLabels keys and SVG files in sync (both directions)", () => {
    expect(Object.keys(iconLabels).sort()).toEqual([...fileKeys].sort());
  });

  it("renders non-empty SVG markup for every labelled icon", () => {
    for (const key of Object.keys(iconLabels)) {
      expect(icons[key]).toContain("<svg");
    }
  });

  it("rewrites the editor placeholder color to currentColor", () => {
    for (const svg of Object.values(icons)) {
      expect(svg).toContain("currentColor");
      expect(svg).not.toContain("#808080");
    }
  });
});
