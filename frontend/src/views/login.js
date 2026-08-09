import { authApi } from "../api.js";
import { t } from "../i18n.js";

function template(error) {
  return `
    <div class="auth-shell">
      <form class="card auth-card" id="login-form">
        <div>
          <label>${t("auth.loginId")}</label>
          <input type="text" name="loginId" required autofocus />
        </div>
        <div>
          <label>${t("auth.password")}</label>
          <input type="password" name="password" required />
        </div>
        ${error ? `<div class="auth-error">${error}</div>` : ""}
        <button class="btn btn-primary" type="submit">${t("auth.loginSubmit")}</button>
      </form>
      <button class="btn" id="login-back">${t("auth.backToWelcome")}</button>
    </div>
  `;
}

export async function render(container, nav) {
  container.innerHTML = template();
  wireEvents(container, nav);
}

function wireEvents(container, nav) {
  container.querySelector("#login-back").addEventListener("click", () => nav.goTo("welcome"));

  container.querySelector("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await authApi.login({ loginId: form.loginId.value.trim(), password: form.password.value });
      nav.goTo("profiles");
    } catch (err) {
      container.innerHTML = template(err.message);
      wireEvents(container, nav);
    }
  });
}
