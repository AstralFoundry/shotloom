import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { existsSync } from 'node:fs';
import { authApp, nativeRelaySession } from "./auth";
import { domainApp } from "./domain";
import { modelsApp } from './models';
import { supportApp } from './support';
import { agentApp, disposeAgentHosts } from './agent';
import { env } from "./env";
import { HttpError } from "./lib/errors";
import { envelope } from "./lib/respond";
import type { AppEnv } from "./lib/types";

export const app = new Hono<AppEnv>();

app.use("/api/*", cors({ origin: new URL(env.FRONTEND_URL).origin, credentials: true }));
app.use("/api/*", bodyLimit({ maxSize: 32 * 1024 * 1024 }));
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if ((!origin || origin !== new URL(env.FRONTEND_URL).origin) && !nativeRelaySession(c)) {
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
app.route("/api", domainApp);
const rendererDirectory = fileURLToPath(new URL('../../dist/renderer/', import.meta.url));
if (existsSync(rendererDirectory)) {
  const root = relative(process.cwd(), rendererDirectory).replace(/\\/g, '/');
  app.get('/*', async (c, next) => {
    // Stable runtime and HTML URLs must revalidate when a release changes their contents.
    if (!c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-cache');
    return serveStatic({ root })(c, next);
  });
  app.get('/*', async (c, next) => {
    if (c.req.path.startsWith('/api/') || !c.req.header('accept')?.includes('text/html')) return next();
    return serveStatic({ root, path: 'index.html' })(c, next);
  });
}

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
