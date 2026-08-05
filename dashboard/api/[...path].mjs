import {
  getPathSegments,
  proxyRequest,
  sendJson,
  validateAdminRoute,
} from "../server/proxy.mjs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(request, response) {
  const path = validateAdminRoute(getPathSegments(request), request.method ?? "GET");
  if (!path) {
    sendJson(response, 404, { error: "Unsupported dashboard API route" });
    return;
  }

  const authorization = request.headers.authorization;
  await proxyRequest(request, response, { path, authorization });
}
