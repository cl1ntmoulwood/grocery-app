import { t } from "../i18n.js";

export async function render(container, nav) {
  container.innerHTML = `
    <div class="auth-shell">
      <p class="auth-tagline">${t("auth.tagline")}</p>
      <div class="auth-actions">
        <button class="btn btn-primary" id="welcome-login">${t("auth.logIn")}</button>
        <button class="btn" id="welcome-register">${t("auth.createHousehold")}</button>
      </div>
    </div>
  `;

  container.querySelector("#welcome-login").addEventListener("click", () => nav.goTo("login"));
  container.querySelector("#welcome-register").addEventListener("click", () => nav.goTo("register"));
}
