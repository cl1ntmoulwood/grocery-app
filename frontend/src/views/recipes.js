import { recipesApi } from "../api.js";
import { showError, showToast } from "../toast.js";
import { t } from "../i18n.js";

let state = {
  mode: "list", // "list" | "detail" | "add"
  recipes: [],
  detail: null, // full recipe + ingredients
  checkResult: null, // array from check-inventory
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

const PRINT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>';

function statusBadge(status) {
  const cls = status === "ok" ? "badge-ok" : status === "insufficient" ? "badge-warning" : "badge-danger";
  return `<span class="badge ${cls}">${status.replace("_", " ")}</span>`;
}

// ---------------------------------------------------------------- list ----

function listTemplate() {
  return `
    <button class="btn btn-primary" id="rec-new-btn" style="margin-bottom:0.75rem">${t("rec.newRecipe")}</button>
    ${
      state.recipes.length
        ? state.recipes
            .map(
              (r) => `
        <div class="card" data-id="${r.id}">
          <div class="card-row">
            <div>
              <div class="card-title">${escapeHtml(r.title)}</div>
              <div class="card-meta">${r.servings ? t("rec.servings", { count: r.servings }) : ""}</div>
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
    state.recipes = await recipesApi.list();
  } catch (err) {
    showError(err);
  }
  container.innerHTML = listTemplate();

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
}

// -------------------------------------------------------------- detail ----

async function openDetail(container, id) {
  container.innerHTML = `<div class="empty-state">${t("common.loading")}</div>`;
  state.checkResult = null;
  try {
    state.detail = await recipesApi.get(id);
  } catch (err) {
    showError(err);
    state.mode = "list";
    return renderView(container);
  }
  renderView(container);
}

function printRecipeHtml(r) {
  return `
    <div class="print-only">
      <h2>${escapeHtml(r.title)}</h2>
      ${r.servings ? `<div>${escapeHtml(t("rec.servings", { count: r.servings }))}</div>` : ""}
      <ul class="print-list">
        ${r.ingredients.map((ing) => `<li><span>${escapeHtml(ing.ingredient_name)} — ${ing.quantity_needed} ${escapeHtml(ing.unit || "")}</span></li>`).join("")}
      </ul>
      ${r.instructions ? `<p>${escapeHtml(r.instructions)}</p>` : ""}
    </div>
  `;
}

function detailTemplate() {
  const r = state.detail;
  return `
    <button class="link-btn no-print" id="rec-back-btn">${t("rec.back")}</button>
    <div class="card no-print" style="margin-top:0.5rem">
      <div class="card-title" style="font-size:1.2rem">${escapeHtml(r.title)}</div>
      <div class="card-meta">${r.servings ? t("rec.servings", { count: r.servings }) : ""}</div>
      ${r.instructions ? `<p>${escapeHtml(r.instructions)}</p>` : ""}
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
