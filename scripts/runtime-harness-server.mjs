#!/usr/bin/env bun

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const HOST = process.env.HARNESS_HOST ?? "127.0.0.1";
const PORT = Number.parseInt(process.env.HARNESS_PORT ?? "4173", 10);
const ROOT = path.resolve(
  fileURLToPath(new URL("../runtime/harness", import.meta.url)),
);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function resolveFilePath(urlPath) {
  const cleanPath = urlPath.split("?")[0] || "/";
  const relativePath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\/+/, "");
  const normalizedPath = path.normalize(relativePath);
  const absolutePath = path.join(ROOT, normalizedPath);

  if (!absolutePath.startsWith(ROOT)) {
    return null;
  }

  return absolutePath;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

const server = createServer(async (request, response) => {
  const filePath = resolveFilePath(request.url ?? "/");

  if (!filePath) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid request path");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": contentTypeFor(filePath) });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(PORT, HOST, () => {
  globalThis.console.log(`[runtime-harness] serving ${ROOT} on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  globalThis.console.log(`[runtime-harness] shutting down on ${signal}`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
