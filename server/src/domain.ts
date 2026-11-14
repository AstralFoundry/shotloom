import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { requireAuth } from "./auth";
import { env } from "./env";
import { badRequest, notFound } from "./lib/errors";
import { envelope } from "./lib/respond";
import { resolveBucket, scopedKey, uploadFile, createSignedUrl, createSignedUploadUrl } from "./lib/supabase";
import type { AppEnv, Json } from "./lib/types";
import * as store from "./lib/store";

// ---------------------------------------------------------------------------
// 校验辅助
// ---------------------------------------------------------------------------
const uuidSchema = z.string().uuid();
const kindSchema = z.enum(["skills", "recipes", "assets", "materials"]);

function parseOrBadRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest(result.error.message);
  return result.data;
}

async function jsonBody(c: Context<AppEnv>): Promise<Json> {
  try {
    return (await c.req.json()) as Json;
  } catch {
    throw badRequest("请求体不是合法 JSON");
  }
}

// 目录初始值：无历史元数据时回退到与客户端一致的默认结构。
const CATALOG_FALLBACKS: Record<string, Json> = {
  skills: { storageVersion: 1, skills: [] },
  recipes: { storageVersion: 1, recipes: [] },
  assets: { storageVersion: 1, materials: [], assets: [], references: [] },
  materials: { storageVersion: 1, materials: [] },
};

// ---------------------------------------------------------------------------
// 领域路由（统一挂 requireAuth）
// ---------------------------------------------------------------------------
export const domainApp = new Hono<AppEnv>();
domainApp.use("*", requireAuth);

// ---------------------------------------------------------------------------
// 项目（画布图数据）
// ---------------------------------------------------------------------------
domainApp.get("/project/:id", async (c) => {
  const userId = c.get("userId");
  const projectId = parseOrBadRequest(uuidSchema, c.req.param("id"));
  const value = await store.loadProject(userId, projectId);
  if (value === null) throw notFound("工程不存在或无权访问");
  return c.json(envelope(value));
});

domainApp.put("/project/:id", async (c) => {
  const userId = c.get("userId");
  const projectId = parseOrBadRequest(uuidSchema, c.req.param("id"));
  const body = await jsonBody(c);
  const saved = await store.saveProject(userId, projectId, body);
  return c.json(envelope(saved, "已保存"));
});

domainApp.get("/projects", async (c) => {
  const userId = c.get("userId");
  return c.json(envelope(await store.listProjects(userId)));
});

domainApp.delete("/project/:id", async (c) => {
  const userId = c.get("userId");
  const projectId = parseOrBadRequest(uuidSchema, c.req.param("id"));
  await store.deleteProject(userId, projectId);
  return c.json(envelope(null, "已删除"));
});

// 编辑器快照（按 node 聚合）
domainApp.get("/project/:id/snapshot/:nodeId", async (c) => {
  const userId = c.get("userId");
  const projectId = parseOrBadRequest(uuidSchema, c.req.param("id"));
  const nodeId = c.req.param("nodeId");
  await store.assertProjectOwnership(userId, projectId);
  const value = await store.loadSnapshot(projectId, nodeId);
  return c.json(envelope(value));
});

domainApp.put("/project/:id/snapshot/:nodeId", async (c) => {
  const userId = c.get("userId");
  const projectId = parseOrBadRequest(uuidSchema, c.req.param("id"));
  const nodeId = c.req.param("nodeId");
  await store.assertProjectOwnership(userId, projectId);
  await store.saveSnapshot(projectId, nodeId, await jsonBody(c));
  return c.json(envelope(null, "已保存"));
});

// 编辑器记录（按 node + key 聚合）
domainApp.get("/project/:id/editor/:nodeId/:key", async (c) => {
  const userId = c.get("userId");
  const projectId = parseOrBadRequest(uuidSchema, c.req.param("id"));
  const nodeId = c.req.param("nodeId");
  const key = c.req.param("key");
  await store.assertProjectOwnership(userId, projectId);
  const value = await store.editorRecord(projectId, nodeId, key);
  return c.json(envelope(value));
});

domainApp.put("/project/:id/editor/:nodeId/:key", async (c) => {
  const userId = c.get("userId");
  const projectId = parseOrBadRequest(uuidSchema, c.req.param("id"));
  const nodeId = c.req.param("nodeId");
  const key = c.req.param("key");
  await store.assertProjectOwnership(userId, projectId);
  await store.setEditorRecord(projectId, nodeId, key, await jsonBody(c));
  return c.json(envelope(null, "已保存"));
});

domainApp.delete("/project/:id/editor/:nodeId/:key", async (c) => {
  const userId = c.get("userId");
  const projectId = parseOrBadRequest(uuidSchema, c.req.param("id"));
  const nodeId = c.req.param("nodeId");
  const key = c.req.param("key");
  await store.assertProjectOwnership(userId, projectId);
  await store.setEditorRecord(projectId, nodeId, key, null);
  return c.json(envelope(null, "已删除"));
});

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------
domainApp.get("/settings", async (c) => {
  const userId = c.get("userId");
  return c.json(envelope(await store.loadSettings(userId)));
});

domainApp.put("/settings", async (c) => {
  const userId = c.get("userId");
  await store.saveSettings(userId, await jsonBody(c));
  return c.json(envelope(null, "已保存"));
});

domainApp.get("/download-directory", async (c) => {
  const userId = c.get("userId");
  return c.json(envelope(await store.getSettingField(userId, "downloadDirectory")));
});

domainApp.put("/download-directory", async (c) => {
  const userId = c.get("userId");
  await store.setSettingField(userId, "downloadDirectory", await jsonBody(c));
  return c.json(envelope(null, "已保存"));
});

domainApp.put("/settings/token-group", async (c) => {
  const userId = c.get("userId");
  const body = parseOrBadRequest(
    z.object({ activeTokenGroupId: z.string() }),
    await c.req.json(),
  );
  await store.setSettingField(userId, "activeTokenGroupId", body.activeTokenGroupId);
  return c.json(envelope(null, "已保存"));
});

// ---------------------------------------------------------------------------
// 目录（skills / recipes / assets / materials）
// ---------------------------------------------------------------------------
domainApp.get("/catalog/:kind", async (c) => {
  const userId = c.get("userId");
  const kind = parseOrBadRequest(kindSchema, c.req.param("kind"));
  return c.json(envelope(await store.loadCatalog(userId, kind, CATALOG_FALLBACKS[kind] ?? {})));
});

domainApp.put("/catalog/:kind", async (c) => {
  const userId = c.get("userId");
  const kind = parseOrBadRequest(kindSchema, c.req.param("kind"));
  await store.saveCatalog(userId, kind, await jsonBody(c));
  return c.json(envelope(null, "已保存"));
});

// ---------------------------------------------------------------------------
// 最近项目
// ---------------------------------------------------------------------------
domainApp.get("/recent", async (c) => {
  const userId = c.get("userId");
  return c.json(envelope(await store.listRecent(userId)));
});

domainApp.post("/recent", async (c) => {
  const userId = c.get("userId");
  return c.json(envelope(await store.addRecent(userId, await jsonBody(c))));
});

domainApp.delete("/recent/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = parseOrBadRequest(uuidSchema, c.req.param("projectId"));
  return c.json(envelope(await store.removeRecent(userId, projectId)));
});

// ---------------------------------------------------------------------------
// 恢复记录 / 剪贴板 / 工作区会话
// ---------------------------------------------------------------------------
domainApp.get("/recovery/:kind", async (c) => {
  const userId = c.get("userId");
  return c.json(envelope(await store.loadRecovery(userId, c.req.param("kind"))));
});

domainApp.put("/recovery/:kind", async (c) => {
  const userId = c.get("userId");
  await store.saveRecovery(userId, c.req.param("kind"), await jsonBody(c));
  return c.json(envelope(null, "已保存"));
});

domainApp.get("/clipboard/:id", async (c) => {
  const userId = c.get("userId");
  return c.json(envelope(await store.loadClipboard(userId, c.req.param("id"))));
});

domainApp.put("/clipboard/:id", async (c) => {
  const userId = c.get("userId");
  await store.saveClipboard(userId, c.req.param("id"), await jsonBody(c));
  return c.json(envelope(null, "已保存"));
});

domainApp.get("/workspace/:label", async (c) => {
  const userId = c.get("userId");
  return c.json(envelope(await store.workspaceProject(userId, c.req.param("label"))));
});

domainApp.put("/workspace/:label", async (c) => {
  const userId = c.get("userId");
  const body = parseOrBadRequest(
    z.object({ projectId: z.string().uuid().nullable() }),
    await c.req.json(),
  );
  await store.bindWorkspaceProject(userId, c.req.param("label"), body.projectId);
  return c.json(envelope(null, "已保存"));
});

// ---------------------------------------------------------------------------
// 对象存储
// ---------------------------------------------------------------------------
const bucketSchema = z.enum(["media", "assets"]);

// 直传上传签名 URL
domainApp.post("/files/upload-url", async (c) => {
  const userId = c.get("userId");
  const body = parseOrBadRequest(
    z.object({ bucket: bucketSchema, key: z.string().min(1) }),
    await c.req.json(),
  );
  const bucket = resolveBucket(body.bucket);
  const key = scopedKey(userId, body.key);
  const url = await createSignedUploadUrl(bucket, key);
  return c.json(envelope({ bucket, key, url }));
});

// 下载签名 URL
domainApp.get("/files/sign", async (c) => {
  const userId = c.get("userId");
  const bucket = parseOrBadRequest(bucketSchema, c.req.query("bucket"));
  const rawKey = c.req.query("key");
  if (!rawKey) throw badRequest("缺少 key");
  const key = scopedKey(userId, rawKey);
  const url = await createSignedUrl(resolveBucket(bucket), key);
  return c.json(envelope({ bucket, key, url }));
});

// BFF 中转上传（小文件/不便直传时）
domainApp.post("/files", async (c) => {
  const userId = c.get("userId");
  const bucket = parseOrBadRequest(bucketSchema, c.req.query("bucket"));
  const rawKey = c.req.query("key");
  if (!rawKey) throw badRequest("缺少 key");
  const key = scopedKey(userId, rawKey);
  const contentType = c.req.header("content-type") ?? "application/octet-stream";
  const bytes = await c.req.raw.arrayBuffer();
  const savedKey = await uploadFile(resolveBucket(bucket), key, new Blob([bytes]), contentType);
  return c.json(envelope({ bucket, key: savedKey }));
});

// ---------------------------------------------------------------------------
// AI 转发：透传 new-api /v1/*，不缓冲响应流
// ---------------------------------------------------------------------------
domainApp.all("/relay/*", async (c) => {
  const accessToken = c.get("accessToken");
  const incoming = new URL(c.req.url);
  const subpath = incoming.pathname.replace(/^\/api\/relay/, "") || "/";
  const target = new URL(`/v1${subpath}`, env.GATEWAY_BASE_URL);
  target.search = incoming.search;

  const headers = new Headers();
  for (const [key, value] of c.req.raw.headers.entries()) {
    if (["host", "cookie", "authorization", "content-length", "connection"].includes(key.toLowerCase())) {
      continue;
    }
    headers.set(key, value);
  }
  headers.set("Authorization", `Bearer ${accessToken}`);

  const init: RequestInit = { method: c.req.method, headers };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.raw.arrayBuffer();
  }

  const upstream = await fetch(target.toString(), init);
  const resHeaders = new Headers(upstream.headers);
  resHeaders.delete("transfer-encoding");
  resHeaders.delete("content-length");
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
});
