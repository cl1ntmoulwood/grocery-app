import { inventoryApi } from "../api.js";
import { showError, showToast } from "../toast.js";

// Fixed, sensible household categories for the Add-item suggestion list —
// independent of scraped price data, which reflects a grocery site's own
// e-commerce browsing taxonomy (French, narrow), not how a family organizes
// a fridge/pantry. The field is still free text, so anything else works too.
const HOUSEHOLD_CATEGORIES = [
  "Dairy & Eggs",
  "Fruits & Vegetables",
  "Bakery",
  "Meat & Poultry",
  "Pantry",
  "Beverages",
  "Frozen",
  "Household",
];

let state = {
  items: [],
  category: "",
  lowStockOnly: false,
};

function isLowStock(item) {
  return Number(item.quantity) <= Number(item.low_threshold);
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
  return `
    <div class="card" data-id="${item.id}">
      <div class="card-row">
        <div>
          <div class="card-title">${escapeHtml(item.name)}
            ${lowStock ? '<span class="badge badge-warning">low stock</span>' : ""}
          </div>
          <div class="card-meta">${escapeHtml(item.category || "uncategorized")}</div>
        </div>
        <button class="btn btn-sm btn-danger" data-action="delete">Delete</button>
      </div>
      <div class="card-row" style="margin-top:0.5rem">
        <div class="form-row" style="align-items:flex-end">
          <div>
            <label>Quantity</label>
            <input type="number" step="any" data-field="quantity" value="${item.quantity}" />
          </div>
          <div>
            <label>Unit</label>
            <input type="text" data-field="unit" value="${escapeHtml(item.unit || "")}" />
          </div>
          <div>
            <label>Low threshold</label>
            <input type="number" step="any" data-field="low_threshold" value="${item.low_threshold}" />
          </div>
          <button class="btn btn-sm" data-action="save">Save</button>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function template() {
  const cats = categoryOptions();
  return `
    <div class="card-row" style="margin-bottom:0.75rem">
      <select id="inv-category">
        <option value="">All categories</option>
        ${cats.map((c) => `<option value="${escapeHtml(c)}" ${c === state.category ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
      <label style="display:flex;align-items:center;gap:0.35rem;white-space:nowrap">
        <input type="checkbox" id="inv-low-stock" ${state.lowStockOnly ? "checked" : ""} />
        Low stock only
      </label>
    </div>

    <form class="card" id="inv-add-form">
      <div class="section-title">Add item</div>
      <div class="form-row">
        <div><label>Name</label><input type="text" name="name" required /></div>
        <div>
          <label>Category</label>
          <input type="text" name="category" list="inv-category-suggestions" placeholder="e.g. Pantry" />
          <datalist id="inv-category-suggestions">
            ${HOUSEHOLD_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("")}
          </datalist>
        </div>
      </div>
      <div class="form-row">
        <div><label>Quantity</label><input type="number" step="any" name="quantity" required /></div>
        <div><label>Unit</label><input type="text" name="unit" /></div>
        <div><label>Low threshold</label><input type="number" step="any" name="low_threshold" /></div>
      </div>
      <button class="btn btn-primary" type="submit">Add item</button>
    </form>

    <div id="inv-list">
      ${
        state.items.length
          ? state.items.map(itemRowHtml).join("")
          : '<div class="empty-state">No inventory items yet.</div>'
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
  container.querySelector("#inv-category").addEventListener("change", (e) => {
    state.category = e.target.value;
    refresh(container);
  });

  container.querySelector("#inv-low-stock").addEventListener("change", (e) => {
    state.lowStockOnly = e.target.checked;
    refresh(container);
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
    };
    try {
      await inventoryApi.create(data);
      showToast("Item added");
      await refresh(container);
    } catch (err) {
      showError(err);
    }
  });

  container.querySelectorAll(".card[data-id]").forEach((card) => {
    const id = card.dataset.id;

    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm("Delete this item?")) return;
      try {
        await inventoryApi.remove(id);
        showToast("Item deleted");
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
        showToast("Item updated");
        await refresh(container);
      } catch (err) {
        showError(err);
      }
    });
  });
}
