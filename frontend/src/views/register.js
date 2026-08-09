import { authApi } from "../api.js";
import { t } from "../i18n.js";

function template(error) {
  return `
    <div class="auth-shell">
      <form class="card auth-card" id="register-form">
        <div>
          <label>${t("auth.householdName")}</label>
          <input type="text" name="householdName" required autofocus />
        </div>
        <div>
          <label>${t("auth.loginId")}</label>
          <input type="text" name="loginId" required />
        </div>
        <div>
          <label>${t("auth.password")}</label>
          <input type="password" name="password" required minlength="8" />
        </div>
        <div>
          <label>${t("auth.confirmPassword")}</label>
          <input type="password" name="confirmPassword" required minlength="8" />
        </div>
        ${error ? `<div class="auth-error">${error}</div>` : ""}
        <button class="btn btn-primary" type="submit">${t("auth.registerSubmit")}</button>
      </form>
      <button class="btn" id="register-back">${t("auth.backToWelcome")}</button>
    </div>
  `;
}

export async function render(container, nav) {
  container.innerHTML = template();
  wireEvents(container, nav);
}

function wireEvents(container, nav) {
  container.querySelector("#register-back").addEventListener("click", () => nav.goTo("welcome"));

  container.querySelector("#register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;

    if (form.password.value !== form.confirmPassword.value) {
      container.innerHTML = template(t("auth.passwordMismatch"));
      wireEvents(container, nav);
      return;
    }
    if (form.password.value.length < 8) {
      container.innerHTML = template(t("auth.passwordTooShort"));
      wireEvents(container, nav);
      return;
    }

    try {
      await authApi.register({
        householdName: form.householdName.value.trim(),
        loginId: form.loginId.value.trim(),
        password: form.password.value,
      });
      nav.goTo("profiles");
    } catch (err) {
      container.innerHTML = template(err.message);
      wireEvents(container, nav);
    }
  });
}
