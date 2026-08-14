import { authApi } from "../api.js";
import { showError } from "../toast.js";
import { t } from "../i18n.js";

// The "not admin" self-service path: every profile listed here is
// guaranteed (server-side, not just here) to be role='member' with a PIN
// already set — see backend/src/routes/auth.js's /member-profiles group.
// That means, unlike profiles.js, there's no PIN-less branch: every tile
// click always opens the inline PIN entry.

let state = {
  mode: "pick", // "pick" | "add"
  profiles: [],
  pinTarget: null,
  pinError: null,
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function profileTileHtml(profile) {
  return `
    <button type="button" class="profile-tile" data-id="${profile.id}">
      <span class="profile-tile-avatar" style="background:${escapeHtml(profile.avatarColor)}">${escapeHtml(profile.avatarEmoji)}</span>
      <span class="profile-tile-name">${escapeHtml(profile.name)}</span>
    </button>
  `;
}

function pinEntryHtml() {
  const profile = state.profiles.find((p) => String(p.id) === String(state.pinTarget));
  if (!profile) return "";
  return `
    <div class="pin-entry">
      <div>${t("auth.pinPrompt")} — ${escapeHtml(profile.name)}</div>
      <form id="pin-form">
        <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" name="pin" autofocus required />
        ${state.pinError ? `<div class="auth-error">${escapeHtml(state.pinError)}</div>` : ""}
        <button class="btn btn-primary btn-sm" type="submit">${t("auth.unlock")}</button>
        <button class="btn btn-sm" type="button" id="pin-cancel">${t("auth.cancel")}</button>
      </form>
    </div>
  `;
}

function pickTemplate() {
  return `
    <div class="auth-shell">
      <h2>${t("auth.pickProfile")}</h2>
      <div class="profile-grid">
        ${state.profiles.map(profileTileHtml).join("")}
        <button type="button" class="profile-tile profile-tile-add" id="add-profile-tile">
          <span class="profile-tile-avatar">+</span>
          <span class="profile-tile-name">${t("auth.addProfile")}</span>
        </button>
      </div>
      ${state.pinTarget ? pinEntryHtml() : ""}
      <button class="btn" id="member-back">${t("auth.backToWelcome")}</button>
    </div>
  `;
}

function addTemplate(error) {
  return `
    <div class="auth-shell">
      <form class="card auth-card" id="add-profile-form">
        <div>
          <label>${t("auth.profileName")}</label>
          <input type="text" name="name" required autofocus />
        </div>
        <div>
          <label>${t("auth.emoji")}</label>
          <input type="text" name="avatarEmoji" maxlength="2" value="🙂" />
        </div>
        <div>
          <label>${t("auth.color")}</label>
          <input type="color" name="avatarColor" value="#1f6f76" />
        </div>
        <div>
          <label>${t("auth.pinRequired")}</label>
          <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" name="pin" required />
        </div>
        ${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ""}
        <button class="btn btn-primary" type="submit">${t("auth.saveProfile")}</button>
        <button class="btn" type="button" id="add-profile-cancel">${t("auth.cancel")}</button>
      </form>
    </div>
  `;
}

export async function render(container, nav) {
  container.innerHTML = `<div class="empty-state">${t("common.loading")}</div>`;
  try {
    state.profiles = await authApi.listMemberProfiles();
  } catch (err) {
    showError(err);
    state.profiles = [];
  }
  state.mode = "pick";
  state.pinTarget = null;
  state.pinError = null;
  draw(container, nav);
}

function draw(container, nav) {
  container.innerHTML = state.mode === "add" ? addTemplate() : pickTemplate();
  wireEvents(container, nav);
}

async function selectProfile(container, nav, id, pin) {
  try {
    await authApi.selectMemberProfile(id, pin);
    nav.onAuthenticated();
  } catch (err) {
    if (err.status === 401) {
      state.pinTarget = id;
      state.pinError = err.message;
      draw(container, nav);
    } else {
      showError(err);
    }
  }
}

function wireEvents(container, nav) {
  if (state.mode === "add") {
    container.querySelector("#add-profile-cancel").addEventListener("click", () => {
      state.mode = "pick";
      draw(container, nav);
    });

    container.querySelector("#add-profile-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const pin = form.pin.value;
      try {
        const created = await authApi.createMemberProfile({
          name: form.name.value.trim(),
          avatarEmoji: form.avatarEmoji.value.trim() || undefined,
          avatarColor: form.avatarColor.value || undefined,
          pin,
        });
        // Self-service creation goes straight into the app with the PIN
        // just set — no reason to make them re-pick their own new tile.
        await authApi.selectMemberProfile(created.id, pin);
        nav.onAuthenticated();
      } catch (err) {
        container.innerHTML = addTemplate(err.message);
        wireEvents(container, nav);
      }
    });
    return;
  }

  container.querySelector("#member-back").addEventListener("click", () => nav.goTo("welcome"));

  container.querySelector("#add-profile-tile").addEventListener("click", () => {
    state.mode = "add";
    draw(container, nav);
  });

  container.querySelectorAll(".profile-tile[data-id]").forEach((tile) => {
    tile.addEventListener("click", () => {
      state.pinTarget = tile.dataset.id;
      state.pinError = null;
      draw(container, nav);
    });
  });

  const pinForm = container.querySelector("#pin-form");
  if (pinForm) {
    pinForm.addEventListener("submit", (e) => {
      e.preventDefault();
      selectProfile(container, nav, state.pinTarget, e.target.pin.value);
    });
    container.querySelector("#pin-cancel").addEventListener("click", () => {
      state.pinTarget = null;
      state.pinError = null;
      draw(container, nav);
    });
  }
}
