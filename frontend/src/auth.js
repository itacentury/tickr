/**
 * Client-side login gate.
 *
 * The app shell is always served publicly; only the data/API routes are
 * protected server-side. This module checks the session, renders a login
 * view when needed (built via the DOM API — no inline scripts, since the CSP
 * forbids `unsafe-inline`), and exposes a logout helper.
 */

/**
 * Fetch the current auth status.
 *
 * @returns {Promise<{authed: boolean, enabled: boolean}>}
 *   `authed` — whether the user may use the app.
 *   `enabled` — whether the password gate is active at all (drives the logout UI).
 */
export async function getAuthStatus() {
  try {
    const response = await fetch("/api/v1/auth/me");
    if (!response.ok) return { authed: false, enabled: true };
    const data = await response.json();
    return { authed: data.authed === true, enabled: data.enabled === true };
  } catch {
    // Offline / network error: let the app try to start (offline-first PWA).
    // Protected requests will surface a 401 later and re-trigger the gate.
    return { authed: true, enabled: false };
  }
}

/**
 * Log out: clear the server session cookie.
 *
 * @returns {Promise<void>}
 */
export async function logout() {
  try {
    await fetch("/api/v1/auth/logout", { method: "POST" });
  } catch {
    // Ignore network errors — the cookie may already be gone.
  }
}

/**
 * Render the login view, replacing the app UI until login succeeds.
 *
 * @param {() => void} onSuccess - Called once after a successful login.
 */
export function renderLoginView(onSuccess) {
  // Hide the app shell while the gate is shown.
  const appEl = document.querySelector(".app");
  if (appEl) appEl.style.display = "none";

  // Reuse an existing gate if present (e.g. session expired mid-session).
  document.getElementById("authGate")?.remove();

  const gate = document.createElement("div");
  gate.id = "authGate";
  gate.className = "auth-gate";

  const card = document.createElement("form");
  card.className = "auth-card";
  card.noValidate = true;

  const title = document.createElement("h1");
  title.className = "auth-title";
  title.textContent = "Tickr";

  const subtitle = document.createElement("p");
  subtitle.className = "auth-subtitle";
  subtitle.textContent = "Enter your password to continue";

  const passwordWrap = document.createElement("div");
  passwordWrap.className = "auth-password";

  const passwordInput = document.createElement("input");
  passwordInput.type = "password";
  passwordInput.className = "auth-input";
  passwordInput.placeholder = "Password";
  passwordInput.autocomplete = "current-password";
  passwordInput.required = true;

  const EYE_OPEN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "auth-password-toggle";
  toggle.setAttribute("aria-label", "Passwort anzeigen (gedrückt halten)");
  toggle.innerHTML = EYE_OPEN;

  // Passwort nur sichtbar, solange der Button gedrückt gehalten wird.
  const show = () => {
    passwordInput.type = "text";
    toggle.innerHTML = EYE_OFF;
  };
  const hide = () => {
    passwordInput.type = "password";
    toggle.innerHTML = EYE_OPEN;
  };

  toggle.addEventListener("pointerdown", show);
  toggle.addEventListener("pointerup", hide);
  toggle.addEventListener("pointerleave", hide);
  toggle.addEventListener("pointercancel", hide);
  toggle.addEventListener("blur", hide);
  toggle.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      show();
    }
  });
  toggle.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") {
      hide();
    }
  });

  passwordWrap.appendChild(passwordInput);
  passwordWrap.appendChild(toggle);

  const rememberLabel = document.createElement("label");
  rememberLabel.className = "auth-remember";
  const rememberCheckbox = document.createElement("input");
  rememberCheckbox.type = "checkbox";
  const rememberText = document.createElement("span");
  rememberText.textContent = "Stay signed in for 30 days";
  rememberLabel.appendChild(rememberCheckbox);
  rememberLabel.appendChild(rememberText);

  const error = document.createElement("p");
  error.className = "auth-error";
  error.hidden = true;

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "auth-submit";
  submit.textContent = "Sign in";

  card.appendChild(title);
  card.appendChild(subtitle);
  card.appendChild(passwordWrap);
  card.appendChild(rememberLabel);
  card.appendChild(error);
  card.appendChild(submit);
  gate.appendChild(card);
  document.body.appendChild(gate);

  passwordInput.focus();

  card.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = "Signing in…";

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: passwordInput.value,
          remember: rememberCheckbox.checked,
        }),
      });

      if (!response.ok) {
        error.textContent = "Invalid password";
        error.hidden = false;
        passwordInput.select();
        return;
      }

      gate.remove();
      if (appEl) appEl.style.display = "";
      onSuccess();
    } catch {
      error.textContent = "Network error — please try again";
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  });
}
