/**
 * Custom dropdown component (replaces native <select>).
 *
 * A dropdown is a `.dropdown` wrapper containing:
 *   - a `.dropdown-toggle` button with a `.dropdown-value` span + chevron
 *   - a `.dropdown-menu` <ul role="listbox"> of `.dropdown-item` <li data-value>
 *   - a hidden <input> that holds the selected value
 *
 * The hidden input keeps `.value` reads compatible with the existing form
 * submit paths. Value *writes* must go through setDropdownValue() so the
 * visible label stays in sync.
 */

/** @param {HTMLElement} wrapper */
function getParts(wrapper) {
  return {
    toggle: wrapper.querySelector(".dropdown-toggle"),
    valueEl: wrapper.querySelector(".dropdown-value"),
    menu: wrapper.querySelector(".dropdown-menu"),
    input: wrapper.querySelector('input[type="hidden"]'),
  };
}

/** Close the dropdown menu. */
export function closeDropdown(wrapper) {
  if (!wrapper) return;
  const { toggle, menu } = getParts(wrapper);
  wrapper.classList.remove("open");
  menu.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  menu
    .querySelectorAll(".dropdown-item.active")
    .forEach((el) => el.classList.remove("active"));
}

/** Open the dropdown menu and mark the selected (or first) item active. */
function openDropdown(wrapper) {
  if (!wrapper) return;
  const { toggle, menu } = getParts(wrapper);
  wrapper.classList.add("open");
  menu.hidden = false;
  toggle.setAttribute("aria-expanded", "true");
  const selected = menu.querySelector(".dropdown-item.selected");
  const active = selected || menu.querySelector(".dropdown-item");
  if (active) {
    menu
      .querySelectorAll(".dropdown-item.active")
      .forEach((el) => el.classList.remove("active"));
    active.classList.add("active");
    active.scrollIntoView({ block: "nearest" });
  }
}

function toggleDropdown(wrapper) {
  if (wrapper.classList.contains("open")) {
    closeDropdown(wrapper);
  } else {
    openDropdown(wrapper);
  }
}

/**
 * Set the dropdown's value: updates the hidden input, the `.selected`
 * marker, and copies the chosen item's content into the toggle label.
 * Falls back to the first item when `value` has no match.
 *
 * @param {HTMLElement} wrapper
 * @param {string} value
 */
export function setDropdownValue(wrapper, value) {
  if (!wrapper) return;
  const { valueEl, menu, input } = getParts(wrapper);
  const items = [...menu.querySelectorAll(".dropdown-item")];
  let match = items.find((el) => el.dataset.value === value);
  if (!match) match = items[0];
  items.forEach((el) => {
    const isSel = el === match;
    el.classList.toggle("selected", isSel);
    el.setAttribute("aria-selected", isSel ? "true" : "false");
  });
  if (match) {
    input.value = match.dataset.value;
    valueEl.innerHTML = match.innerHTML;
    // CSP-safe: --cat-color is not carried by innerHTML, so re-apply it from
    // data-color via CSSOM (mirrors applyCatColors in render.js).
    for (const el of valueEl.querySelectorAll("[data-color]")) {
      el.style.setProperty("--cat-color", el.dataset.color);
    }
  } else {
    input.value = "";
    valueEl.textContent = "";
  }
}

/**
 * Wire up a dropdown wrapper: toggle, selection, outside-click, keyboard.
 * Idempotent — guarded so repeated init calls are no-ops.
 *
 * @param {HTMLElement} wrapper
 * @param {(value: string) => void} [onSelect] - called after a user pick.
 */
export function initDropdown(wrapper, onSelect) {
  if (!wrapper || wrapper.dataset.ddInit === "1") return;
  wrapper.dataset.ddInit = "1";
  const { toggle, menu } = getParts(wrapper);

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown(wrapper);
  });

  menu.addEventListener("click", (e) => {
    const item = e.target.closest(".dropdown-item");
    if (!item) return;
    setDropdownValue(wrapper, item.dataset.value);
    closeDropdown(wrapper);
    toggle.focus();
    onSelect?.(item.dataset.value);
  });

  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) closeDropdown(wrapper);
  });

  const moveActive = (dir) => {
    const items = [...menu.querySelectorAll(".dropdown-item")];
    if (!items.length) return;
    const cur = menu.querySelector(".dropdown-item.active");
    let idx = cur ? items.indexOf(cur) : -1;
    idx = (idx + dir + items.length) % items.length;
    items.forEach((el) => el.classList.remove("active"));
    items[idx].classList.add("active");
    items[idx].scrollIntoView({ block: "nearest" });
  };

  toggle.addEventListener("keydown", (e) => {
    const isOpen = wrapper.classList.contains("open");
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (!isOpen) {
          openDropdown(wrapper);
        } else {
          const active = menu.querySelector(".dropdown-item.active");
          if (active) {
            setDropdownValue(wrapper, active.dataset.value);
            closeDropdown(wrapper);
            onSelect?.(active.dataset.value);
          }
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!isOpen) openDropdown(wrapper);
        else moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (isOpen) moveActive(-1);
        break;
      case "Escape":
        if (isOpen) {
          e.preventDefault();
          closeDropdown(wrapper);
        }
        break;
    }
  });
}
