import { pricesApi } from "../api.js";
import { showError } from "../toast.js";
import { renderPriceChart } from "../priceChart.js";
import { t } from "../i18n.js";

let state = {
  term: "",
  results: [],
  searched: false,
  expanded: null, // product_title currently showing history
  categories: [],
  activeCategory: null,
};

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';

const PRINT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>';

// Known bringo.ma category slugs get a real display name from i18n
// (pr.cat.*, see i18n.js) since naively title-casing the slug reads badly
// (e.g. "eaux-boissons" -> "Eaux Boissons" instead of "Water & Soft
// Drinks"). Falls back to title-casing the raw slug for anything not in
// that list, so an unrecognized/future category still gets a label
// instead of breaking.
function prettifyCategory(term) {
  const known = t(`pr.cat.${term}`);
  if (known !== `pr.cat.${term}`) return known;
  return term
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return t("pr.today");
  if (days === 1) return t("pr.yesterday");
  if (days < 30) return t("pr.daysAgo", { days });
  return new Date(iso).toLocaleDateString();
}

function categoryTileHtml(cat) {
  const isActive = state.activeCategory === cat.search_term;
  return `
    <button type="button" class="price-category-tile ${isActive ? "is-active" : ""}" data-term="${escapeHtml(cat.search_term)}">
      ${
        cat.image_url
          ? `<img src="${escapeHtml(cat.image_url)}" alt="" />`
          : '<span class="price-category-tile-placeholder"></span>'
      }
      <span>${escapeHtml(prettifyCategory(cat.search_term))}</span>
    </button>
  `;
}

function resultTileHtml(item) {
  return `
    <div class="price-tile" data-title="${escapeHtml(item.product_title)}">
      ${
        item.image_url
          ? `<img class="price-tile-image" src="${escapeHtml(item.image_url)}" alt="" />`
          : '<div class="price-tile-image price-tile-image-placeholder"></div>'
      }
      <div class="price-tile-body">
        <div class="price-tile-title">${escapeHtml(item.product_title)}</div>
        <div class="price-tile-price">${item.price_mad} MAD${item.unit ? ` <span class="price-tile-unit">/ ${escapeHtml(item.unit)}</span>` : ""}</div>
        <div class="price-tile-meta">
          ${t("pr.asOf", { time: timeAgo(item.scraped_at) })}
          ${item.product_url ? ` &middot; <a href="${escapeHtml(item.product_url)}" target="_blank" rel="noopener">${t("pr.viewListing")}</a>` : ""}
        </div>
        <div class="price-tile-actions">
          <button class="btn btn-sm" data-action="toggle-history">${t("pr.history")}</button>
        </div>
        <div class="price-history-panel" style="display:none;margin-top:0.5rem"></div>
      </div>
    </div>
  `;
}

function printResultsHtml() {
  if (!state.results.length) return "";
  return `
    <div class="print-only">
      <h2>${escapeHtml(state.term)}</h2>
      <ul class="print-list">
        ${state.results
          .map(
            (item) => `
          <li>
            <span>${escapeHtml(item.product_title)} — ${item.price_mad} MAD${item.unit ? ` / ${escapeHtml(item.unit)}` : ""}</span>
          </li>
        `
          )
          .join("")}
      </ul>
    </div>
  `;
}

function template() {
  return `
    <form class="price-search-form no-print" id="prices-search-form">
      <div class="price-search-bar">
        ${SEARCH_ICON}
        <input type="text" name="term" placeholder="${t("pr.searchPlaceholder")}" value="${escapeHtml(state.term)}" required />
      </div>
      <button class="btn btn-primary" type="submit">${t("pr.search")}</button>
      ${state.results.length ? `<button type="button" class="btn btn-sm" id="prices-print-btn">${PRINT_ICON}<span>${t("common.print")}</span></button>` : ""}
    </form>

    ${
      state.categories.length
        ? `<div class="price-categories no-print">${state.categories.map(categoryTileHtml).join("")}</div>`
        : ""
    }

    <div id="prices-results" class="no-print">
      ${
        !state.searched
          ? `<div class="empty-state">${t("pr.emptyPrompt")}</div>`
          : state.results.length
            ? `<div class="price-grid">${state.results.map(resultTileHtml).join("")}</div>`
            : `<div class="empty-state">${t("pr.noData", { term: escapeHtml(state.term) })}</div>`
      }
    </div>

    ${printResultsHtml()}
  `;
}

export async function render(container) {
  container.innerHTML = template();
  wireEvents(container);
  try {
    state.categories = await pricesApi.categories();
  } catch (err) {
    showError(err);
    return;
  }
  container.innerHTML = template();
  wireEvents(container);
}

async function search(container) {
  state.searched = true;
  state.expanded = null;
  try {
    state.results = await pricesApi.latest(state.term);
  } catch (err) {
    showError(err);
    state.results = [];
  }
  container.innerHTML = template();
  wireEvents(container);
}

function wireEvents(container) {
  container.querySelector("#prices-search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    state.term = e.target.term.value.trim();
    state.activeCategory = null;
    if (state.term) search(container);
  });

  container.querySelector("#prices-print-btn")?.addEventListener("click", () => window.print());

  container.querySelectorAll(".price-category-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      const term = tile.dataset.term;
      state.term = term;
      state.activeCategory = term;
      search(container);
    });
  });

  container.querySelectorAll(".price-tile[data-title]").forEach((card) => {
    const title = card.dataset.title;
    const panel = card.querySelector(".price-history-panel");
    const btn = card.querySelector('[data-action="toggle-history"]');

    btn.addEventListener("click", async () => {
      const isOpen = panel.style.display !== "none";
      if (isOpen) {
        panel.style.display = "none";
        btn.textContent = t("pr.history");
        return;
      }

      panel.style.display = "block";
      panel.innerHTML = `<div class="empty-state">${t("common.loading")}</div>`;
      btn.textContent = t("pr.hide");

      try {
        const history = await pricesApi.history(state.term);
        const points = history
          .filter((row) => row.product_title === title)
          .sort((a, b) => new Date(a.scraped_at) - new Date(b.scraped_at));
        panel.innerHTML = "";
        renderPriceChart(panel, points, { title });
      } catch (err) {
        showError(err);
        panel.innerHTML = `<div class="empty-state">${t("pr.loadError")}</div>`;
      }
    });
  });
}
