import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { render as renderInventory } from "./views/inventory.js";
import { render as renderShoppingList } from "./views/shoppingList.js";
import { render as renderRecipes } from "./views/recipes.js";
import { render as renderPrices } from "./views/prices.js";

registerSW({ immediate: true });

const views = {
  inventory: renderInventory,
  "shopping-list": renderShoppingList,
  recipes: renderRecipes,
  prices: renderPrices,
};

const app = document.getElementById("app");
const tabs = document.getElementById("tabs");

function showView(name) {
  tabs.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === name);
  });
  views[name](app);
  history.replaceState(null, "", `#${name}`);
}

tabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  showView(btn.dataset.view);
});

const initialView = window.location.hash.replace("#", "");
showView(views[initialView] ? initialView : "inventory");
