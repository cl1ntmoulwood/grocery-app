// Minimal single-series line chart for price-over-time. No chart library —
// keeps bundle size small, matches the rest of this app. Follows the
// project's dataviz mark specs: 2px line, >=8px end marker with a surface
// ring, hairline recessive gridlines, crosshair+tooltip, table-view fallback.

import { t } from "./i18n.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const range = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(range / count)));
  const candidates = [1, 2, 5, 10].map((m) => m * step);
  const chosen = candidates.find((c) => range / c <= count) || candidates[candidates.length - 1];
  const ticks = [];
  let t = Math.floor(min / chosen) * chosen;
  while (t <= max + chosen * 0.001) {
    if (t >= min - chosen * 0.001) ticks.push(Math.round(t * 100) / 100);
    t += chosen;
  }
  return ticks;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function renderPriceChart(container, points, { title } = {}) {
  container.innerHTML = "";

  if (!points.length) {
    container.innerHTML = `<div class="empty-state">${t("pr.noHistory")}</div>`;
    return;
  }

  const width = 560;
  const height = 220;
  const margin = { top: 16, right: 16, bottom: 28, left: 48 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const prices = points.map((p) => p.price_mad);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const pad = (maxPrice - minPrice) * 0.1 || Math.max(1, maxPrice * 0.1);
  const yMin = Math.max(0, minPrice - pad);
  const yMax = maxPrice + pad;

  const times = points.map((p) => new Date(p.scraped_at).getTime());
  const xMin = Math.min(...times);
  const xMax = Math.max(...times);
  const xSpan = xMax - xMin || 1;

  const x = (t) => margin.left + ((t - xMin) / xSpan) * plotW;
  const y = (v) => margin.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.style.overflow = "visible";
  svg.style.display = "block";

  // --- recessive gridlines + y-axis ticks ---
  const yTicks = niceTicks(yMin, yMax);
  for (const tick of yTicks) {
    const ty = y(tick);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", margin.left);
    line.setAttribute("x2", width - margin.right);
    line.setAttribute("y1", ty);
    line.setAttribute("y2", ty);
    line.setAttribute("stroke", "var(--color-border)");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", margin.left - 8);
    label.setAttribute("y", ty + 3);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "var(--color-muted)");
    label.textContent = tick;
    svg.appendChild(label);
  }

  // --- x-axis: first / middle / last date labels ---
  const xLabelIdxs = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0, points.length - 1];
  [...new Set(xLabelIdxs)].forEach((idx) => {
    const p = points[idx];
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", x(new Date(p.scraped_at).getTime()));
    label.setAttribute("y", height - 6);
    label.setAttribute("text-anchor", idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "var(--color-muted)");
    label.textContent = formatDate(p.scraped_at);
    svg.appendChild(label);
  });

  // --- line ---
  const pathData = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(new Date(p.scraped_at).getTime())} ${y(p.price_mad)}`)
    .join(" ");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "var(--color-primary)");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-linecap", "round");
  svg.appendChild(path);

  // --- end marker (>=8px, surface ring) + direct end-label ---
  const last = points[points.length - 1];
  const lastX = x(new Date(last.scraped_at).getTime());
  const lastY = y(last.price_mad);

  const ring = document.createElementNS(SVG_NS, "circle");
  ring.setAttribute("cx", lastX);
  ring.setAttribute("cy", lastY);
  ring.setAttribute("r", "6");
  ring.setAttribute("fill", "var(--color-surface)");
  svg.appendChild(ring);

  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", lastX);
  dot.setAttribute("cy", lastY);
  dot.setAttribute("r", "4");
  dot.setAttribute("fill", "var(--color-primary)");
  svg.appendChild(dot);

  const endLabel = document.createElementNS(SVG_NS, "text");
  endLabel.setAttribute("x", Math.min(lastX + 8, width - margin.right - 4));
  endLabel.setAttribute("y", lastY - 8);
  endLabel.setAttribute("text-anchor", "end");
  endLabel.setAttribute("font-size", "11");
  endLabel.setAttribute("font-weight", "600");
  endLabel.setAttribute("fill", "var(--color-text)");
  endLabel.textContent = `${last.price_mad} MAD`;
  svg.appendChild(endLabel);

  // --- crosshair + tooltip (hover/focus) ---
  const crosshair = document.createElementNS(SVG_NS, "line");
  crosshair.setAttribute("y1", margin.top);
  crosshair.setAttribute("y2", height - margin.bottom);
  crosshair.setAttribute("stroke", "var(--color-muted)");
  crosshair.setAttribute("stroke-width", "1");
  crosshair.style.display = "none";
  svg.appendChild(crosshair);

  const hoverDot = document.createElementNS(SVG_NS, "circle");
  hoverDot.setAttribute("r", "5");
  hoverDot.setAttribute("fill", "var(--color-primary)");
  hoverDot.style.display = "none";
  svg.appendChild(hoverDot);

  const hitArea = document.createElementNS(SVG_NS, "rect");
  hitArea.setAttribute("x", margin.left);
  hitArea.setAttribute("y", margin.top);
  hitArea.setAttribute("width", plotW);
  hitArea.setAttribute("height", plotH);
  hitArea.setAttribute("fill", "transparent");
  svg.appendChild(hitArea);

  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.appendChild(svg);

  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.style.cssText =
    "position:absolute;pointer-events:none;display:none;background:var(--color-text);color:var(--color-bg);" +
    "padding:0.35rem 0.55rem;border-radius:6px;font-size:0.75rem;white-space:nowrap;transform:translate(-50%,-115%);z-index:5;";
  wrapper.appendChild(tooltip);

  function nearestIndex(clientX) {
    const rect = svg.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const px = x(new Date(p.scraped_at).getTime());
      const d = Math.abs(px - svgX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  function showAt(idx, clientX) {
    const p = points[idx];
    const px = x(new Date(p.scraped_at).getTime());
    const py = y(p.price_mad);

    crosshair.setAttribute("x1", px);
    crosshair.setAttribute("x2", px);
    crosshair.style.display = "block";

    hoverDot.setAttribute("cx", px);
    hoverDot.setAttribute("cy", py);
    hoverDot.style.display = "block";

    const rect = svg.getBoundingClientRect();
    const tooltipValue = document.createElement("strong");
    tooltipValue.textContent = `${p.price_mad} MAD`;
    const tooltipDate = document.createElement("span");
    tooltipDate.textContent = ` — ${formatDate(p.scraped_at)}`;
    tooltip.replaceChildren(tooltipValue, tooltipDate);
    tooltip.style.left = `${(px / width) * rect.width}px`;
    tooltip.style.top = `${(py / height) * rect.height}px`;
    tooltip.style.display = "block";
  }

  function hide() {
    crosshair.style.display = "none";
    hoverDot.style.display = "none";
    tooltip.style.display = "none";
  }

  hitArea.addEventListener("pointermove", (e) => showAt(nearestIndex(e.clientX), e.clientX));
  hitArea.addEventListener("pointerleave", hide);
  hitArea.setAttribute("tabindex", "0");
  hitArea.addEventListener("focus", () => showAt(points.length - 1));

  container.appendChild(wrapper);

  // --- table view toggle (accessibility: data must be reachable without hover) ---
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "btn btn-sm link-btn";
  toggleBtn.style.marginTop = "0.5rem";
  toggleBtn.textContent = t("pr.showAsTable");
  container.appendChild(toggleBtn);

  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;margin-top:0.5rem;font-size:0.85rem;display:none";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  [t("pr.tableDate"), t("pr.tablePrice")].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    th.style.cssText = "text-align:left;padding:0.3rem;border-bottom:1px solid var(--color-border);color:var(--color-muted)";
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  points.forEach((p) => {
    const row = document.createElement("tr");
    const dateCell = document.createElement("td");
    dateCell.textContent = new Date(p.scraped_at).toLocaleString();
    dateCell.style.cssText = "padding:0.3rem;border-bottom:1px solid var(--color-border)";
    const priceCell = document.createElement("td");
    priceCell.textContent = String(p.price_mad);
    priceCell.style.cssText = "padding:0.3rem;border-bottom:1px solid var(--color-border);font-variant-numeric:tabular-nums";
    row.append(dateCell, priceCell);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  toggleBtn.addEventListener("click", () => {
    const showing = table.style.display !== "none";
    table.style.display = showing ? "none" : "table";
    wrapper.style.display = showing ? "block" : "none";
    toggleBtn.textContent = showing ? t("pr.showAsTable") : t("pr.showAsChart");
  });
}
