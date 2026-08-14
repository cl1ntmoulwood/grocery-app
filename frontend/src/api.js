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
  // Only set Content-Type when there's actually a JSON body — Fastify's
  // JSON body parser rejects an application/json request with an empty
  // body (used by bodyless POSTs like logout/switch-profile) with a 400.
  // A FormData body (file uploads) must NOT get this header either — the
  // browser sets its own multipart/form-data boundary automatically, and
  // overriding it here would corrupt the upload.
  const headers = options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {};
  const response = await fetch(path, {
    ...options,
    headers: { ...headers, ...options.headers },
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
  list: (search) => request(`/api/recipes${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  get: (id) => request(`/api/recipes/${id}`),
  create: (data) => request("/api/recipes", { method: "POST", ...json(data) }),
  update: (id, data) => request(`/api/recipes/${id}`, { method: "PUT", ...json(data) }),
  remove: (id) => request(`/api/recipes/${id}`, { method: "DELETE" }),
  checkInventory: (id) => request(`/api/recipes/${id}/check-inventory`),
  generateList: (recipeId) => request(`/api/recipes/generate-list?recipe_id=${recipeId}`),
  lookup: (query) => request(`/api/recipes/lookup?q=${encodeURIComponent(query)}`),
  importByUrl: (url) => request("/api/recipes/import", { method: "POST", ...json({ url }) }),
  youtubeSearch: (query) => request(`/api/recipes/youtube-search?q=${encodeURIComponent(query)}`),
};

export const shoppingListApi = {
  list: (purchased) => request(`/api/shopping-list${purchased !== undefined ? `?purchased=${purchased}` : ""}`),
  estimate: () => request("/api/shopping-list/estimate"),
  create: (data) => request("/api/shopping-list", { method: "POST", ...json(data) }),
  update: (id, data) => request(`/api/shopping-list/${id}`, { method: "PUT", ...json(data) }),
  remove: (id) => request(`/api/shopping-list/${id}`, { method: "DELETE" }),
};

export const uploadsApi = {
  upload: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request("/api/uploads", { method: "POST", body: formData });
  },
};

export const pricesApi = {
  latest: (term) => request(`/api/prices/${encodeURIComponent(term)}`),
  history: (term) => request(`/api/prices/${encodeURIComponent(term)}/history`),
  suggest: (term) => request(`/api/prices/suggest?term=${encodeURIComponent(term)}`),
  categories: () => request("/api/prices/categories"),
};

export const authApi = {
  getSession: () => request("/api/auth/session"),
  register: (data) => request("/api/auth/register", { method: "POST", ...json(data) }),
  login: (data) => request("/api/auth/login", { method: "POST", ...json(data) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  listProfiles: () => request("/api/auth/profiles"),
  createProfile: (data) => request("/api/auth/profiles", { method: "POST", ...json(data) }),
  selectProfile: (id, pin) => request(`/api/auth/profiles/${id}/select`, { method: "POST", ...json({ pin }) }),
  switchProfile: () => request("/api/auth/switch-profile", { method: "POST" }),
  listMemberProfiles: () => request("/api/auth/member-profiles"),
  createMemberProfile: (data) => request("/api/auth/member-profiles", { method: "POST", ...json(data) }),
  selectMemberProfile: (id, pin) => request(`/api/auth/member-profiles/${id}/select`, { method: "POST", ...json({ pin }) }),
};

export { ApiError };
