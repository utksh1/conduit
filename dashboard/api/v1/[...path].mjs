import {
  getPathSegments,
  hasValidDashboardSession,
  proxyRequest,
  sendJson,
  validateV1Route,
} from "../../server/proxy.mjs";

export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};

export default async function handler(request, response) {
  const path = validateV1Route(getPathSegments(request), request.method ?? "GET");
  if (!path) {
    sendJson(response, 404, { error: "Unsupported proxy route" });
    return;
  }

  const dashboardAuthorization = request.headers.authorization;
  if (!(await hasValidDashboardSession(dashboardAuthorization))) {
    sendJson(response, 401, { error: "A valid dashboard session is required" });
    return;
  }

  const proxyApiKey = process.env.PROXY_API_KEY;
  if (!proxyApiKey) {
    sendJson(response, 500, { error: "Proxy authentication is not configured" });
    return;
  }

  await proxyRequest(request, response, {
    path,
    authorization: `Bearer ${proxyApiKey}`,
  });
}
