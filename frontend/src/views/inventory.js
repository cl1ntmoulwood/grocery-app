import { inventoryApi, uploadsApi } from "../api.js";
import { showError, showToast } from "../toast.js";
import { t, getLocale } from "../i18n.js";

// Fixed, sensible household categories for the Add-item suggestion list —
// independent of scraped price data, which reflects a grocery site's own
// e-commerce browsing taxonomy (French, narrow), not how a family organizes
// a fridge/pantry. The field is still free text, so anything else works too.
const HOUSEHOLD_CATEGORY_KEYS = [
  "inv.cat.dairyEggs",
  "inv.cat.fruitsVegetables",
  "inv.cat.bakery",
  "inv.cat.meatPoultry",
  "inv.cat.pantry",
  "inv.cat.beverages",
  "inv.cat.frozen",
  "inv.cat.household",
];

let state = {
  items: [],
  category: "",
  lowStockOnly: false,
};

const ALERT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

const PLUS_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

const PRINT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>';

function isLowStock(item) {
  return Number(item.quantity) <= Number(item.low_threshold);
}

// A stricter tier than "low stock": less than half of threshold remains,
// so it gets the red/critical treatment instead of amber/warning.
function isCritical(item) {
  return Number(item.quantity) <= Number(item.low_threshold) * 0.5;
}

async function loadItems() {
  state.items = state.lowStockOnly
    ? await inventoryApi.lowStock()
    : await inventoryApi.list(state.category || undefined);
}

function categoryOptions() {
  const cats = [...new Set(state.items.map((i) => i.category).filter(Boolean))].sort();
  return cats;
}

function itemRowHtml(item) {
  const lowStock = isLowStock(item);
  const critical = isCritical(item);
  const statusIcon = lowStock
    ? `<span class="qty-status ${critical ? "is-critical" : "is-warning"}">${ALERT_ICON}</span>`
    : "";
  const qtyInputClass = lowStock ? `has-status ${critical ? "input-critical" : "input-warning"}` : "";

  return `
    <div class="inv-row" data-id="${item.id}">
      <div class="inv-cell inv-cell-name">
        ${item.image_url ? `<img class="inv-thumb" src="${escapeHtml(item.image_url)}" alt="" />` : ""}
        <div>
          <div class="card-title">${escapeHtml(item.name)}</div>
          <div class="card-meta">${escapeHtml(item.category) || t("common.uncategorized")}</div>
        </div>
      </div>
      <div class="inv-cell">
        <label class="inv-cell-label">${t("common.quantity")}</label>
        <div class="qty-field">
          ${statusIcon}
          <input type="number" step="any" data-field="quantity" value="${item.quantity}" class="${qtyInputClass}" />
        </div>
      </div>
      <div class="inv-cell">
        <label class="inv-cell-label">${t("common.unit")}</label>
        <input type="text" data-field="unit" value="${escapeHtml(item.unit || "")}" />
      </div>
      <div class="inv-cell">
        <label class="inv-cell-label">${t("inv.lowThreshold")}</label>
        <input type="number" step="any" data-field="low_threshold" value="${item.low_threshold}" />
      </div>
      <div class="inv-cell inv-actions-cell">
        <button class="btn btn-sm btn-primary" data-action="save">${t("common.save")}</button>
        <button class="btn btn-sm btn-danger" data-action="delete">${t("common.delete")}</button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function printDateHtml() {
  const date = new Date().toLocaleDateString(getLocale() === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `<span class="print-date">${t("common.printedOn", { date })}</span>`;
}

function printListHtml() {
  return `
    <div class="print-only">
      <div class="print-header">
        <h2>${t("nav.inventory")}</h2>
        ${printDateHtml()}
      </div>
      ${
        state.items.length
          ? `<table class="print-table">
              <thead>
                <tr>
                  <th class="print-col-image"></th>
                  <th>${t("inv.columnItem")}</th>
                  <th>${t("common.category")}</th>
                  <th>${t("common.quantity")}</th>
                  <th>${t("common.unit")}</th>
                  <th>${t("inv.lowThreshold")}</th>
                </tr>
              </thead>
              <tbody>
                ${state.items
                  .map(
                    (item) => `
                  <tr class="${isLowStock(item) ? "print-low-stock" : ""}">
                    <td class="print-col-image">${item.image_url ? `<img class="print-thumb" src="${escapeHtml(item.image_url)}" alt="" />` : ""}</td>
                    <td>${escapeHtml(item.name)}</td>
                    <td>${escapeHtml(item.category) || "—"}</td>
                    <td>${item.quantity}</td>
                    <td>${escapeHtml(item.unit) || "—"}</td>
                    <td>${item.low_threshold}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>`
          : `<div class="print-empty">${t("inv.empty")}</div>`
      }
    </div>
  `;
}

function template() {
  const cats = categoryOptions();
  return `
    <div class="inv-toolbar no-print">
      <select id="inv-category">
        <option value="">${t("inv.allCategories")}</option>
        ${cats.map((c) => `<option value="${escapeHtml(c)}" ${c === state.category ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
      <label class="switch-label">
        <span class="switch">
          <input type="checkbox" id="inv-low-stock" ${state.lowStockOnly ? "checked" : ""} />
          <span class="switch-track"></span>
        </span>
        ${t("inv.lowStockOnly")}
      </label>
      <button type="button" class="btn btn-sm" id="inv-print-btn">${PRINT_ICON}<span>${t("common.print")}</span></button>
    </div>

    <form class="card no-print" id="inv-add-form">
      <div class="section-title">${t("common.addItem")}</div>
      <div class="form-row">
        <div><label>${t("common.name")}</label><input type="text" name="name" required /></div>
        <div>
          <label>${t("common.category")}</label>
          <input type="text" name="category" list="inv-category-suggestions" placeholder="${t("inv.categoryPlaceholder")}" />
          <datalist id="inv-category-suggestions">
            ${HOUSEHOLD_CATEGORY_KEYS.map((key) => `<option value="${escapeHtml(t(key))}"></option>`).join("")}
          </datalist>
        </div>
      </div>
      <div class="form-row">
        <div><label>${t("common.quantity")}</label><input type="number" step="any" name="quantity" required /></div>
        <div><label>${t("common.unit")}</label><input type="text" name="unit" /></div>
        <div><label>${t("inv.lowThreshold")}</label><input type="number" step="any" name="low_threshold" /></div>
      </div>
      <div class="photo-input-row">
        <label>${t("common.photo")}</label>
        <input type="file" accept="image/*" capture="environment" id="inv-photo-input" />
        <img class="photo-input-preview" id="inv-photo-preview" hidden />
        <input type="hidden" name="image_url" />
      </div>
      <button class="btn btn-primary" type="submit">${PLUS_ICON}<span>${t("common.addItem")}</span></button>
    </form>

    <div id="inv-list" class="no-print">
      ${
        state.items.length
          ? `<div class="inv-list-header">
              <div>${t("inv.columnItem")}</div>
              <div>${t("common.quantity")}</div>
              <div>${t("common.unit")}</div>
              <div>${t("inv.lowThreshold")}</div>
              <div></div>
            </div>` + state.items.map(itemRowHtml).join("")
          : `<div class="empty-state">${t("inv.empty")}</div>`
      }
    </div>

    ${printListHtml()}
  `;
}

export async function render(container) {
  container.innerHTML = `<div class="empty-state">${t("common.loading")}</div>`;
  try {
    await loadItems();
  } catch (err) {
    showError(err);
  }
  container.innerHTML = template();
  wireEvents(container);
}

async function refresh(container) {
  try {
    await loadItems();
  } catch (err) {
    showError(err);
    return;
  }
  container.innerHTML = template();
  wireEvents(container);
}

function wireEvents(container) {
  container.querySelector("#inv-category").addEventListener("change", (e) => {
    state.category = e.target.value;
    refresh(container);
  });

  container.querySelector("#inv-low-stock").addEventListener("change", (e) => {
    state.lowStockOnly = e.target.checked;
    refresh(container);
  });

  container.querySelector("#inv-print-btn").addEventListener("click", () => window.print());

  container.querySelector("#inv-photo-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = container.querySelector("#inv-add-form");
    const preview = container.querySelector("#inv-photo-preview");
    try {
      const { url } = await uploadsApi.upload(file);
      form.image_url.value = url;
      preview.src = url;
      preview.hidden = false;
    } catch (err) {
      showError(err);
    }
  });

  container.querySelector("#inv-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
      name: form.name.value.trim(),
      category: form.category.value.trim() || undefined,
      quantity: form.quantity.value,
      unit: form.unit.value.trim() || undefined,
      low_threshold: form.low_threshold.value || undefined,
      image_url: form.image_url.value || undefined,
    };
    try {
      await inventoryApi.create(data);
      showToast(t("inv.itemAdded"));
      await refresh(container);
    } catch (err) {
      showError(err);
    }
  });

  container.querySelectorAll(".inv-row[data-id]").forEach((card) => {
    const id = card.dataset.id;

    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm(t("inv.deleteConfirm"))) return;
      try {
        await inventoryApi.remove(id);
        showToast(t("inv.itemDeleted"));
        await refresh(container);
      } catch (err) {
        showError(err);
      }
    });

    card.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const data = {
        quantity: card.querySelector('[data-field="quantity"]').value,
        unit: card.querySelector('[data-field="unit"]').value || undefined,
        low_threshold: card.querySelector('[data-field="low_threshold"]').value,
      };
      try {
        await inventoryApi.update(id, data);
        showToast(t("inv.itemUpdated"));
        await refresh(container);
      } catch (err) {
        showError(err);
      }
    });
  });
}
