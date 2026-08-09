import { shoppingListApi } from "../api.js";
import { showError, showToast } from "../toast.js";

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
  return source === "low_stock" ? "low stock" : source;
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
        <button class="btn btn-sm btn-danger" data-action="delete">Delete</button>
      </div>
    </div>
  `;
}

function template() {
  return `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div class="card-meta">Estimated total (unpurchased)</div>
        <div class="card-title" style="font-size:1.3rem">${state.estimate.total_mad} MAD</div>
      </div>
      <div class="card-meta">${state.estimate.item_count} item(s)</div>
    </div>

    <div class="card-row" style="margin-bottom:0.75rem">
      <select id="sl-filter">
        <option value="unpurchased" ${state.filter === "unpurchased" ? "selected" : ""}>Unpurchased</option>
        <option value="purchased" ${state.filter === "purchased" ? "selected" : ""}>Purchased</option>
        <option value="all" ${state.filter === "all" ? "selected" : ""}>All</option>
      </select>
    </div>

    <form class="card" id="sl-add-form">
      <div class="section-title">Add item</div>
      <div class="form-row">
        <div><label>Item name</label><input type="text" name="item_name" required /></div>
      </div>
      <div class="form-row">
        <div><label>Quantity needed</label><input type="number" step="any" name="quantity_needed" /></div>
        <div><label>Unit</label><input type="text" name="unit" /></div>
        <div><label>Est. price (MAD)</label><input type="number" step="any" name="estimated_price_mad" /></div>
      </div>
      <button class="btn btn-primary" type="submit">Add item</button>
    </form>

    <div id="sl-list">
      ${
        state.items.length
          ? state.items.map(itemRowHtml).join("")
          : '<div class="empty-state">Nothing here.</div>'
      }
    </div>
  `;
}

export async function render(container) {
  container.innerHTML = '<div class="empty-state">Loading…</div>';
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
      showToast("Item added");
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
        showToast(e.target.checked ? "Marked purchased" : "Marked unpurchased");
        await refresh(container);
      } catch (err) {
        showError(err);
      }
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm("Delete this item?")) return;
      try {
        await shoppingListApi.remove(id);
        showToast("Item deleted");
        await refresh(container);
      } catch (err) {
        showError(err);
      }
    });
  });
}
