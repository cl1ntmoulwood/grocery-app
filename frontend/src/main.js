import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { render as renderInventory } from "./views/inventory.js";
import { render as renderShoppingList } from "./views/shoppingList.js";
import { render as renderRecipes } from "./views/recipes.js";
import { render as renderPrices } from "./views/prices.js";
import { render as renderWelcome } from "./views/welcome.js";
import { render as renderLogin } from "./views/login.js";
import { render as renderRegister } from "./views/register.js";
import { render as renderProfiles } from "./views/profiles.js";
import { render as renderMemberAccess } from "./views/memberAccess.js";
import { authApi } from "./api.js";
import { showError } from "./toast.js";
import { t, getLocale, setLocale, onLocaleChange } from "./i18n.js";

registerSW({ immediate: true });

const views = {
  inventory: renderInventory,
  "shopping-list": renderShoppingList,
  recipes: renderRecipes,
  prices: renderPrices,
};

const authViews = {
  welcome: renderWelcome,
  login: renderLogin,
  register: renderRegister,
  profiles: renderProfiles,
  memberAccess: renderMemberAccess,
};

const app = document.getElementById("app");
const tabs = document.getElementById("tabs");
const sideNav = document.getElementById("side-nav");
const langToggle = document.getElementById("lang-toggle");
const userMenu = document.getElementById("user-menu");
const userMenuProfile = document.getElementById("user-menu-profile");
const switchProfileBtn = document.getElementById("switch-profile-btn");
const logoutBtn = document.getElementById("logout-btn");

let currentView = "inventory";
// Re-invoked on locale change, whatever's currently on screen (an app tab
// or an auth screen) — kept in sync by showView()/showAuthScreen() below.
let currentRender = () => {};

function applyStaticTranslations() {
  document.title = t("common.pageTitle");
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
  currentRender = () => views[name](app);
  currentRender();
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
  currentRender();
});

// --- Auth: welcome / login / register / profile-picker ---

function showAuthScreen(name) {
  document.body.classList.add("pre-auth");
  applyStaticTranslations();
  currentRender = () => authViews[name](app, authNav);
  currentRender();
}

const authNav = {
  goTo: showAuthScreen,
  onAuthenticated: reroute,
};

function populateUserMenu(profile) {
  userMenu.hidden = false;
  userMenuProfile.textContent = `${profile.avatarEmoji} ${profile.name}`;
}

switchProfileBtn.addEventListener("click", async () => {
  try {
    await authApi.switchProfile();
  } catch (err) {
    showError(err);
    return;
  }
  userMenu.hidden = true;
  await reroute();
});

logoutBtn.addEventListener("click", async () => {
  try {
    await authApi.logout();
  } catch (err) {
    showError(err);
    return;
  }
  userMenu.hidden = true;
  await reroute();
});

function route(session) {
  if (session.needsRegistration) return showAuthScreen("register");
  if (!session.household) return showAuthScreen("welcome");
  if (!session.profile) return showAuthScreen("profiles");

  document.body.classList.remove("pre-auth");
  populateUserMenu(session.profile);
  const initialView = window.location.hash.replace("#", "");
  showView(views[initialView] ? initialView : "inventory");
}

async function reroute() {
  try {
    route(await authApi.getSession());
  } catch (err) {
    showError(err);
  }
}

reroute();
