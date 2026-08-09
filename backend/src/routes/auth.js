import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { parseId, sendError } from "../utils/http.js";
import { setSession, getSession, clearSession } from "../utils/session.js";
import { requireHousehold } from "../utils/authGuard.js";

const PIN_ROUNDS = 10;
const PASSWORD_ROUNDS = 12;

function serializeProfile(row) {
  return {
    id: row.id,
    name: row.name,
    avatarEmoji: row.avatar_emoji,
    avatarColor: row.avatar_color,
    hasPin: row.pin_hash !== null,
    role: row.role,
  };
}

export default async function authRoutes(fastify) {
  fastify.post("/register", async (request, reply) => {
    const { householdName, loginId, password } = request.body ?? {};

    if (typeof householdName !== "string" || householdName.trim() === "") {
      return sendError(reply, 400, "householdName is required");
    }
    if (typeof loginId !== "string" || loginId.trim() === "") {
      return sendError(reply, 400, "loginId is required");
    }
    if (typeof password !== "string" || password.length < 8) {
      return sendError(reply, 400, "password must be at least 8 characters");
    }

    try {
      const existing = await pool.query("SELECT id FROM households LIMIT 1");
      if (existing.rows.length > 0) {
        return sendError(reply, 403, "Registration is closed");
      }

      const passwordHash = await bcrypt.hash(password, PASSWORD_ROUNDS);
      const result = await pool.query(
        `INSERT INTO households (name, login_id, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name`,
        [householdName.trim(), loginId.trim(), passwordHash]
      );

      const household = result.rows[0];
      setSession(reply, { householdId: household.id });
      return reply.code(201).send({ household: { id: household.id, name: household.name } });
    } catch (err) {
      if (err.code === "23505") {
        return sendError(reply, 409, "loginId is already taken");
      }
      request.log.error(err);
      return sendError(reply, 500, "Failed to register household");
    }
  });

  fastify.post("/login", async (request, reply) => {
    const { loginId, password } = request.body ?? {};

    if (typeof loginId !== "string" || typeof password !== "string") {
      return sendError(reply, 400, "loginId and password are required");
    }

    try {
      const result = await pool.query(
        "SELECT id, name, password_hash FROM households WHERE login_id = $1",
        [loginId.trim()]
      );
      if (result.rows.length === 0) {
        return sendError(reply, 401, "Invalid credentials");
      }

      const household = result.rows[0];
      const match = await bcrypt.compare(password, household.password_hash);
      if (!match) {
        return sendError(reply, 401, "Invalid credentials");
      }

      setSession(reply, { householdId: household.id });
      return { household: { id: household.id, name: household.name } };
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to log in");
    }
  });

  fastify.post("/logout", async (request, reply) => {
    clearSession(reply);
    return reply.code(204).send();
  });

  fastify.post("/switch-profile", async (request, reply) => {
    const session = getSession(request);
    if (!session?.householdId) {
      return sendError(reply, 401, "Not logged in");
    }
    setSession(reply, { householdId: session.householdId });
    return reply.code(204).send();
  });

  fastify.get("/session", async (request) => {
    const session = getSession(request);
    if (!session) {
      const countResult = await pool.query("SELECT COUNT(*)::int AS count FROM households");
      return { needsRegistration: countResult.rows[0].count === 0, household: null, profile: null };
    }

    const householdResult = await pool.query("SELECT id, name FROM households WHERE id = $1", [
      session.householdId,
    ]);
    if (householdResult.rows.length === 0) {
      return { needsRegistration: false, household: null, profile: null };
    }
    const household = householdResult.rows[0];

    let profile = null;
    if (session.profileId) {
      const profileResult = await pool.query("SELECT * FROM profiles WHERE id = $1", [session.profileId]);
      if (profileResult.rows.length > 0) {
        profile = serializeProfile(profileResult.rows[0]);
      }
    }

    return { needsRegistration: false, household: { id: household.id, name: household.name }, profile };
  });

  fastify.register(async (household) => {
    household.addHook("preHandler", requireHousehold);

    household.get("/profiles", async (request, reply) => {
      try {
        const result = await pool.query(
          "SELECT * FROM profiles WHERE household_id = $1 ORDER BY created_at ASC",
          [request.session.householdId]
        );
        return result.rows.map(serializeProfile);
      } catch (err) {
        request.log.error(err);
        return sendError(reply, 500, "Failed to fetch profiles");
      }
    });

    household.post("/profiles", async (request, reply) => {
      const { name, avatarEmoji, avatarColor, pin } = request.body ?? {};

      if (typeof name !== "string" || name.trim() === "") {
        return sendError(reply, 400, "name is required");
      }
      if (pin !== undefined && pin !== null && !/^\d{4,6}$/.test(String(pin))) {
        return sendError(reply, 400, "pin must be 4-6 digits");
      }

      try {
        const countResult = await pool.query(
          "SELECT COUNT(*)::int AS count FROM profiles WHERE household_id = $1",
          [request.session.householdId]
        );
        const role = countResult.rows[0].count === 0 ? "admin" : "member";
        const pinHash = pin ? await bcrypt.hash(String(pin), PIN_ROUNDS) : null;

        const result = await pool.query(
          `INSERT INTO profiles (household_id, name, avatar_emoji, avatar_color, pin_hash, role)
           VALUES ($1, $2, COALESCE($3, '🙂'), COALESCE($4, '#1f6f76'), $5, $6)
           RETURNING *`,
          [request.session.householdId, name.trim(), avatarEmoji ?? null, avatarColor ?? null, pinHash, role]
        );
        return reply.code(201).send(serializeProfile(result.rows[0]));
      } catch (err) {
        if (err.code === "23505") {
          return sendError(reply, 409, "A profile with that name already exists");
        }
        request.log.error(err);
        return sendError(reply, 500, "Failed to create profile");
      }
    });

    household.post("/profiles/:id/select", async (request, reply) => {
      const id = parseId(request.params.id);
      if (id === null) return sendError(reply, 400, "Invalid id");

      const { pin } = request.body ?? {};

      try {
        const result = await pool.query(
          "SELECT * FROM profiles WHERE id = $1 AND household_id = $2",
          [id, request.session.householdId]
        );
        if (result.rows.length === 0) return sendError(reply, 404, "Profile not found");

        const profile = result.rows[0];
        if (profile.pin_hash) {
          const match = typeof pin === "string" && (await bcrypt.compare(pin, profile.pin_hash));
          if (!match) return sendError(reply, 401, "Incorrect PIN");
        }

        setSession(reply, {
          householdId: request.session.householdId,
          profileId: profile.id,
          role: profile.role,
        });
        return serializeProfile(profile);
      } catch (err) {
        request.log.error(err);
        return sendError(reply, 500, "Failed to select profile");
      }
    });
  });
}
