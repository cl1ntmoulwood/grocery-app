import { shoppingListApi, pricesApi } from "../api.js";
import { showError, showToast } from "../toast.js";
import { t } from "../i18n.js";

let state = {
  items: [],
  estimate: { total_mad: 0, item_count: 0 },
  filter: "unpurchased", // "all" | "purchased" | "unpurchased"
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

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
          <div>
            <div class="card-title" style="${item.is_purchased ? "text-decoration:line-through;opacity:0.6" : ""}">
              ${escapeHtml(item.item_name)}
            </div>
            <div class="card-meta">
              ${item.quantity_needed ?? "?"} ${escapeHtml(item.unit || "")}
              &middot; <span class="badge ${sourceBadgeClass(item.source)}">${escapeHtml(sourceLabel(item.source))}</span>
              ${item.estimated_price_mad != null ? `&middot; ${item.estimated_price_mad} MAD` : ""}
            </div>
          </div>
        </label>
        <button class="btn btn-sm btn-danger" data-action="delete">${t("common.delete")}</button>
      </div>
    </div>
  `;
}

function template() {
  return `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div class="card-meta">${t("sl.estimatedTotal")}</div>
        <div class="card-title" style="font-size:1.3rem">${state.estimate.total_mad} MAD</div>
      </div>
      <div class="card-meta">${t("sl.itemCount", { count: state.estimate.item_count })}</div>
    </div>

    <div class="card-row" style="margin-bottom:0.75rem">
      <select id="sl-filter">
        <option value="unpurchased" ${state.filter === "unpurchased" ? "selected" : ""}>${t("sl.unpurchased")}</option>
        <option value="purchased" ${state.filter === "purchased" ? "selected" : ""}>${t("sl.purchased")}</option>
        <option value="all" ${state.filter === "all" ? "selected" : ""}>${t("sl.all")}</option>
      </select>
    </div>

    <form class="card" id="sl-add-form">
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
      </div>
      <button class="btn btn-primary" type="submit">${t("common.addItem")}</button>
    </form>

    <div id="sl-list">
      ${
        state.items.length
          ? state.items.map(itemRowHtml).join("")
          : `<div class="empty-state">${t("sl.empty")}</div>`
      }
    </div>
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

  container.querySelector("#sl-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
      item_name: form.item_name.value.trim(),
      quantity_needed: form.quantity_needed.value || undefined,
      unit: form.unit.value.trim() || undefined,
      estimated_price_mad: form.estimated_price_mad.value || undefined,
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
