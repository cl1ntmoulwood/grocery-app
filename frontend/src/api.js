// Thin fetch wrapper over the backend API documented in backend/API_ROUTES.md.
// The app is served by Caddy from the same origin as /api/*, so all paths
// here are relative — no base URL configuration needed.

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (response.status === 204) return null;

  let body = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const message = body?.error || body?.message || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return body;
}

const json = (body) => ({ body: JSON.stringify(body) });

export const inventoryApi = {
  list: (category) => request(`/api/inventory${category ? `?category=${encodeURIComponent(category)}` : ""}`),
  lowStock: () => request("/api/inventory/low-stock"),
  get: (id) => request(`/api/inventory/${id}`),
  create: (data) => request("/api/inventory", { method: "POST", ...json(data) }),
  update: (id, data) => request(`/api/inventory/${id}`, { method: "PUT", ...json(data) }),
  remove: (id) => request(`/api/inventory/${id}`, { method: "DELETE" }),
};

export const recipesApi = {
  list: () => request("/api/recipes"),
  get: (id) => request(`/api/recipes/${id}`),
  create: (data) => request("/api/recipes", { method: "POST", ...json(data) }),
  update: (id, data) => request(`/api/recipes/${id}`, { method: "PUT", ...json(data) }),
  remove: (id) => request(`/api/recipes/${id}`, { method: "DELETE" }),
  checkInventory: (id) => request(`/api/recipes/${id}/check-inventory`),
  generateList: (recipeId) => request(`/api/recipes/generate-list?recipe_id=${recipeId}`),
};

export const shoppingListApi = {
  list: (purchased) => request(`/api/shopping-list${purchased !== undefined ? `?purchased=${purchased}` : ""}`),
  estimate: () => request("/api/shopping-list/estimate"),
  create: (data) => request("/api/shopping-list", { method: "POST", ...json(data) }),
  update: (id, data) => request(`/api/shopping-list/${id}`, { method: "PUT", ...json(data) }),
  remove: (id) => request(`/api/shopping-list/${id}`, { method: "DELETE" }),
};

export const pricesApi = {
  latest: (term) => request(`/api/prices/${encodeURIComponent(term)}`),
  history: (term) => request(`/api/prices/${encodeURIComponent(term)}/history`),
  suggest: (term) => request(`/api/prices/suggest?term=${encodeURIComponent(term)}`),
  categories: () => request("/api/prices/categories"),
};

export { ApiError };
