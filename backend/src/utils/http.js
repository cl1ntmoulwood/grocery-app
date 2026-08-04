export function parseId(raw) {
  if (!/^\d+$/.test(String(raw))) return null;
  return Number(raw);
}

export function sendError(reply, status, message) {
  return reply.code(status).send({ error: message });
}
