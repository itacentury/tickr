/**
 * Category autocomplete factory.
 *
 * A typeahead popup anchored to a text input: when the user types a trailing
 * `#prefix`, it suggests matching categories and rewrites the token to a
 * canonical `#Name` tag on selection. Each instance owns its own transient UI
 * state, so the same input pair (e.g. add-item and edit-item) can be wired
 * independently. The pure trigger/format logic lives in `category-tag.js`.
 */

import { state } from "./state.js";
import { detectTrigger, formatTag } from "./category-tag.js";
import { AUTOCOMPLETE_BLUR_DELAY_MS } from "./timing.js";

/**
 * Create a category autocomplete bound to one input + popup pair.
 *
 * @param {HTMLInputElement} input - The text input to watch for `#` triggers.
 * @param {HTMLUListElement} menu - The popup `<ul>` to render suggestions into.
 * @param {(category: object) => void} [onAccept] - Called with the chosen
 *   category when a suggestion is committed. When provided, the category is
 *   assumed to be reflected elsewhere (e.g. a dropdown), so the in-progress
 *   `#tag` is stripped from the input instead of rewritten to a canonical token.
 * @returns {{ accept: () => boolean, hide: () => void }} Handlers the enclosing
 *   form's submit path needs: `accept` commits a focused suggestion (returns
 *   true if one was accepted), `hide` closes and resets the popup.
 */
export function createCategoryAutocomplete(input, menu, onAccept) {
  // Suggestion list currently rendered in the popup (subset of state.categories).
  let acSuggestions = [];
  // Index of the highlighted suggestion, or -1 when nothing is highlighted.
  let acActiveIndex = -1;
  // Start index of the `#` in input.value that opened the popup. Used when
  // replacing the in-progress token with the selected category name.
  let acTriggerStart = -1;

  function hide() {
    menu.hidden = true;
    menu.replaceChildren();
    acSuggestions = [];
    acActiveIndex = -1;
    acTriggerStart = -1;
    input.removeAttribute("aria-activedescendant");
  }

  function buildSuggestionItem(category, index) {
    const li = document.createElement("li");
    li.className = "category-autocomplete-item";
    li.setAttribute("role", "option");
    li.dataset.index = String(index);
    li.id = `ac-opt-${index}`;

    const dot = document.createElement("span");
    dot.className = "dropdown-dot";
    if (category.color) dot.style.setProperty("--cat-color", category.color);

    const label = document.createElement("span");
    label.className = "dropdown-item-label";
    label.textContent = category.name;

    li.append(dot, label);
    return li;
  }

  function render(prefix) {
    const lower = prefix.toLowerCase();
    acSuggestions = state.categories.filter((c) =>
      c.name.toLowerCase().startsWith(lower),
    );

    menu.replaceChildren();

    if (acSuggestions.length === 0) {
      // Empty state: show a hint instead of silently doing nothing, so the
      // user realises why no category will be assigned. Keep the popup open
      // because they are still mid-typing a tag.
      const empty = document.createElement("li");
      empty.className = "category-autocomplete-empty";
      empty.textContent = "No matching category";
      menu.append(empty);
      acActiveIndex = -1;
      menu.hidden = false;
      return;
    }

    acSuggestions.forEach((c, i) => menu.append(buildSuggestionItem(c, i)));
    acActiveIndex = 0;
    updateActive();
    menu.hidden = false;
  }

  function updateActive() {
    menu.querySelectorAll(".category-autocomplete-item").forEach((el, i) => {
      el.classList.toggle("active", i === acActiveIndex);
    });
    if (acActiveIndex >= 0) {
      input.setAttribute("aria-activedescendant", `ac-opt-${acActiveIndex}`);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  /** Cycle the highlighted suggestion by `dir` (+1 down, -1 up), wrapping. */
  function moveActive(dir) {
    if (acSuggestions.length === 0) return;
    acActiveIndex =
      (acActiveIndex + dir + acSuggestions.length) % acSuggestions.length;
    updateActive();
  }

  /**
   * Commit the highlighted suggestion (if any) by rewriting the in-progress
   * `#prefix` token with `formatTag(name)` and closing the popup.
   *
   * @returns {boolean} true if a suggestion was accepted, false otherwise.
   */
  function accept() {
    if (menu.hidden || acActiveIndex < 0 || acTriggerStart < 0) return false;
    const cat = acSuggestions[acActiveIndex];
    if (!cat) return false;
    const before = input.value.slice(0, acTriggerStart);
    if (onAccept) {
      // Category is reflected elsewhere (the dropdown) — drop the in-progress
      // tag from the text instead of inserting a canonical token.
      input.value = before;
      onAccept(cat);
    } else {
      input.value = `${before}${formatTag(cat.name)} `;
    }
    input.selectionStart = input.selectionEnd = input.value.length;
    hide();
    return true;
  }

  input.addEventListener("input", () => {
    // Trigger detection uses the substring up to the caret so the popup also
    // works when the user edits mid-text. Falls back to full value if the
    // selection API is unavailable.
    const caret = input.selectionStart ?? input.value.length;
    const upToCaret = input.value.slice(0, caret);
    const trigger = detectTrigger(upToCaret);
    if (!trigger) {
      hide();
      return;
    }
    acTriggerStart = trigger.start;
    render(trigger.prefix);
  });

  input.addEventListener("keydown", (e) => {
    if (menu.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Tab") {
      if (accept()) e.preventDefault();
    } else if (e.key === "Escape") {
      // Stop propagation so closing the popup inside a modal doesn't also
      // bubble up to the global Escape handler that closes the modal.
      e.preventDefault();
      e.stopPropagation();
      hide();
    }
    // Enter is handled by the form's submit listener, which calls
    // accept() before falling through to item creation.
  });

  menu.addEventListener("mousedown", (e) => {
    // mousedown (not click) so the input's blur doesn't close the popup
    // before the selection registers.
    const el = /** @type {HTMLElement} */ (e.target);
    const li = /** @type {HTMLElement} */ (
      el.closest(".category-autocomplete-item")
    );
    if (!li) return;
    e.preventDefault();
    acActiveIndex = Number(li.dataset.index);
    accept();
    input.focus();
  });

  input.addEventListener("blur", () => {
    // Slight delay so a mousedown on the menu can run first.
    setTimeout(() => {
      if (document.activeElement !== input) hide();
    }, AUTOCOMPLETE_BLUR_DELAY_MS);
  });

  return { accept, hide };
}
