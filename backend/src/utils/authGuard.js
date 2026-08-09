import { getSession } from "./session.js";
import { sendError } from "./http.js";

// Applied to the pantry-data route groups (inventory/recipes/shopping-list/
// prices) — every family member must be logged in AND have picked a profile
// to read or write pantry data.
export async function requireAuth(request, reply) {
  const session = getSession(request);
  if (!session?.householdId) {
    return sendError(reply, 401, "Not logged in");
  }
  if (!session.profileId) {
    return sendError(reply, 401, "No profile selected");
  }
  request.session = session;
}

// Applied to the profile-picker endpoints, which are reachable after
// household login but before a profile has been selected.
export async function requireHousehold(request, reply) {
  const session = getSession(request);
  if (!session?.householdId) {
    return sendError(reply, 401, "Not logged in");
  }
  request.session = session;
}
