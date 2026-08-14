import { recipesApi } from "../api.js";
import { showError, showToast } from "../toast.js";
import { t, getLocale } from "../i18n.js";

let state = {
  mode: "list", // "list" | "detail" | "add"
  recipes: [],
  search: "",
  detail: null, // full recipe + ingredients + steps
  checkResult: null, // array from check-inventory
  suggestQuery: "",
  suggestResults: null, // null = not searched yet, [] = no matches, [...] = candidates
  suggestLoading: false,
  suggestImportingUrl: null,
  ytSearchOpen: false,
  ytQuery: "",
  ytResults: null, // null = not searched yet, [] = no matches, [...] = candidates
  ytLoading: false,
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

const PRINT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>';

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';

function statusBadge(status) {
  const cls = status === "ok" ? "badge-ok" : status === "insufficient" ? "badge-warning" : "badge-danger";
  return `<span class="badge ${cls}">${status.replace("_", " ")}</span>`;
}

// ---------------------------------------------------------------- list ----

function suggestResultsTemplate() {
  if (state.suggestResults === null) return "";
  if (state.suggestResults.length === 0) {
    return `<div class="empty-state" style="margin-top:0.5rem">${t("rec.suggestEmpty")}</div>`;
  }
  return `
    <div style="margin-top:0.5rem;display:flex;flex-direction:column;gap:0.4rem">
      ${state.suggestResults
        .map(
          (r) => `
        <div class="card-row" data-suggest-url="${escapeHtml(r.url)}" style="justify-content:space-between;align-items:center">
          <span>${escapeHtml(r.title_guess)}</span>
          <button class="btn btn-sm" type="button" data-action="import" ${state.suggestImportingUrl ? "disabled" : ""}>
            ${state.suggestImportingUrl === r.url ? t("common.loading") : t("rec.suggestImport")}
          </button>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function listTemplate() {
  return `
    <form class="price-search-form" id="rec-search-form">
      <div class="price-search-bar">
        ${SEARCH_ICON}
        <input type="text" name="search" placeholder="${t("rec.searchPlaceholder")}" value="${escapeHtml(state.search)}" />
      </div>
      <button class="btn btn-primary" type="submit">${t("rec.search")}</button>
    </form>
    <button class="btn btn-primary" id="rec-new-btn" style="margin-bottom:0.75rem">${t("rec.newRecipe")}</button>
    <div class="card no-print" style="margin-bottom:0.75rem">
      <div class="section-title">${t("rec.suggestTitle")}</div>
      <form id="rec-suggest-form" style="display:flex;gap:0.5rem">
        <input type="text" name="query" placeholder="${t("rec.suggestPlaceholder")}" value="${escapeHtml(state.suggestQuery)}" style="flex:1" />
        <button class="btn" type="submit" ${state.suggestLoading ? "disabled" : ""}>${state.suggestLoading ? t("common.loading") : t("rec.suggestLookup")}</button>
      </form>
      ${suggestResultsTemplate()}
    </div>
    ${
      state.recipes.length
        ? state.recipes
            .map(
              (r) => `
        <div class="card" data-id="${r.id}">
          <div class="card-row">
            ${r.image_url ? `<img class="rec-thumb" src="${escapeHtml(r.image_url)}" alt="" />` : ""}
            <div style="flex:1">
              <div class="card-title">${escapeHtml(r.title)}</div>
              <div class="card-meta">${r.servings ? t("rec.servings", { count: r.servings }) : ""}</div>
              ${r.description ? `<div class="card-meta rec-description">${escapeHtml(r.description)}</div>` : ""}
            </div>
            <button class="btn btn-sm" data-action="view">${t("rec.view")}</button>
          </div>
        </div>
      `
            )
            .join("")
        : `<div class="empty-state">${t("rec.empty")}</div>`
    }
  `;
}

async function renderList(container) {
  container.innerHTML = `<div class="empty-state">${t("common.loading")}</div>`;
  try {
    state.recipes = await recipesApi.list(state.search || undefined);
  } catch (err) {
    showError(err);
  }
  rerenderList(container);
}

function rerenderList(container) {
  container.innerHTML = listTemplate();
  wireListEvents(container);
}

function wireListEvents(container) {
  container.querySelector("#rec-search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    state.search = e.target.search.value.trim();
    renderList(container);
  });

  container.querySelector("#rec-new-btn").addEventListener("click", () => {
    state.mode = "add";
    renderView(container);
  });

  container.querySelectorAll(".card[data-id]").forEach((card) => {
    card.querySelector('[data-action="view"]').addEventListener("click", async () => {
      state.mode = "detail";
      await openDetail(container, card.dataset.id);
    });
  });

  container.querySelector("#rec-suggest-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = e.target.query.value.trim();
    if (!query) return;
    state.suggestQuery = query;
    state.suggestLoading = true;
    state.suggestResults = null;
    rerenderList(container);
    try {
      state.suggestResults = await recipesApi.lookup(query);
    } catch (err) {
      showError(err);
      state.suggestResults = null;
    } finally {
      state.suggestLoading = false;
      rerenderList(container);
    }
  });

  container.querySelectorAll("[data-suggest-url]").forEach((row) => {
    const url = row.dataset.suggestUrl;
    row.querySelector('[data-action="import"]').addEventListener("click", async () => {
      state.suggestImportingUrl = url;
      rerenderList(container);
      try {
        const recipe = await recipesApi.importByUrl(url);
        showToast(t("rec.suggestImported", { title: recipe.title }));
        state.suggestQuery = "";
        state.suggestResults = null;
        state.suggestImportingUrl = null;
        await renderList(container);
      } catch (err) {
        showError(err);
        state.suggestImportingUrl = null;
        rerenderList(container);
      }
    });
  });
}

// -------------------------------------------------------------- detail ----

async function openDetail(container, id) {
  container.innerHTML = `<div class="empty-state">${t("common.loading")}</div>`;
  state.checkResult = null;
  state.ytSearchOpen = false;
  state.ytQuery = "";
  state.ytResults = null;
  state.ytLoading = false;
  try {
    state.detail = await recipesApi.get(id);
  } catch (err) {
    showError(err);
    state.mode = "list";
    return renderView(container);
  }
  renderView(container);
}

function printDateHtml() {
  const date = new Date().toLocaleDateString(getLocale() === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `<span class="print-date">${t("common.printedOn", { date })}</span>`;
}

function printRecipeHtml(r) {
  return `
    <div class="print-only">
      <div class="print-header">
        <h2>${escapeHtml(r.title)}</h2>
        ${printDateHtml()}
      </div>
      ${r.image_url ? `<img class="rec-detail-image" src="${escapeHtml(r.image_url)}" alt="" />` : ""}
      ${r.servings ? `<div>${escapeHtml(t("rec.servings", { count: r.servings }))}</div>` : ""}
      ${r.description ? `<p>${escapeHtml(r.description)}</p>` : ""}
      ${
        r.ingredients.length
          ? `<table class="print-table">
              <thead>
                <tr>
                  <th class="print-col-check"></th>
                  <th>${t("rec.ingredients")}</th>
                  <th>${t("rec.qty")}</th>
                  <th>${t("common.unit")}</th>
                </tr>
              </thead>
              <tbody>
                ${r.ingredients
                  .map(
                    (ing) => `
                  <tr>
                    <td class="print-col-check"><span class="print-checkbox"></span></td>
                    <td>${escapeHtml(ing.ingredient_name)}</td>
                    <td>${ing.quantity_needed}</td>
                    <td>${escapeHtml(ing.unit) || "—"}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>`
          : ""
      }
      ${stepsOrInstructionsHtml(r, "print")}
    </div>
  `;
}

// Structured steps (scraped recipes) render as a numbered list; recipes
// with no steps (everything manually-added today) fall back to the plain
// `instructions` paragraph, unchanged from before this feature existed.
function stepsOrInstructionsHtml(r, mode) {
  const steps = r.steps || [];
  if (steps.length === 0) {
    return r.instructions ? `<p>${escapeHtml(r.instructions)}</p>` : "";
  }

  if (mode === "print") {
    return `<ol>${steps
      .map((s) => `<li>${s.name ? `<strong>${escapeHtml(s.name)}:</strong> ` : ""}${escapeHtml(s.text)}</li>`)
      .join("")}</ol>`;
  }

  return steps
    .map(
      (s) => `
    <div class="rec-step">
      <span class="rec-step-number">${s.step_number}</span>
      <div>
        ${s.name ? `<div class="rec-step-name">${escapeHtml(s.name)}</div>` : ""}
        <div>${escapeHtml(s.text)}</div>
      </div>
    </div>
  `
    )
    .join("");
}

function ytResultsTemplate() {
  if (state.ytResults === null) return "";
  if (state.ytResults.length === 0) {
    return `<div class="empty-state" style="margin-top:0.5rem">${t("rec.ytEmpty")}</div>`;
  }
  return `
    <div style="margin-top:0.5rem;display:flex;flex-direction:column;gap:0.4rem">
      ${state.ytResults
        .map(
          (v) => `
        <div class="card-row" data-yt-url="${escapeHtml(v.url)}" style="gap:0.5rem;align-items:center">
          ${v.thumbnailUrl ? `<img src="${escapeHtml(v.thumbnailUrl)}" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:4px;flex-shrink:0" />` : ""}
          <div style="flex:1">
            <div>${escapeHtml(v.title)}</div>
            <div class="card-meta">${escapeHtml(v.channelTitle)}</div>
          </div>
          <button class="btn btn-sm" type="button" data-action="use">${t("rec.useVideo")}</button>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function ytSearchPanelTemplate() {
  return `
    <form id="rec-yt-search-form" style="display:flex;gap:0.5rem;margin-top:0.5rem">
      <input type="text" name="query" value="${escapeHtml(state.ytQuery)}" style="flex:1" />
      <button class="btn btn-sm" type="submit" ${state.ytLoading ? "disabled" : ""}>${
    state.ytLoading ? t("common.loading") : t("rec.search")
  }</button>
    </form>
    ${ytResultsTemplate()}
  `;
}

function detailTemplate() {
  const r = state.detail;
  return `
    <button class="link-btn no-print" id="rec-back-btn">${t("rec.back")}</button>
    <div class="card no-print" style="margin-top:0.5rem">
      ${r.image_url ? `<img class="rec-detail-image" src="${escapeHtml(r.image_url)}" alt="" />` : ""}
      <div class="card-title" style="font-size:1.2rem">${escapeHtml(r.title)}</div>
      <div class="card-meta">${r.servings ? t("rec.servings", { count: r.servings }) : ""}</div>
      ${r.description ? `<p class="rec-description">${escapeHtml(r.description)}</p>` : ""}
    </div>

    <div class="card no-print">
      <div class="section-title">${t("rec.ingredients")}</div>
      ${
        r.ingredients.length
          ? r.ingredients
              .map((ing) => {
                const check = state.checkResult?.find((c) => c.ingredient_name === ing.ingredient_name);
                return `
            <div class="card-row" style="padding:0.25rem 0">
              <span>${escapeHtml(ing.ingredient_name)} &mdash; ${ing.quantity_needed} ${escapeHtml(ing.unit || "")}</span>
              ${check ? statusBadge(check.status) : ""}
            </div>
          `;
              })
              .join("")
          : `<div class="card-meta">${t("rec.noIngredients")}</div>`
      }
    </div>

    ${
      (r.steps && r.steps.length) || r.instructions
        ? `<div class="card no-print">
            <div class="section-title">${t("rec.steps")}</div>
            ${stepsOrInstructionsHtml(r, "screen")}
          </div>`
        : ""
    }

    <div class="card no-print">
      <div class="section-title">${t("rec.videoLink")}</div>
      <form id="rec-video-form" style="display:flex;gap:0.5rem;align-items:flex-end">
        <div style="flex:1">
          <input type="url" name="video_url" placeholder="${t("rec.videoLinkPlaceholder")}" value="${escapeHtml(r.video_url || "")}" />
        </div>
        <button class="btn btn-sm" type="submit">${t("common.save")}</button>
      </form>
      ${
        r.video_url
          ? `<a class="btn btn-sm" style="margin-top:0.5rem;display:inline-block" href="${escapeHtml(r.video_url)}" target="_blank" rel="noopener">${t("rec.watchVideo")}</a>`
          : ""
      }
      <div style="margin-top:0.5rem">
        <button class="btn btn-sm" type="button" id="rec-yt-toggle-btn">${t("rec.searchYoutube")}</button>
        ${state.ytSearchOpen ? ytSearchPanelTemplate() : ""}
      </div>
    </div>

    <div class="card-row no-print" style="gap:0.5rem">
      <button class="btn" id="rec-check-btn">${t("rec.checkInventory")}</button>
      <button class="btn" id="rec-genlist-btn">${t("rec.addMissing")}</button>
      <button class="btn" id="rec-print-btn">${PRINT_ICON}<span>${t("common.print")}</span></button>
      <button class="btn btn-danger" id="rec-delete-btn">${t("rec.deleteRecipe")}</button>
    </div>

    ${printRecipeHtml(r)}
  `;
}

function wireDetailEvents(container) {
  container.querySelector("#rec-back-btn").addEventListener("click", () => {
    state.mode = "list";
    renderView(container);
  });

  container.querySelector("#rec-print-btn").addEventListener("click", () => window.print());

  container.querySelector("#rec-video-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = e.target.elements.video_url;
    const value = input.value.trim();
    try {
      state.detail = await recipesApi.update(state.detail.id, { video_url: value || null });
      container.innerHTML = detailTemplate();
      wireDetailEvents(container);
      showToast(t("rec.videoLinkSaved"));
    } catch (err) {
      showError(err);
    }
  });

  container.querySelector("#rec-yt-toggle-btn").addEventListener("click", () => {
    state.ytSearchOpen = !state.ytSearchOpen;
    if (state.ytSearchOpen && !state.ytQuery) {
      state.ytQuery = state.detail.title;
    }
    container.innerHTML = detailTemplate();
    wireDetailEvents(container);
  });

  const ytSearchForm = container.querySelector("#rec-yt-search-form");
  if (ytSearchForm) {
    ytSearchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const query = e.target.query.value.trim();
      if (!query) return;
      state.ytQuery = query;
      state.ytLoading = true;
      state.ytResults = null;
      container.innerHTML = detailTemplate();
      wireDetailEvents(container);
      try {
        state.ytResults = await recipesApi.youtubeSearch(query);
      } catch (err) {
        showError(err);
        state.ytResults = null;
      } finally {
        state.ytLoading = false;
        container.innerHTML = detailTemplate();
        wireDetailEvents(container);
      }
    });
  }

  container.querySelectorAll("[data-yt-url]").forEach((row) => {
    const url = row.dataset.ytUrl;
    row.querySelector('[data-action="use"]').addEventListener("click", async () => {
      try {
        state.detail = await recipesApi.update(state.detail.id, { video_url: url });
        state.ytSearchOpen = false;
        state.ytResults = null;
        container.innerHTML = detailTemplate();
        wireDetailEvents(container);
        showToast(t("rec.videoLinkSaved"));
      } catch (err) {
        showError(err);
      }
    });
  });

  container.querySelector("#rec-check-btn").addEventListener("click", async () => {
    try {
      state.checkResult = await recipesApi.checkInventory(state.detail.id);
      container.innerHTML = detailTemplate();
      wireDetailEvents(container);
      showToast(t("rec.inventoryChecked"));
    } catch (err) {
      showError(err);
    }
  });

  container.querySelector("#rec-genlist-btn").addEventListener("click", async () => {
    try {
      const added = await recipesApi.generateList(state.detail.id);
      showToast(added.length ? t("rec.addedItems", { count: added.length }) : t("rec.nothingMissing"));
    } catch (err) {
      showError(err);
    }
  });

  container.querySelector("#rec-delete-btn").addEventListener("click", async () => {
    if (!confirm(t("rec.deleteConfirm"))) return;
    try {
      await recipesApi.remove(state.detail.id);
      showToast(t("rec.recipeDeleted"));
      state.mode = "list";
      renderView(container);
    } catch (err) {
      showError(err);
    }
  });
}

// ----------------------------------------------------------------- add ----

function addTemplate() {
  return `
    <button class="link-btn" id="rec-back-btn">${t("rec.back")}</button>
    <form class="card" id="rec-add-form" style="margin-top:0.5rem">
      <div class="section-title">${t("rec.newRecipeTitle")}</div>
      <div><label>${t("rec.title")}</label><input type="text" name="title" required /></div>
      <div class="form-row">
        <div><label>${t("rec.servingsLabel")}</label><input type="number" name="servings" /></div>
      </div>
      <div><label>${t("rec.instructions")}</label><textarea name="instructions"></textarea></div>

      <div class="section-title" style="margin-top:0.75rem">${t("rec.ingredients")}</div>
      <div id="rec-ingredients"></div>
      <button type="button" class="btn btn-sm" id="rec-add-ingredient">${t("rec.addIngredient")}</button>

      <button class="btn btn-primary" type="submit" style="margin-top:0.75rem">${t("rec.saveRecipe")}</button>
    </form>
  `;
}

function ingredientRowHtml() {
  return `
    <div class="ingredient-row">
      <input type="text" placeholder="${t("rec.ingredientName")}" data-field="ingredient_name" required />
      <input type="number" step="any" placeholder="${t("rec.qty")}" data-field="quantity_needed" required />
      <input type="text" placeholder="${t("common.unit")}" data-field="unit" />
      <button type="button" class="btn btn-sm btn-danger" data-action="remove-ingredient">&times;</button>
    </div>
  `;
}

function wireAddEvents(container) {
  const ingredientsEl = container.querySelector("#rec-ingredients");

  const addRow = () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = ingredientRowHtml();
    const row = wrapper.firstElementChild;
    row.querySelector('[data-action="remove-ingredient"]').addEventListener("click", () => row.remove());
    ingredientsEl.appendChild(row);
  };

  container.querySelector("#rec-back-btn").addEventListener("click", () => {
    state.mode = "list";
    renderView(container);
  });

  container.querySelector("#rec-add-ingredient").addEventListener("click", addRow);
  addRow(); // start with one row

  container.querySelector("#rec-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;

    const ingredients = [...ingredientsEl.children]
      .map((row) => ({
        ingredient_name: row.querySelector('[data-field="ingredient_name"]').value.trim(),
        quantity_needed: row.querySelector('[data-field="quantity_needed"]').value,
        unit: row.querySelector('[data-field="unit"]').value.trim() || undefined,
      }))
      .filter((i) => i.ingredient_name);

    const data = {
      title: form.title.value.trim(),
      servings: form.servings.value || undefined,
      instructions: form.instructions.value.trim() || undefined,
      ingredients,
    };

    try {
      await recipesApi.create(data);
      showToast(t("rec.recipeCreated"));
      state.mode = "list";
      renderView(container);
    } catch (err) {
      showError(err);
    }
  });
}

// --------------------------------------------------------------- router ---

function renderView(container) {
  if (state.mode === "detail" && state.detail) {
    container.innerHTML = detailTemplate();
    wireDetailEvents(container);
  } else if (state.mode === "add") {
    container.innerHTML = addTemplate();
    wireAddEvents(container);
  } else {
    state.mode = "list";
    renderList(container);
  }
}

export async function render(container) {
  state.mode = "list";
  await renderList(container);
}
