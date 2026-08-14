import { t } from "../i18n.js";

export async function render(container, nav) {
  container.innerHTML = `
    <div class="auth-shell">
      <p class="auth-tagline">${t("auth.tagline")}</p>
      <div class="auth-actions">
        <button class="btn btn-primary" id="welcome-admin">${t("auth.iAmAdmin")}</button>
        <button class="btn" id="welcome-member">${t("auth.iAmFamilyMember")}</button>
      </div>
    </div>
  `;

  container.querySelector("#welcome-admin").addEventListener("click", () => nav.goTo("login"));
  container.querySelector("#welcome-member").addEventListener("click", () => nav.goTo("memberAccess"));
}
