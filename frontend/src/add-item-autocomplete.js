/**
 * Add-item category autocomplete.
 *
 * A typeahead popup anchored to the add-item input: when the user types a
 * trailing `#prefix`, it suggests matching categories and rewrites the token
 * to a canonical `#Name` tag on selection. Owns its own transient UI state;
 * the pure trigger/format logic lives in `category-tag.js`.
 */

import { state } from "./state.js";
import * as dom from "./dom.js";
import { detectTrigger, formatTag } from "./category-tag.js";

// Suggestion list currently rendered in the popup (subset of state.categories).
let acSuggestions = [];
// Index of the highlighted suggestion, or -1 when nothing is highlighted.
let acActiveIndex = -1;
// Start index of the `#` in addItemInput.value that opened the popup. Used
// when replacing the in-progress token with the selected category name.
let acTriggerStart = -1;

export function hideCategoryAutocomplete() {
  const menu = dom.addItemCategoryAutocomplete;
  menu.hidden = true;
  menu.replaceChildren();
  acSuggestions = [];
  acActiveIndex = -1;
  acTriggerStart = -1;
  dom.addItemInput.removeAttribute("aria-activedescendant");
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

function renderCategoryAutocomplete(prefix) {
  const menu = dom.addItemCategoryAutocomplete;
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
  updateActiveSuggestion();
  menu.hidden = false;
}

function updateActiveSuggestion() {
  const menu = dom.addItemCategoryAutocomplete;
  menu.querySelectorAll(".category-autocomplete-item").forEach((el, i) => {
    el.classList.toggle("active", i === acActiveIndex);
  });
  if (acActiveIndex >= 0) {
    dom.addItemInput.setAttribute(
      "aria-activedescendant",
      `ac-opt-${acActiveIndex}`,
    );
  } else {
    dom.addItemInput.removeAttribute("aria-activedescendant");
  }
}

/** Cycle the highlighted suggestion by `dir` (+1 down, -1 up), wrapping. */
function moveActive(dir) {
  if (acSuggestions.length === 0) return;
  acActiveIndex =
    (acActiveIndex + dir + acSuggestions.length) % acSuggestions.length;
  updateActiveSuggestion();
}

/**
 * Commit the highlighted suggestion (if any) by rewriting the in-progress
 * `#prefix` token with `formatTag(name)` and closing the popup.
 *
 * @returns {boolean} true if a suggestion was accepted, false otherwise.
 */
export function acceptActiveSuggestion() {
  if (
    dom.addItemCategoryAutocomplete.hidden ||
    acActiveIndex < 0 ||
    acTriggerStart < 0
  ) {
    return false;
  }
  const cat = acSuggestions[acActiveIndex];
  if (!cat) return false;
  const before = dom.addItemInput.value.slice(0, acTriggerStart);
  dom.addItemInput.value = `${before}${formatTag(cat.name)} `;
  dom.addItemInput.selectionStart = dom.addItemInput.selectionEnd =
    dom.addItemInput.value.length;
  hideCategoryAutocomplete();
  return true;
}

export function setupAddItemCategoryAutocomplete() {
  const input = dom.addItemInput;
  const menu = dom.addItemCategoryAutocomplete;

  input.addEventListener("input", () => {
    // Trigger detection uses the substring up to the caret so the popup also
    // works when the user edits mid-text. Falls back to full value if the
    // selection API is unavailable.
    const caret = input.selectionStart ?? input.value.length;
    const upToCaret = input.value.slice(0, caret);
    const trigger = detectTrigger(upToCaret);
    if (!trigger) {
      hideCategoryAutocomplete();
      return;
    }
    acTriggerStart = trigger.start;
    renderCategoryAutocomplete(trigger.prefix);
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
      if (acceptActiveSuggestion()) e.preventDefault();
    } else if (e.key === "Escape") {
      e.preventDefault();
      hideCategoryAutocomplete();
    }
    // Enter is handled by the form's submit listener, which calls
    // acceptActiveSuggestion() before falling through to item creation.
  });

  menu.addEventListener("mousedown", (e) => {
    // mousedown (not click) so the input's blur doesn't close the popup
    // before the selection registers.
    const li = e.target.closest(".category-autocomplete-item");
    if (!li) return;
    e.preventDefault();
    acActiveIndex = Number(li.dataset.index);
    acceptActiveSuggestion();
    input.focus();
  });

  input.addEventListener("blur", () => {
    // Slight delay so a mousedown on the menu can run first.
    setTimeout(() => {
      if (document.activeElement !== input) hideCategoryAutocomplete();
    }, 100);
  });
}
