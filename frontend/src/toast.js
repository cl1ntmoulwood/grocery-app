import { t } from "./i18n.js";

const el = document.getElementById("toast");
let hideTimer = null;

export function showToast(message, { isError = false } = {}) {
  el.textContent = message;
  el.classList.toggle("is-error", isError);
  el.hidden = false;

  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.hidden = true;
  }, 3000);
}

export function showError(err) {
  showToast(err?.message || t("common.somethingWrong"), { isError: true });
}
