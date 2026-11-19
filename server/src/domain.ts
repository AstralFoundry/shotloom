import { Hono } from "hono";
import { assertPublishedRelay } from './models';
import type { Context } from "hono";
import { z } from "zod";
import { requireAuth, refreshSession } from "./auth";
import { env } from "./env";
import { badRequest, notFound, supabaseError } from "./lib/errors";
import { envelope } from "./lib/respond";
import { admin, resolveBucket, scopedKey, createSignedUrl, createSignedUploadUrl } from "./lib/supabase";
import type { AppEnv, Json } from "./lib/types";
import * as store from "./lib/store";
import { pickMobileSettings } from '../../shared/mobileSettings';
import { relayPath } from './lib/relay';
import { remoteMedia } from './lib/remoteMedia';
import { readdirSync } from 'node:fs';
import { nativeSession } from './lib/nativeAuth';

const systemSkillIds = readdirSync(new URL('../../renderer/src/agent/content/skills/', import.meta.url), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);

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

domainApp.get('/library-folders', async c => {
  const { data, error } = await admin.rpc('list_library_folders', { p_user_id: c.get('userId') });
  if (error) throw supabaseError(error.message);
  return c.json(envelope(data));
});
domainApp.post('/library-folders', async c => {
  const body = parseOrBadRequest(z.object({ name: z.string().trim().min(1).max(200), parentId: uuidSchema.nullable() }), await jsonBody(c));
  const { data, error } = await admin.from('library_folders').insert({ user_id: c.get('userId'), name: body.name, parent_id: body.parentId }).select('id').single();
  if (error?.code === '23503') throw badRequest('目标文件夹不存在或无权访问');
  if (error) throw supabaseError(error.message);
  return c.json(envelope(data));
});
domainApp.patch('/library-folders/:id', async c => {
  const id = parseOrBadRequest(uuidSchema, c.req.param('id'));
  const body = parseOrBadRequest(z.object({ name: z.string().trim().min(1).max(200) }), await jsonBody(c));
  const { data, error } = await admin.from('library_folders').update({ name: body.name }).eq('id', id).eq('user_id', c.get('userId')).select('id').maybeSingle();
  if (error) throw supabaseError(error.message);
  if (!data) throw notFound('文件夹不存在或无权访问');
  return c.json(envelope(data));
});
domainApp.delete('/library-folders/:id', async c => {
  const id = parseOrBadRequest(uuidSchema, c.req.param('id'));
  const { data, error } = await admin.from('library_folders').delete().eq('id', id).eq('user_id', c.get('userId')).select('id').maybeSingle();
  if (error) throw supabaseError(error.message);
  if (!data) throw notFound('文件夹不存在或无权访问');
  return c.json(envelope(null));
});

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

domainApp.get('/project/:id/bundle', async c => c.json(envelope(await store.loadProjectBundle(
  c.get('userId'), parseOrBadRequest(uuidSchema, c.req.param('id')),
))));
domainApp.put('/project/:id/bundle', async c => {
  const body = parseOrBadRequest(z.object({
    project: z.record(z.string(), z.unknown()),
    snapshots: z.array(z.object({ nodeId: z.string().min(1), payload: z.unknown() })),
    records: z.array(z.object({ nodeId: z.string().min(1), key: z.string().min(1), payload: z.unknown() })),
  }), await jsonBody(c));
  return c.json(envelope(await store.importProjectBundle(c.get('userId'), parseOrBadRequest(uuidSchema, c.req.param('id')), body as Json)));
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

domainApp.get('/settings/mobile', async c => c.json(envelope(pickMobileSettings(await store.loadSettings(c.get('userId'))))));
domainApp.patch('/settings/mobile', async c => {
  const patch = parseOrBadRequest(z.object({
    locale: z.enum(['zh-CN', 'en-US']).optional(),
    agentCanRunNodes: z.boolean().optional(), agentAutoEval: z.boolean().optional(), agentAutoLayout: z.boolean().optional(),
    agentPreferredTextModel: z.string().trim().max(200).optional(),
    agentPreferredImageModel: z.string().trim().max(200).optional(),
    agentPreferredVideoModel: z.string().trim().max(200).optional(),
  }).strict().refine(value => Object.keys(value).length === 1, 'Update one setting at a time'), await jsonBody(c));
  const [key, value] = Object.entries(patch)[0]!;
  await store.setSettingField(c.get('userId'), key, value);
  return c.json(envelope(pickMobileSettings(await store.loadSettings(c.get('userId')))));
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
    await jsonBody(c),
  );
  await store.setSettingField(userId, "activeTokenGroupId", body.activeTokenGroupId);
  return c.json(envelope(null, "已保存"));
});

// ---------------------------------------------------------------------------
// 目录（skills / recipes / assets / materials）
// ---------------------------------------------------------------------------
domainApp.get("/catalog/:kind", async (c): Promise<Response> => {
  const userId = c.get("userId");
  const kind = parseOrBadRequest(kindSchema, c.req.param("kind"));
  const catalog = await store.loadCatalog(userId, kind, CATALOG_FALLBACKS[kind] ?? {});
  if (kind === 'skills' && nativeSession(c) && catalog && typeof catalog === 'object' && !Array.isArray(catalog)) {
    return c.json(envelope({ ...catalog, systemSkillIds }));
  }
  return c.json(envelope(catalog));
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
  const id = parseOrBadRequest(z.string().regex(/^[a-z0-9_-]+$/i), c.req.param("id"));
  const payload = parseOrBadRequest(z.object({ snapshotId: z.literal(id), nodes: z.array(z.unknown()), edges: z.array(z.unknown()) }).passthrough(), await jsonBody(c));
  await store.saveClipboard(userId, id, payload as Json);
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
    await jsonBody(c),
  );
  await store.bindWorkspaceProject(userId, c.req.param("label"), body.projectId);
  return c.json(envelope(null, "已保存"));
});

// ---------------------------------------------------------------------------
// 对象存储
// ---------------------------------------------------------------------------
const bucketSchema = z.enum(["media", "assets"]);

domainApp.get('/files/remote', c => remoteMedia(c.req.query('url') || '', c.req.raw.signal, c.req.header('range')));

// 直传上传签名 URL
domainApp.post("/files/upload-url", async (c) => {
  const userId = c.get("userId");
  const body = parseOrBadRequest(
    z.object({ bucket: bucketSchema, key: z.string().min(1) }),
    await jsonBody(c),
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

domainApp.get("/files/content", async (c) => {
  const bucket = parseOrBadRequest(bucketSchema, c.req.query("bucket"));
  const key = scopedKey(c.get("userId"), c.req.query("key") ?? "");
  return c.redirect(await createSignedUrl(resolveBucket(bucket), key, 300), 302);
});

domainApp.delete("/files", async (c) => {
  const bucket = parseOrBadRequest(bucketSchema, c.req.query("bucket"));
  const key = scopedKey(c.get("userId"), c.req.query("key") ?? "");
  const { error } = await admin.storage.from(resolveBucket(bucket)).remove([key]);
  if (error) throw badRequest("无法删除对象");
  return c.json(envelope(null));
});

// ---------------------------------------------------------------------------
// AI 转发：透传 new-api /v1/*，不缓冲响应流
// ---------------------------------------------------------------------------
domainApp.all("/relay/*", async (c) => {
  const accessToken = c.get("accessToken");
  const incoming = new URL(c.req.url);
  const subpath = incoming.pathname.replace(/^\/api\/relay/, "") || "/";
  const target = new URL(relayPath(subpath, c.req.header('x-shotloom-provider') || '', c.req.header('x-shotloom-scope') || 'v1'), env.GATEWAY_BASE_URL);
  target.search = incoming.search;
  await assertPublishedRelay(c.req.raw, target.pathname);

  const headers = new Headers();
  for (const [key, value] of c.req.raw.headers.entries()) {
    if (!["content-type", "accept", "openai-beta", "anthropic-version", "anthropic-beta"].includes(key.toLowerCase())) {
      continue;
    }
    headers.set(key, value);
  }
  headers.set("Authorization", `Bearer ${accessToken}`);

  const init: RequestInit = { method: c.req.method, headers };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.raw.arrayBuffer();
  }

  let upstream = await fetch(target.toString(), { ...init, redirect: 'manual', signal: c.req.raw.signal });
  if (upstream.status === 401) {
    await upstream.body?.cancel();
    headers.set("Authorization", `Bearer ${await refreshSession(c.get('sessionId'))}`);
    upstream = await fetch(target.toString(), { ...init, redirect: 'manual', signal: c.req.raw.signal });
  }
  const resHeaders = new Headers(upstream.headers);
  resHeaders.delete("transfer-encoding");
  resHeaders.delete("content-length");
  resHeaders.delete("set-cookie");
  resHeaders.delete("location");
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
});
