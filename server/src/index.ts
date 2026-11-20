import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { fileURLToPath } from 'node:url';
import { createSiteApp } from './site';
import { authApp, nativeRelaySession } from "./auth";
import { domainApp } from "./domain";
import { modelsApp } from './models';
import { supportApp } from './support';
import { polyforkApp } from './polyfork';
import { agentApp, disposeAgentHosts } from './agent';
import { env } from "./env";
import { HttpError } from "./lib/errors";
import { envelope } from "./lib/respond";
import type { AppEnv } from "./lib/types";
import { nativeSession } from './lib/nativeAuth';

export const app = new Hono<AppEnv>();

app.use("/api/*", cors({ origin: new URL(env.FRONTEND_URL).origin, credentials: true }));
app.use("/api/*", bodyLimit({ maxSize: 32 * 1024 * 1024 }));
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    // Android's initial WebView POST has an opaque origin; its one-time code authorizes only this handoff.
    const handoff = c.req.method === 'POST' && ((!origin && c.req.path === '/api/auth/native/exchange')
      || ((!origin || origin === 'null') && c.req.path === '/api/auth/native/workspace'));
    if ((!origin || origin !== new URL(env.FRONTEND_URL).origin) && !nativeRelaySession(c) && !nativeSession(c) && !handoff) {
      return c.json({ success: false, message: "请求来源无效", data: null }, 403);
    }
  }
  await next();
});

app.get("/health", (c) => c.json(envelope({ status: "ok" })));
app.route("/api/auth", authApp);
app.route('/api/agent', agentApp);
app.route('/api', modelsApp);
app.route('/api', supportApp);
app.route('/api', polyforkApp);
app.route("/api", domainApp);
const rendererDirectory = fileURLToPath(new URL('../../dist/renderer/', import.meta.url));
app.route('/', createSiteApp(rendererDirectory));

app.notFound((c) =>
  c.json({ success: false, message: "接口不存在", data: null }, 404),
);

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return Response.json(
      { success: false, code: err.code, message: err.message, data: null },
      { status: err.status },
    );
  }
  console.error("[unhandled]", err.name);
  return Response.json(
    { success: false, code: "INTERNAL_ERROR", message: "服务器内部错误", data: null },
    { status: 500 },
  );
});

if (env.NODE_ENV !== 'test') {
  const server = serve({ fetch: app.fetch, port: env.PORT }, info => {
    console.log(`Shotloom BFF 已启动：http://localhost:${info.port}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.close();
    void disposeAgentHosts().then(() => process.exit(0), () => process.exit(1));
  });
}
