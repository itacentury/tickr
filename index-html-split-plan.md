# Plan: Split `frontend/index.html` into build-time partials

## Context

`frontend/index.html` is 851 lines and hard to navigate — ~540 of those lines (264–804)
are five large modals (New List, Edit List, Edit Item, Settings, Metrics). The goal is to
improve readability and maintainability by splitting it into focused partial files, **without
changing the runtime behaviour or the markup the browser receives**.

### Hard constraint that shapes the approach

`frontend/src/dom.js` resolves **every** `[data-el=…]` hook with `document.querySelector` at
module-evaluation time, relying on the deferred `<script type="module" src="/src/main.js">`
running only after the full HTML is parsed (see its header comment, lines 1–7). Therefore the
browser must still receive **one fully-assembled `index.html`**. Runtime JS injection would
break `dom.js` and is also constrained by the strict CSP. The split must happen at **build
time**, so the partials are inlined into the final `index.html`.

The chosen mechanism is a small custom Vite plugin — the same pattern already used by the
existing `sw-version-replace` plugin in `vite.config.js`, so no new dependency is introduced.
Granularity: one partial per region plus one per modal.

## Approach

### 1. New directory `frontend/partials/` with these fragments

Extract the corresponding markup verbatim from `index.html` (only cut/paste, no markup changes):

| Partial file                       | Source lines (current) | Content                                  |
| ---------------------------------- | ---------------------- | ---------------------------------------- |
| `partials/sidebar.html`            | 50–102                 | `<nav class="sidebar">` block            |
| `partials/main.html`               | 103–218                | `<main class="main-content">` block      |
| `partials/history-panel.html`      | 219–260                | `<aside class="history-panel">` block    |
| `partials/modal-new-list.html`     | 264–332                | New List modal                           |
| `partials/modal-edit-list.html`    | 333–532                | Edit List modal                          |
| `partials/modal-edit-item.html`    | 533–659                | Edit Item modal                          |
| `partials/modal-settings.html`     | 660–758                | Settings modal                           |
| `partials/modal-metrics.html`      | 759–804                | Metrics modal                            |
| `partials/toasts.html`             | 805–848                | Undo toast + error toast                 |

The `<head>` stays inline (it is cohesive document metadata and short relative to the body).
The `<div class="overlay">` (line 262) stays inline in the skeleton.

### 2. Slim `index.html` skeleton

`index.html` keeps the doctype, `<head>`, the `<body>` shell, the skip link, the `.app`
wrapper with the overlay, and the `<script type="module" src="/src/main.js">`. Each extracted
block is replaced by an include marker comment, e.g.:

```html
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <div class="app">
    <!-- @include partials/sidebar.html -->
    <!-- @include partials/main.html -->
    <!-- @include partials/history-panel.html -->
    <div class="overlay" data-el="overlay"></div>
  </div>
  <!-- @include partials/modal-new-list.html -->
  <!-- @include partials/modal-edit-list.html -->
  <!-- @include partials/modal-edit-item.html -->
  <!-- @include partials/modal-settings.html -->
  <!-- @include partials/modal-metrics.html -->
  <!-- @include partials/toasts.html -->
  <script type="module" src="/src/main.js"></script>
</body>
```

### 3. `html-include` Vite plugin in `vite.config.js`

Add a second plugin alongside `sw-version-replace`, mirroring its style (uses `node:fs` /
`node:path`, both already imported):

- **`transformIndexHtml(html)`** — replace every `<!-- @include path -->` marker with the file
  contents read from `resolve(__root, path)` (root = the Vite `root`, i.e. `frontend/`).
  Single-level includes only (no nesting needed). This hook runs for both `vite dev` and
  `vite build`, so dev-server and production output stay identical. Asset/URL processing that
  Vite normally does on `index.html` is unaffected because the only `<script>`/`<link>` tags
  remain in the skeleton, not in the partials.
- **`configureServer(server)`** (nice-to-have) — `server.watcher.add` the `partials/` dir and
  trigger a full reload on change, so editing a partial during `npm run dev` refreshes the page.

### 4. Tooling config updates (so the new files stay linted/formatted)

- **`frontend/eslint.config.js`** — add an override for `partials/**/*.html` (or
  `partials/*.html`) that turns off the document-level `@html-eslint` rules that don't apply to
  fragments: `require-doctype`, `require-lang`, `require-title`. Keep all correctness rules
  (closing tags, duplicate attrs, `id-naming-convention`, etc.). Note `no-multiple-h1` is fine
  because the single `<h1>` lives only in `partials/main.html`.
- **`frontend/package.json`** — extend the `format` script glob so Prettier also covers the new
  fragments, e.g. add `"partials/**/*.html"` to the `prettier --write` argument list.

## Critical files

- `frontend/index.html` — becomes the slim skeleton (edit).
- `frontend/partials/*.html` — new fragment files (create).
- `frontend/vite.config.js` — add the `html-include` plugin (edit).
- `frontend/eslint.config.js` — partials lint override (edit).
- `frontend/package.json` — Prettier glob (edit).
- `frontend/src/dom.js` — **not modified**; verifies the constraint that all hooks must be
  present after assembly.

## Verification

From `frontend/`:

1. `npm run build` — confirm it succeeds and inspect `static/dist/index.html`: it must be
   structurally equivalent to the pre-split single file (all `data-el` hooks, modals, toasts
   present in the same order). Quick check: the assembled file should contain no remaining
   `<!-- @include` markers.
2. `npm run dev` (with backend running) — open the app, then exercise each region whose markup
   moved: open/close the sidebar, add/edit an item, open each modal (New List, Edit List, Edit
   Item, Settings, Metrics), open the history panel, and trigger an undo toast. If any element
   were missing, `dom.js` would surface it as a null-reference error in the console.
3. Edit a partial while `npm run dev` runs — confirm the page reloads (validates the watcher).
4. `npm run lint` and `npm run format` — confirm the new partials pass and are formatted.
5. `npm run test` — confirm the existing suite still passes (no test depends on the HTML file
   structurally; `src/icons.test.js` only references it in a comment).