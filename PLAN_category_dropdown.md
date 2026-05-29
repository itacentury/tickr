# Plan: Custom Category-Dropdown im Item-Edit-Modal

## Context

Im `#editItemModal` wird die Kategorie aktuell über ein natives `<select id="editItemCategory" class="setting-select">` ausgewählt. Der **geschlossene** Select ist gestylet (rund, dunkler Hintergrund, Custom-Chevron via SVG-Background). Das **geöffnete** Popup wird vom OS/Browser gerendert: eckig, weißer/blauer Highlight, ignoriert `border-radius`, `padding`, `transition`. Das wirkt fremd inmitten der ansonsten stark abgerundeten, dunklen UI.

Zusätzlich fehlt im aktuellen Dropdown ein wichtiges visuelles Signal: der **Farb-Dot der jeweiligen Kategorie**. Mit nativem `<option>` ist das ohnehin nicht möglich (CSS auf `option` greift nur für `background-color`/`color`).

Ziel: das `<select>` durch eine eigene Dropdown-Komponente ersetzen, die optisch zur restlichen Modal-UI passt und pro Eintrag den Farb-Dot anzeigt. Das Öffnen erfolgt als **Floating Popover** (absolut positioniert über dem Button) — schließt bei Outside-Click oder Escape, schiebt nichts im Modal weg.

## Pattern-Anlehnung

Im Codebase existiert bereits ein Custom-Picker-Pattern: `icon-picker-toggle` + `icon-options` (siehe `modal.css:137-212`). Das nutzt eine inline-expandierende Liste. Da unter dem Kategorie-Select aber das Quick-Create-Form (`#editItemCategoryQuickForm`) liegt und der Formfluss linear ist, ist **floating** hier passender.

Visuell soll der **geschlossene** Toggle exakt aussehen wie der jetzige `.setting-select` (dunkler Hintergrund, runde Ecken, Chevron rechts) — das CSS dafür baut auf den Tokens `--bg-tertiary`, `--border`, `--radius-md`, `--accent` auf.

## Datenmodell / State

Keine Schema-Änderungen. `state.categories` ist bereits reaktiv via `subscribeCategories(listId)` (siehe `data.js`). Der Custom-Dropdown rendert sich aus dieser Source.

Kein neuer State-Eintrag nötig — Open/Close läuft rein DOM-basiert über die Klasse `.open` am Wrapper.

## DOM-Struktur (Ersatz für `#editItemCategory`)

In `frontend/index.html` (Zeilen 433-446) das `<select>` ersetzen durch einen Wrapper:

- `<div class="category-select" id="editItemCategorySelect">`
  - `<button type="button" class="category-select-toggle" id="editItemCategoryToggle" aria-haspopup="listbox" aria-expanded="false">`
    - `<span class="category-select-dot">` (Farb-Indikator der aktuellen Auswahl)
    - `<span class="category-select-label">` (Name der aktuellen Auswahl, default "(no category)")
    - `<svg class="chevron">` (animiert via `.open`-Klasse)
  - `</button>`
  - `<ul class="category-select-menu" id="editItemCategoryMenu" role="listbox" tabindex="-1" hidden>` (wird via Render-Funktion gefüllt)
  - `<input type="hidden" id="editItemCategoryValue" value="">` (speichert die ausgewählte categoryId)
- `</div>`

Das Hidden-Input speichert den ausgewählten `categoryId`-Wert (oder `""` für "no category"), damit der Submit-Pfad in `events.js:311` (`dom.editItemCategory.value || null`) unverändert bleibt — `dom.editItemCategory` zeigt dann auf das Hidden-Input.

## DOM-Refs (`frontend/src/dom.js`)

`editItemCategory` bleibt als Name erhalten, zeigt aber jetzt auf `#editItemCategoryValue` (Hidden-Input), damit `.value`-Reads im Submit-Pfad weiterhin funktionieren. Neu:
- `editItemCategorySelect` (Wrapper für Outside-Click-Detection)
- `editItemCategoryToggle`
- `editItemCategoryMenu`
- `editItemCategoryLabel` (das `.category-select-label`-Span im Toggle)
- `editItemCategoryDot` (das `.category-select-dot`-Span im Toggle)

## Render-Logik (`frontend/src/render.js`)

`renderItemCategoryOptions()` (aktuell render.js:387-401) komplett umschreiben. Die Funktion baut eine Items-Liste mit `[{id:"", name:"(no category)", color:null}, ...state.categories]`, mappt diese auf `<li role="option">`-Markup mit jeweils einem Dot-Span (bei `color===null` mit Modifier-Klasse `--empty` für gestrichelten Rand), Label-Span, `data-id`-Attribut, `.selected`-Klasse falls `id === currentId`. Der HTML-String wird wie im bisherigen Code via dem schon bestehenden Pattern (siehe render.js:396 und render.js:393 mit `escapeHtml`) ins Menu gesetzt.

Neue Hilfsfunktion `syncCategoryToggleLabel()` aktualisiert Toggle-Text (`category-select-label`) und Dot-Farbe (`category-select-dot` via `--cat-color` CSS-Var) basierend auf `editItemCategory.value`. Wird auch nach Auswahl und nach `openEditItemModal` (render.js:435) aufgerufen.

## Event-Logik (`frontend/src/events.js`)

Neue Handler in `setupEventListeners`:

- **Toggle click**: `e.stopPropagation()` + `toggleCategoryDropdown()`.
- **Menu click**: Delegation auf `.category-select-item` per `closest()`; setzt `dom.editItemCategory.value = item.dataset.id`, ruft `syncCategoryToggleLabel()`, schließt Menu.
- **Outside click** (an `document` registriert): wenn `!dom.editItemCategorySelect.contains(e.target)` → `closeCategoryDropdown()`.
- **Toggle keydown**: bei Enter/Space/ArrowDown → öffnen + ersten Eintrag aktiv markieren.
- **Menu keydown**: Escape schließt + fokussiert Toggle. ArrowUp/ArrowDown verschiebt `.active`-Klasse. Enter wählt aktiven Eintrag.

Helper `toggleCategoryDropdown` / `openCategoryDropdown` / `closeCategoryDropdown` togglen `.open` am Wrapper und das `hidden`-Attribut am Menu, plus `aria-expanded` am Toggle.

Beim Modal-Close (`cancelEditItem`-Klick, Submit-Success) `closeCategoryDropdown()` aufrufen.

Quick-Create-Pfad (events.js:360-378): nach `dom.editItemCategory.value = created.id` zusätzlich `syncCategoryToggleLabel()` aufrufen, damit das Toggle den neuen Namen+Dot zeigt.

## CSS (`frontend/src/styles/categories.css`)

Neue Stiles am Ende der Datei. Tokens `--bg-tertiary`, `--bg-secondary`, `--bg-hover`, `--border`, `--border-light`, `--radius-md`, `--accent`, `--accent-subtle`, `--transition-fast`, `--transition-normal` werden bereits in der Codebase verwendet (siehe `modal.css`).

Regelübersicht:

- `.category-select` — `position: relative; flex: 1`
- `.category-select-toggle` — gleicher Look wie `.setting-select` (padding 14/16, `--bg-tertiary`-Background, `--border`, `--radius-md`), zusätzlich Flex-Layout für Dot+Label+Chevron
- `.category-select-toggle:hover` — `border-color: var(--border-light)`
- `.category-select.open .category-select-toggle` — `border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-subtle)`
- `.category-select.open .chevron` — `transform: rotate(180deg)`
- `.category-select-dot` — 12×12, rund, Background aus `--cat-color`-CSS-Var
- `.category-select-dot--empty` — transparenter Background, dashed Border (für "no category")
- `.category-select-menu` — `position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 10`, `--bg-secondary`-Background, `--border`, `--radius-md`, Box-Shadow, `max-height: 240px; overflow-y: auto`
- `.category-select-menu[hidden]` — `display: none`
- `.category-select-item` — Flex mit `gap: 10px`, `padding: 10px 12px`, `border-radius: 6px`, Pointer-Cursor
- `.category-select-item:hover, .category-select-item.active` — `background: var(--bg-hover)`
- `.category-select-item.selected` — `background: var(--accent-subtle)`
- `.category-select-item-label` — `flex: 1`, Ellipsis-Truncation

Die alte Regel `.category-row-inline .setting-select` (categories.css:234) entfernen — wird obsolet, weil das `<select>` weg ist.

## Kritische Dateien

- `frontend/index.html` — Markup-Tausch in `#editItemModal` (Zeilen 433-446)
- `frontend/src/dom.js` — neue Refs, `editItemCategory` zeigt auf Hidden-Input
- `frontend/src/render.js` — `renderItemCategoryOptions` umschreiben, `syncCategoryToggleLabel` neu
- `frontend/src/events.js` — Toggle/Menu-Eventhandler, Outside-Click, Keyboard, Quick-Create-Anpassung
- `frontend/src/styles/categories.css` — neue Dropdown-Styles, alte `.category-row-inline .setting-select`-Regel entfernen
- `frontend/src/styles/modal.css` — keine Änderung; `.setting-select`-Regel bleibt für andere Selects (Sort-Select, Settings-Select)

## Verifikation

1. **Build**: `npx vite build` muss ohne Errors durchlaufen.
2. **Manueller Smoke-Test im Browser**:
   - Item-Edit-Modal öffnen → Toggle zeigt aktuelle Kategorie (Dot + Name) oder "(no category)".
   - Klick auf Toggle → Menu poppt unten auf, gestylet konsistent zum Modal (rund, dunkel, Hover-States).
   - Jede Liste-Option zeigt Farb-Dot links neben dem Namen; "(no category)" zeigt einen leeren/dashed Dot.
   - Klick auf Option → Toggle aktualisiert Label+Dot, Menu schließt.
   - Outside-Click schließt Menu.
   - Escape schließt Menu, Fokus zurück auf Toggle.
   - ↑/↓ Tasten navigieren, Enter wählt.
   - Quick-Create "+ New" → neue Kategorie wird angelegt, automatisch im Toggle übernommen (Name+Dot).
   - Save persistiert die korrekte `category_id` (Item-Badge nach Reload prüfen).
3. **Reaktivität**: in zweitem Tab Kategorie umbenennen → Toggle-Label im ersten Tab aktualisiert sich (via `state.categories`-Subscription, die bereits `renderItemCategoryOptions` triggert in render.js:30).

## Nicht in Scope

- Custom-Dropdown im Listen-Edit-Modal — dort gibt es keinen Select.
- Search/Filter im Dropdown bei vielen Kategorien — bei realistischen Sizes (<50) nicht nötig.
- Mobile Native-Picker-Fallback — die Tastaturnavigation deckt Accessibility ab; Touch-Targets sind groß genug.
- Animation des Menu-Auf/Zu (fade/slide) — kann später ergänzt werden, jetzt nur `hidden`-Toggle.

## Risiken

- **Submit-Pfad**: `events.js:311` liest `dom.editItemCategory.value`. Wenn `editItemCategory` jetzt das Hidden-Input ist, funktioniert das weiterhin. Wichtig: Reihenfolge der DOM-Refs in `dom.js` so anpassen, dass kein `null` entsteht (Hidden-Input muss im DOM existieren, bevor das Modul lädt — passt, weil `index.html` vor `main.js` parsed wird).
- **Z-Index**: Modal hat eigenen Stacking-Context; das Menu mit `z-index: 10` muss innerhalb dessen liegen. Falls das Menu unter anderen Modal-Elementen verschwindet, höher setzen.
- **Outside-Click-Listener**: Wird einmal in `setupEventListeners` global angemeldet. Performance vernachlässigbar; sauberer wäre nur-bei-open registrieren, ist aber nicht zwingend.
- **Hidden-Input für Forms**: Falls das Modal-Form jemals via `FormData(form)` gelesen würde, wäre das Hidden-Input darin enthalten — aktuell nicht der Fall (manuelles Lesen über `dom.editItemText.value` etc.), also unkritisch.
- **XSS**: Kategorie-Namen werden via dem bestehenden `escapeHtml`-Helper (render.js bereits in Verwendung) durchgereicht, bevor sie ins Menu-Markup gehen. Color-Werte sind bereits in Backend+RxDB-Schema gegen `^#[0-9a-fA-F]{6}$` validiert, daher sicher als CSS-Var-Wert.
