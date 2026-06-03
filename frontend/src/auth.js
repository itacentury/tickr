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

  const passwordInput = document.createElement("input");
  passwordInput.type = "password";
  passwordInput.className = "auth-input";
  passwordInput.placeholder = "Password";
  passwordInput.autocomplete = "current-password";
  passwordInput.required = true;

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
  card.appendChild(passwordInput);
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
