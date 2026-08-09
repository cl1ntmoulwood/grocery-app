import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { render as renderInventory } from "./views/inventory.js";
import { render as renderShoppingList } from "./views/shoppingList.js";
import { render as renderRecipes } from "./views/recipes.js";
import { render as renderPrices } from "./views/prices.js";
import { t, getLocale, setLocale, onLocaleChange } from "./i18n.js";

registerSW({ immediate: true });

const views = {
  inventory: renderInventory,
  "shopping-list": renderShoppingList,
  recipes: renderRecipes,
  prices: renderPrices,
};

const app = document.getElementById("app");
const tabs = document.getElementById("tabs");
const sideNav = document.getElementById("side-nav");
const langToggle = document.getElementById("lang-toggle");

let currentView = "inventory";

function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  langToggle.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.lang === getLocale());
  });
}

function showView(name) {
  currentView = name;
  tabs.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === name);
  });
  sideNav.querySelectorAll(".side-nav-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === name);
  });
  applyStaticTranslations();
  views[name](app);
  history.replaceState(null, "", `#${name}`);
}

function onNavClick(e) {
  const btn = e.target.closest("[data-view]");
  if (!btn) return;
  showView(btn.dataset.view);
}

tabs.addEventListener("click", onNavClick);
sideNav.addEventListener("click", onNavClick);

langToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-lang]");
  if (!btn) return;
  setLocale(btn.dataset.lang);
});

onLocaleChange(() => {
  applyStaticTranslations();
  views[currentView](app);
});

const initialView = window.location.hash.replace("#", "");
showView(views[initialView] ? initialView : "inventory");
