import { describe, it, expect } from "vitest";
import {
  iconLabels,
  icons,
  uiIcons,
  themeSvgColors,
  requireSvg,
} from "./icons.js";

/** SVG basenames in `icons/` — the source of truth the picker is built from. */
const fileKeys = Object.keys(import.meta.glob("./icons/*.svg")).map((path) =>
  path.slice(path.lastIndexOf("/") + 1, -".svg".length),
);

/** SVG basenames in `icons/ui/` — action icons consumed by `render.js`. */
const uiFileKeys = Object.keys(import.meta.glob("./icons/ui/*.svg")).map(
  (path) => path.slice(path.lastIndexOf("/") + 1, -".svg".length),
);

/** `render.js` source — the only consumer of `uiIcons`. */
const renderSource = /** @type {string} */ (
  Object.values(
    import.meta.glob("./render.js", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  )[0]
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

  it("themes every stroke/fill to currentColor (no hardcoded colors survive)", () => {
    for (const svg of [...Object.values(icons), ...Object.values(uiIcons)]) {
      expect(svg).toContain("currentColor");
      expect(svg).not.toMatch(
        /(stroke|fill)\s*=\s*(["'])(?!(?:none|currentColor)\2)/,
      );
    }
  });
});

describe("ui icon registry", () => {
  it("consumes every ui icon file in render.js (no dead files)", () => {
    for (const key of uiFileKeys) {
      expect(renderSource).toContain(`uiIcons.${key}`);
    }
  });
});

describe("requireSvg", () => {
  it("returns the SVG when the key is present", () => {
    const map = new Map([["star", "<svg/>"]]);
    expect(requireSvg(map, "star", "list icon")).toBe("<svg/>");
  });

  it("throws naming the missing file when the key is absent", () => {
    expect(() => requireSvg(new Map(), "ghost", "list icon")).toThrow(/ghost/);
  });
});

describe("themeSvgColors", () => {
  it("tolerates whitespace around the equals sign", () => {
    expect(themeSvgColors('stroke = "#808080"')).toBe('stroke="currentColor"');
  });

  it("handles single-quoted values", () => {
    expect(themeSvgColors("stroke='#808080'")).toBe('stroke="currentColor"');
  });

  it("themes attributes spread across multiple lines", () => {
    const svg = '<svg\n  fill="#123456"\n  stroke="#808080"\n>';
    expect(themeSvgColors(svg)).toBe(
      '<svg\n  fill="currentColor"\n  stroke="currentColor"\n>',
    );
  });

  it("leaves fill=none and existing currentColor intact", () => {
    expect(themeSvgColors('fill="none"')).toBe('fill="none"');
    expect(themeSvgColors('fill="currentColor"')).toBe('fill="currentColor"');
  });

  it("ignores stroke/fill embedded in other attribute names", () => {
    expect(themeSvgColors('data-fill="#808080"')).toBe('data-fill="#808080"');
  });
});
