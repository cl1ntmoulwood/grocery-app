const COOKIE_NAME = "ch_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Two-tier session: householdId is set at login and persists until logout;
// profileId/role are set separately when a family member picks a profile,
// and can be cleared (switch profile) without re-authenticating the household.
export function setSession(reply, { householdId, profileId = null, role = null }) {
  reply.setCookie(COOKIE_NAME, JSON.stringify({ householdId, profileId, role }), {
    signed: true,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function getSession(request) {
  const raw = request.cookies[COOKIE_NAME];
  if (!raw) return null;

  const { valid, value } = request.unsignCookie(raw);
  if (!valid) return null;

  try {
    const session = JSON.parse(value);
    if (!session.householdId) return null;
    return session;
  } catch {
    return null;
  }
}

export function clearSession(reply) {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}
