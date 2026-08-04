import { pricesApi } from "../api.js";
import { showError } from "../toast.js";
import { renderPriceChart } from "../priceChart.js";

let state = {
  term: "",
  results: [],
  searched: false,
  expanded: null, // product_title currently showing history
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

function resultCardHtml(item) {
  return `
    <div class="card" data-title="${escapeHtml(item.product_title)}">
      <div class="card-row">
        ${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px" />` : ""}
        <div style="flex:1">
          <div class="card-title">${escapeHtml(item.product_title)}</div>
          <div class="card-meta">
            ${item.price_mad} MAD${item.unit ? ` / ${escapeHtml(item.unit)}` : ""}
            &middot; as of ${timeAgo(item.scraped_at)}
            ${item.product_url ? ` &middot; <a href="${escapeHtml(item.product_url)}" target="_blank" rel="noopener">view listing</a>` : ""}
          </div>
        </div>
        <button class="btn btn-sm" data-action="toggle-history">History</button>
      </div>
      <div class="price-history-panel" style="display:none;margin-top:0.75rem"></div>
    </div>
  `;
}

function template() {
  return `
    <form class="card" id="prices-search-form">
      <div class="section-title">Search local prices</div>
      <div class="form-row">
        <input type="text" name="term" placeholder="e.g. Lait" value="${escapeHtml(state.term)}" required />
        <button class="btn btn-primary" type="submit" style="flex:0 0 auto">Search</button>
      </div>
    </form>

    <div id="prices-results">
      ${
        !state.searched
          ? '<div class="empty-state">Search for a grocery item to see tracked prices.</div>'
          : state.results.length
            ? state.results.map(resultCardHtml).join("")
            : `<div class="empty-state">
                No price data yet for "${escapeHtml(state.term)}". The price scraper hasn't collected this item yet
                — check back once it's run.
              </div>`
      }
    </div>
  `;
}

export async function render(container) {
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
    if (state.term) search(container);
  });

  container.querySelectorAll(".card[data-title]").forEach((card) => {
    const title = card.dataset.title;
    const panel = card.querySelector(".price-history-panel");
    const btn = card.querySelector('[data-action="toggle-history"]');

    btn.addEventListener("click", async () => {
      const isOpen = panel.style.display !== "none";
      if (isOpen) {
        panel.style.display = "none";
        btn.textContent = "History";
        return;
      }

      panel.style.display = "block";
      panel.innerHTML = '<div class="empty-state">Loading…</div>';
      btn.textContent = "Hide";

      try {
        const history = await pricesApi.history(state.term);
        const points = history
          .filter((row) => row.product_title === title)
          .sort((a, b) => new Date(a.scraped_at) - new Date(b.scraped_at));
        panel.innerHTML = "";
        renderPriceChart(panel, points, { title });
      } catch (err) {
        showError(err);
        panel.innerHTML = '<div class="empty-state">Could not load history.</div>';
      }
    });
  });
}
