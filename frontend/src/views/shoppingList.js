import { shoppingListApi, pricesApi, uploadsApi } from "../api.js";
import { showError, showToast } from "../toast.js";
import { t, getLocale } from "../i18n.js";

let state = {
  items: [],
  estimate: { total_mad: 0, item_count: 0 },
  filter: "unpurchased", // "all" | "purchased" | "unpurchased"
  categories: [], // real category slugs from tracked price data (see pricesApi.categories)
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Same slug-to-label logic as prices.js's prettifyCategory — duplicated
// rather than shared, matching this codebase's per-view convention (each
// view already owns its own escapeHtml, etc.).
function prettifyCategory(term) {
  const known = t(`pr.cat.${term}`);
  if (known !== `pr.cat.${term}`) return known;
  return term
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const PRINT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>';

function sourceLabel(source) {
  if (source === "low_stock") return t("sl.sourceLowStock");
  if (source === "recipe") return t("sl.sourceRecipe");
  return source;
}

function sourceBadgeClass(source) {
  if (source === "recipe") return "badge-ok";
  if (source === "low_stock") return "badge-warning";
  return "badge";
}

async function loadItems() {
  const purchased = state.filter === "all" ? undefined : state.filter === "purchased";
  const [items, estimate] = await Promise.all([
    shoppingListApi.list(purchased),
    shoppingListApi.estimate(),
  ]);
  state.items = items;
  state.estimate = estimate;
}

function itemRowHtml(item) {
  return `
    <div class="card" data-id="${item.id}">
      <div class="card-row">
        <label style="display:flex;align-items:center;gap:0.6rem;flex:1">
          <input type="checkbox" data-action="toggle-purchased" ${item.is_purchased ? "checked" : ""} />
          ${
            item.image_url
              ? `<img class="sl-item-image" src="${escapeHtml(item.image_url)}" alt="" />`
              : ""
          }
          <div>
            <div class="card-title" style="${item.is_purchased ? "text-decoration:line-through;opacity:0.6" : ""}">
              ${escapeHtml(item.item_name)}
            </div>
            <div class="card-meta">
              ${item.quantity_needed != null ? `${item.quantity_needed} ${escapeHtml(item.unit || "")}` : ""}
              &middot; <span class="badge ${sourceBadgeClass(item.source)}">${escapeHtml(sourceLabel(item.source))}</span>
              ${item.estimated_price_mad != null ? `&middot; ${item.estimated_price_mad} MAD` : ""}
              ${item.category ? `&middot; ${escapeHtml(prettifyCategory(item.category))}` : ""}
            </div>
          </div>
        </label>
        <button class="btn btn-sm btn-danger" data-action="delete">${t("common.delete")}</button>
      </div>
    </div>
  `;
}

function printDateHtml() {
  const date = new Date().toLocaleDateString(getLocale() === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `<span class="print-date">${t("common.printedOn", { date })}</span>`;
}

function printChecklistHtml() {
  return `
    <div class="print-only">
      <div class="print-header">
        <h2>${t("nav.shoppingList")}</h2>
        ${printDateHtml()}
      </div>
      ${
        state.items.length
          ? `<table class="print-table">
              <thead>
                <tr>
                  <th class="print-col-check"></th>
                  <th class="print-col-image"></th>
                  <th>${t("sl.itemName")}</th>
                  <th>${t("sl.quantityNeeded")}</th>
                  <th>${t("common.unit")}</th>
                </tr>
              </thead>
              <tbody>
                ${state.items
                  .map(
                    (item) => `
                  <tr>
                    <td class="print-col-check"><span class="print-checkbox"></span></td>
                    <td class="print-col-image">${item.image_url ? `<img class="print-thumb" src="${escapeHtml(item.image_url)}" alt="" />` : ""}</td>
                    <td>${escapeHtml(item.item_name)}</td>
                    <td>${item.quantity_needed != null ? item.quantity_needed : "—"}</td>
                    <td>${escapeHtml(item.unit) || "—"}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>`
          : `<div class="print-empty">${t("sl.empty")}</div>`
      }
    </div>
  `;
}

function template() {
  return `
    <div class="card no-print" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div class="card-meta">${t("sl.estimatedTotal")}</div>
        <div class="card-title" style="font-size:1.3rem">${state.estimate.total_mad} MAD</div>
      </div>
      <div class="card-meta">${t("sl.itemCount", { count: state.estimate.item_count })}</div>
    </div>

    <div class="card-row no-print" style="margin-bottom:0.75rem;justify-content:space-between">
      <select id="sl-filter">
        <option value="unpurchased" ${state.filter === "unpurchased" ? "selected" : ""}>${t("sl.unpurchased")}</option>
        <option value="purchased" ${state.filter === "purchased" ? "selected" : ""}>${t("sl.purchased")}</option>
        <option value="all" ${state.filter === "all" ? "selected" : ""}>${t("sl.all")}</option>
      </select>
      <button type="button" class="btn btn-sm" id="sl-print-btn">${PRINT_ICON}<span>${t("common.print")}</span></button>
    </div>

    <form class="card no-print" id="sl-add-form">
      <div class="section-title">${t("common.addItem")}</div>
      <div class="form-row">
        <div class="autocomplete-wrap">
          <label>${t("sl.itemName")}</label>
          <input type="text" name="item_name" id="sl-item-name" autocomplete="off" required />
          <ul class="autocomplete-list" id="sl-suggestions" hidden></ul>
        </div>
      </div>
      <div class="form-row">
        <div><label>${t("sl.quantityNeeded")}</label><input type="number" step="any" name="quantity_needed" /></div>
        <div><label>${t("common.unit")}</label><input type="text" name="unit" /></div>
        <div><label>${t("sl.estPrice")}</label><input type="number" step="any" name="estimated_price_mad" /></div>
        <div>
          <label>${t("common.category")}</label>
          <input type="text" name="category" list="sl-category-suggestions" />
          <datalist id="sl-category-suggestions">
            ${state.categories.map((c) => `<option value="${escapeHtml(prettifyCategory(c.search_term))}"></option>`).join("")}
          </datalist>
        </div>
      </div>
      <div class="photo-input-row">
        <label>${t("common.photo")}</label>
        <input type="file" accept="image/*" capture="environment" id="sl-photo-input" />
        <img class="photo-input-preview" id="sl-photo-preview" hidden />
        <input type="hidden" name="image_url" />
      </div>
      <button class="btn btn-primary" type="submit">${t("common.addItem")}</button>
    </form>

    <div id="sl-list" class="no-print">
      ${
        state.items.length
          ? state.items.map(itemRowHtml).join("")
          : `<div class="empty-state">${t("sl.empty")}</div>`
      }
    </div>

    ${printChecklistHtml()}
  `;
}

export async function render(container) {
  container.innerHTML = `<div class="empty-state">${t("common.loading")}</div>`;
  try {
    await loadItems();
    state.categories = await pricesApi.categories();
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

// Suggests items from the tracked price database as the user types an item
// name, so picking one auto-fills unit + estimated price from the most
// recent scrape instead of the user guessing a price by hand.
function wireItemNameAutocomplete(container) {
  const input = container.querySelector("#sl-item-name");
  const list = container.querySelector("#sl-suggestions");
  const form = container.querySelector("#sl-add-form");
  let debounceTimer = null;
  let requestId = 0;
  let results = [];

  function closeList() {
    list.hidden = true;
    list.innerHTML = "";
    results = [];
  }

  function renderResults() {
    if (!results.length) {
      closeList();
      return;
    }
    list.innerHTML = results
      .map(
        (r, i) => `
        <li class="autocomplete-item" data-index="${i}">
          <span>${escapeHtml(r.product_title)}</span>
          <span class="autocomplete-item-price">${r.price_mad} MAD${r.unit ? ` / ${escapeHtml(r.unit)}` : ""}</span>
        </li>
      `
      )
      .join("");
    list.hidden = false;
  }

  input.addEventListener("input", () => {
    const term = input.value.trim();
    // The user is typing something new, so any image/price picked from a
    // previous suggestion no longer necessarily matches — clear it rather
    // than risk attaching a stale product's picture to a different item.
    form.image_url.value = "";
    clearTimeout(debounceTimer);
    if (term.length < 2) {
      closeList();
      return;
    }
    const thisRequest = ++requestId;
    debounceTimer = setTimeout(async () => {
      try {
        const matches = await pricesApi.suggest(term);
        if (thisRequest !== requestId) return; // a newer keystroke superseded this lookup
        results = matches;
        renderResults();
      } catch {
        if (thisRequest === requestId) closeList();
      }
    }, 300);
  });

  // mousedown (not click) fires before the input's blur handler closes the list
  list.addEventListener("mousedown", (e) => {
    const item = e.target.closest(".autocomplete-item");
    if (!item) return;
    const result = results[Number(item.dataset.index)];
    if (!result) return;
    input.value = result.product_title;
    if (!form.unit.value) form.unit.value = result.unit || "";
    form.estimated_price_mad.value = result.price_mad;
    form.image_url.value = result.image_url || "";
    closeList();
  });

  input.addEventListener("blur", () => setTimeout(closeList, 150));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeList();
  });
}

function wireEvents(container) {
  wireItemNameAutocomplete(container);

  container.querySelector("#sl-filter").addEventListener("change", (e) => {
    state.filter = e.target.value;
    refresh(container);
  });

  container.querySelector("#sl-print-btn").addEventListener("click", () => window.print());

  container.querySelector("#sl-photo-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = container.querySelector("#sl-add-form");
    const preview = container.querySelector("#sl-photo-preview");
    try {
      const { url } = await uploadsApi.upload(file);
      // A deliberately-taken photo is a stronger signal than an
      // autocomplete guess — overwrite whatever that may have set.
      form.image_url.value = url;
      preview.src = url;
      preview.hidden = false;
    } catch (err) {
      showError(err);
    }
  });

  container.querySelector("#sl-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
      item_name: form.item_name.value.trim(),
      category: form.category.value.trim() || undefined,
      quantity_needed: form.quantity_needed.value || 1,
      unit: form.unit.value.trim() || undefined,
      estimated_price_mad: form.estimated_price_mad.value || undefined,
      image_url: form.image_url.value || undefined,
    };
    try {
      await shoppingListApi.create(data);
      showToast(t("sl.itemAdded"));
      await refresh(container);
    } catch (err) {
      showError(err);
    }
  });

  container.querySelectorAll(".card[data-id]").forEach((card) => {
    const id = card.dataset.id;

    card.querySelector('[data-action="toggle-purchased"]').addEventListener("change", async (e) => {
      try {
        await shoppingListApi.update(id, { is_purchased: e.target.checked });
        showToast(e.target.checked ? t("sl.markedPurchased") : t("sl.markedUnpurchased"));
        await refresh(container);
      } catch (err) {
        showError(err);
      }
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm(t("sl.deleteConfirm"))) return;
      try {
        await shoppingListApi.remove(id);
        showToast(t("sl.itemDeleted"));
        await refresh(container);
      } catch (err) {
        showError(err);
      }
    });
  });
}
