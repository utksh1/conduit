import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";

import {
  copyResponseHeaders,
  requestHeaders,
  upstreamUrl,
  validateAdminRoute,
  validateV1Route,
} from "./proxy.mjs";

test("only exposes supported admin routes and methods", () => {
  assert.equal(validateAdminRoute(["auth", "status"], "GET"), "/api/auth/status");
  assert.equal(validateAdminRoute(["keys", "key-id"], "PATCH"), "/api/keys/key-id");
  assert.equal(validateAdminRoute(["settings"], "GET"), null);
  assert.equal(validateAdminRoute(["auth", "setup"], "POST"), null);
  assert.equal(validateAdminRoute(["keys"], "PUT"), null);
});

test("only exposes supported v1 routes and methods", () => {
  assert.equal(validateV1Route(["models"], "GET"), "/v1/models");
  assert.equal(validateV1Route(["chat", "completions"], "POST"), "/v1/chat/completions");
  assert.equal(validateV1Route(["files", "folder", "file.png"], "GET"), "/v1/files/folder/file.png");
  assert.equal(validateV1Route(["health"], "GET"), null);
  assert.equal(validateV1Route(["images", "generations"], "GET"), null);
});

test("uses the configured Render origin and preserves only query parameters", () => {
  const previous = process.env.RENDER_BACKEND_URL;
  process.env.RENDER_BACKEND_URL = "https://conduit-mlxk.onrender.com";

  const target = upstreamUrl("/v1/models", "/v1/models?limit=10");
  assert.equal(target.toString(), "https://conduit-mlxk.onrender.com/v1/models?limit=10");

  if (previous === undefined) delete process.env.RENDER_BACKEND_URL;
  else process.env.RENDER_BACKEND_URL = previous;
});

test("filters request headers and replaces authorization", () => {
  const headers = requestHeaders(
    {
      headers: {
        accept: "text/event-stream",
        authorization: "Bearer browser-token",
        connection: "keep-alive",
        cookie: "session=private",
        "content-length": "123",
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.1",
      },
    },
    "Bearer private-proxy-key",
  );

  assert.equal(headers.get("accept"), "text/event-stream");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("authorization"), "Bearer private-proxy-key");
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("connection"), null);
  assert.equal(headers.get("content-length"), null);
  assert.equal(headers.get("x-forwarded-for"), null);
});

test("preserves SSE-safe response headers without forwarding hop-by-hop headers", () => {
  const response = new PassThrough();
  response.headers = new Map();
  response.setHeader = (name, value) => response.headers.set(name, value);

  copyResponseHeaders(
    new Response("data: hello\n\ndata: [DONE]\n\n", {
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream",
        "x-internal": "hidden",
      },
    }),
    response,
  );

  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.equal(response.headers.get("connection"), undefined);
  assert.equal(response.headers.get("x-internal"), undefined);
});
