import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REQUEST_HEADERS = ["accept", "cache-control", "content-type"];
const RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
];

export function getPathSegments(request) {
  const path = request.query?.path;
  if (Array.isArray(path)) return path;
  return typeof path === "string" ? [path] : [];
}

export function validateAdminRoute(path, method) {
  const normalizedMethod = method.toUpperCase();

  if (
    path.length === 2 &&
    path[0] === "auth" &&
    ["status", "login"].includes(path[1]) &&
    ((path[1] === "status" && normalizedMethod === "GET") ||
      (path[1] === "login" && normalizedMethod === "POST"))
  ) {
    return `/api/auth/${path[1]}`;
  }

  if (path.length === 1 && path[0] === "keys" && ["GET", "POST"].includes(normalizedMethod)) {
    return "/api/keys";
  }

  if (
    path.length === 2 &&
    path[0] === "keys" &&
    ["PATCH", "DELETE"].includes(normalizedMethod)
  ) {
    return `/api/keys/${encodeURIComponent(path[1])}`;
  }

  if (
    path.length === 3 &&
    path[0] === "keys" &&
    path[2] === "rotate" &&
    normalizedMethod === "POST"
  ) {
    return `/api/keys/${encodeURIComponent(path[1])}/rotate`;
  }

  if (
    path.length === 1 &&
    ["audit", "logs", "metrics"].includes(path[0]) &&
    normalizedMethod === "GET"
  ) {
    return `/api/${path[0]}`;
  }

  return null;
}

export function validateV1Route(path, method) {
  const normalizedMethod = method.toUpperCase();

  if (path.length === 1 && path[0] === "models" && normalizedMethod === "GET") {
    return "/v1/models";
  }

  if (
    path.length === 2 &&
    path[0] === "chat" &&
    path[1] === "completions" &&
    normalizedMethod === "POST"
  ) {
    return "/v1/chat/completions";
  }

  if (
    path.length === 2 &&
    path[0] === "images" &&
    path[1] === "generations" &&
    normalizedMethod === "POST"
  ) {
    return "/v1/images/generations";
  }

  if (path.length >= 2 && path[0] === "files" && normalizedMethod === "GET") {
    return `/v1/files/${path.slice(1).map(encodeURIComponent).join("/")}`;
  }

  return null;
}

export function upstreamUrl(path, requestUrl) {
  const backendUrl = process.env.RENDER_BACKEND_URL;
  if (!backendUrl) throw new Error("RENDER_BACKEND_URL is not configured");

  const base = new URL(backendUrl);
  if (base.protocol !== "https:") throw new Error("RENDER_BACKEND_URL must use HTTPS");

  const target = new URL(path, `${base.origin}/`);
  target.search = new URL(requestUrl, "https://dashboard.invalid").search;
  return target;
}

export function requestHeaders(request, authorization) {
  const headers = new Headers();

  for (const name of REQUEST_HEADERS) {
    const value = request.headers[name];
    if (typeof value === "string" && value) headers.set(name, value);
  }

  if (authorization) headers.set("authorization", authorization);
  return headers;
}

export function copyResponseHeaders(upstream, response) {
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }

  if (upstream.headers.get("content-type")?.includes("text/event-stream")) {
    response.setHeader("cache-control", upstream.headers.get("cache-control") ?? "no-cache, no-transform");
  }
}

export async function pipeResponseBody(body, response) {
  if (!body) {
    response.end();
    return;
  }

  await pipeline(Readable.fromWeb(body), response);
}

export function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export async function hasValidDashboardSession(authorization) {
  if (!authorization) return false;

  const url = upstreamUrl("/api/auth/status", "/api/auth/status");
  const response = await fetch(url, {
    headers: { authorization },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) return false;

  const body = await response.json().catch(() => null);
  return body?.authenticated === true;
}

export async function proxyRequest(request, response, { path, authorization }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  response.once("close", abort);

  try {
    const method = request.method?.toUpperCase() ?? "GET";
    const hasBody = !["GET", "HEAD"].includes(method);
    const upstream = await fetch(upstreamUrl(path, request.url ?? path), {
      method,
      headers: requestHeaders(request, authorization),
      body: hasBody ? request : undefined,
      duplex: hasBody ? "half" : undefined,
      signal: controller.signal,
    });

    response.statusCode = upstream.status;
    copyResponseHeaders(upstream, response);
    await pipeResponseBody(upstream.body, response);
  } catch {
    if (!response.headersSent && !controller.signal.aborted) {
      sendJson(response, 502, { error: "Unable to reach the backend service" });
    }
  } finally {
    response.off("close", abort);
  }
}
