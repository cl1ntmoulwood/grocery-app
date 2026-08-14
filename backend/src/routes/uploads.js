import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { sendError } from "../utils/http.js";

const ALLOWED_MIME_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export default async function uploadsRoutes(fastify, opts) {
  const uploadDir = opts.uploadDir;

  fastify.post("/uploads", async (request, reply) => {
    let file;
    try {
      file = await request.file();
    } catch (err) {
      // @fastify/multipart throws when the file exceeds the configured
      // fileSize limit — surface that as a normal 400, not a 500.
      request.log.error(err);
      return sendError(reply, 400, "Upload failed (file may be too large)");
    }

    if (!file) {
      return sendError(reply, 400, "No file provided");
    }

    const extension = ALLOWED_MIME_EXTENSIONS[file.mimetype];
    if (!extension) {
      return sendError(reply, 400, "Only JPEG, PNG, WEBP, or GIF images are allowed");
    }

    // Never trust the client-supplied filename — a random name sidesteps
    // path traversal and collisions entirely.
    const filename = `${randomUUID()}${extension}`;

    try {
      await pipeline(file.file, createWriteStream(path.join(uploadDir, filename)));
    } catch (err) {
      request.log.error(err);
      return sendError(reply, 500, "Failed to save upload");
    }

    if (file.file.truncated) {
      return sendError(reply, 400, "File is too large");
    }

    return reply.code(201).send({ url: `/api/uploads/${filename}` });
  });
}
