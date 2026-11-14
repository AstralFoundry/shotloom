import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { authApp } from "./auth";
import { domainApp } from "./domain";
import { env } from "./env";
import { HttpError } from "./lib/errors";
import { envelope } from "./lib/respond";
import type { AppEnv } from "./lib/types";

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json(envelope({ status: "ok" })));
app.route("/api/auth", authApp);
app.route("/api", domainApp);

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
  console.error("[unhandled]", err);
  return Response.json(
    { success: false, code: "INTERNAL_ERROR", message: "服务器内部错误", data: null },
    { status: 500 },
  );
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Shotloom BFF 已启动：http://localhost:${info.port}`);
});
