// @vitest-environment jsdom
// jsdom is required because populateIconPicker/filterIconPicker query and
// mutate DOM nodes.
import { describe, it, expect, beforeAll } from "vitest";
import {
  iconLabels,
  icons,
  uiIcons,
  themeSvgColors,
  requireSvg,
  populateIconPicker,
  filterIconPicker,
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

describe("icon picker search", () => {
  // jsdom omits matchMedia; stub it so the reduced-motion guard in
  // animateGridHeight runs. `matches: false` keeps the full filter path active.
  beforeAll(() => {
    window.matchMedia = () =>
      /** @type {MediaQueryList} */ ({ matches: false });
  });

  /** Build an icon-options container matching index.html and populate it. */
  function createPicker() {
    const container = document.createElement("div");
    container.className = "icon-options";
    container.innerHTML =
      '<input class="icon-search" />' +
      '<div class="icon-grid"></div>' +
      '<p class="icon-no-results" hidden></p>';
    populateIconPicker(container);
    return container;
  }

  /** Keys of the options that are currently visible (not hidden). */
  function visibleKeys(container) {
    const options = container.querySelectorAll(".icon-option:not([hidden])");
    return [...options].map(
      (el) => /** @type {HTMLElement} */ (el).dataset.icon,
    );
  }

  /** The `.icon-no-results` element typed as an HTMLElement. */
  function noResults(container) {
    return /** @type {HTMLElement} */ (
      container.querySelector(".icon-no-results")
    );
  }

  it("renders one option per icon into the grid", () => {
    const container = createPicker();
    const grid = container.querySelector(".icon-grid");
    expect(grid.querySelectorAll(".icon-option")).toHaveLength(
      Object.keys(icons).length,
    );
  });

  it("matches by display label", () => {
    const container = createPicker();
    filterIconPicker(container, "shopping");
    expect(visibleKeys(container)).toEqual(["cart", "shoppingBag"]);
  });

  it("matches by synonym keyword", () => {
    const container = createPicker();
    filterIconPicker(container, "groceries");
    expect(visibleKeys(container)).toEqual(["cart"]);
  });

  it("shows the no-results message when nothing matches", () => {
    const container = createPicker();
    filterIconPicker(container, "zzz");
    expect(visibleKeys(container)).toEqual([]);
    expect(noResults(container).hidden).toBe(false);
  });

  it("restores the full grid on an empty query", () => {
    const container = createPicker();
    filterIconPicker(container, "shopping");
    filterIconPicker(container, "");
    expect(visibleKeys(container)).toHaveLength(Object.keys(icons).length);
    expect(noResults(container).hidden).toBe(true);
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
