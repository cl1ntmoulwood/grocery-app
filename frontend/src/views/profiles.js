import { authApi } from "../api.js";
import { showError } from "../toast.js";
import { t } from "../i18n.js";

let state = {
  mode: "pick", // "pick" | "add"
  profiles: [],
  pinTarget: null, // id of the profile currently showing inline PIN entry
  pinError: null,
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function profileTileHtml(profile) {
  return `
    <button type="button" class="profile-tile" data-id="${profile.id}" data-haspin="${profile.hasPin}">
      <span class="profile-tile-avatar" style="background:${escapeHtml(profile.avatarColor)}">${escapeHtml(profile.avatarEmoji)}</span>
      <span class="profile-tile-name">${escapeHtml(profile.name)}</span>
    </button>
  `;
}

function pinEntryHtml() {
  // dataset.id is always a string; profile.id comes back as a number from
  // the API, so compare as strings to avoid a silent type-mismatch miss.
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
          <label>${t("auth.pinOptional")}</label>
          <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" name="pin" />
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
    state.profiles = await authApi.listProfiles();
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
    await authApi.selectProfile(id, pin);
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
      try {
        await authApi.createProfile({
          name: form.name.value.trim(),
          avatarEmoji: form.avatarEmoji.value.trim() || undefined,
          avatarColor: form.avatarColor.value || undefined,
          pin: form.pin.value || undefined,
        });
        state.profiles = await authApi.listProfiles();
        state.mode = "pick";
        draw(container, nav);
      } catch (err) {
        container.innerHTML = addTemplate(err.message);
        wireEvents(container, nav);
      }
    });
    return;
  }

  container.querySelector("#add-profile-tile").addEventListener("click", () => {
    state.mode = "add";
    draw(container, nav);
  });

  container.querySelectorAll(".profile-tile[data-id]").forEach((tile) => {
    tile.addEventListener("click", () => {
      const id = tile.dataset.id;
      const hasPin = tile.dataset.haspin === "true";
      if (!hasPin) {
        selectProfile(container, nav, id, undefined);
      } else {
        state.pinTarget = id;
        state.pinError = null;
        draw(container, nav);
      }
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
