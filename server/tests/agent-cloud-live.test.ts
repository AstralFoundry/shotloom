import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';

test('official hosted Harness persists and resumes tenant-scoped Supabase state without local databases or shell', {
  skip: process.env.SHOTLOOM_LIVE_TESTS !== '1', timeout: 120_000,
}, async () => {
  const { admin, upsertUser, resolveBucket, scopedKey } = await import('../src/lib/supabase');
  const { agentPersistence } = await import('../src/lib/agentPersistence');
  const { agentAttachments } = await import('../src/lib/agentAttachments');
  const { startDesktopHost } = await import('../../harness/host/dist/desktopHost.js');
  const owner = await upsertUser(`agent-${randomUUID()}`, { username: 'Harness cloud test' });
  const other = await upsertUser(`agent-${randomUUID()}`, { username: 'Harness tenant test' });
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let dataRoot = await mkdtemp(join(tmpdir(), 'shotloom-cloud-agent-'));
  const persistence = agentPersistence(owner.id);
  const objects: string[] = [];
  const files = agentAttachments(owner.id, dataRoot);
  let desktop: Awaited<ReturnType<typeof startDesktopHost>> | undefined;
  try {
    const options = { dataRoot, contentRoot: join(root, 'renderer/src/agent/content'), rulesPath: join(root, 'AGENTS.md'),
      distIndex: join(root, 'harness/host/client-dist/index.html'), persistence, clientToolsOnly: true,
      attachmentStorage: { ...files, async publish(path: string, signal?: AbortSignal) {
        objects.push(scopedKey(owner.id, `agent/${relative(dataRoot, path).replace(/\\/g, '/')}`));
        await files.publish(path, signal);
      } },
      bridge: { receipts: persistence.host, dispatch: async () => ({ success: true }) },
    };
    desktop = await startDesktopHost(options);
    assert.equal(desktop.host.ctx.get('subprocess'), undefined);
    assert.ok(desktop.host.ctx.get('permissionPresets'));
    assert.throws(() => desktop!.host.ctx.shell.resolve(), /unavailable/);
    await assert.rejects(desktop.host.ctx.shell.execute({} as never), /unavailable/);
    const binding = { projectKey: randomUUID(), conversationId: randomUUID(), agentId: 'canvas-primary' as const };
    const bound = await desktop.bind({ binding, tools: [] });
    await desktop.host.ctx.sessionPersistence.flush();
    assert.ok(await persistence.sessions.find(bound.sessionId));
    assert.equal(await agentPersistence(other.id).sessions.find(bound.sessionId), undefined);
    const storedEvents = await persistence.sessions.read(bound.sessionId);
    const attachment = await desktop.host.ctx.attachments.saveFile({ data: new TextEncoder().encode('durable cloud attachment'), name: 'test.txt' });
    const { default: sharp } = await import('../../harness/host/node_modules/sharp/dist/index.mjs');
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
    const image = await desktop.host.ctx.attachments.saveImage({ data: png, mediaType: 'image/png' });
    assert.deepEqual((await desktop.setSessionsArchived(binding.projectKey, [bound.sessionId], true)).sessionIds, [bound.sessionId]);
    assert.ok(desktop.host.ctx.workspaceRegistry.archivedSessionIds.includes(bound.sessionId as never));
    await desktop.host.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    const saved = await persistence.sessions.find(bound.sessionId);
    assert.ok(saved);
    assert.equal((await admin.from('agent_sessions').update({ header: { ...saved.header, cwd: 'retired-runtime/workspace' } })
      .eq('user_id', owner.id).eq('id', bound.sessionId)).error, null);
    dataRoot = await mkdtemp(join(tmpdir(), 'shotloom-cloud-agent-restored-'));
    options.dataRoot = dataRoot;
    options.persistence = agentPersistence(owner.id, dataRoot);
    assert.ok((await options.persistence.sessions.list()).every(row => row.header.cwd?.startsWith(dataRoot)));
    const restoredFiles = agentAttachments(owner.id, dataRoot);
    options.attachmentStorage.restore = restoredFiles.restore;
    desktop = await startDesktopHost(options);
    assert.ok(desktop.host.ctx.workspaceRegistry.archivedSessionIds.includes(bound.sessionId as never), 'archive state survives a fresh cloud Host');
    const bytes: Uint8Array[] = [];
    for await (const chunk of desktop.host.ctx.attachments.readFileStream(attachment)) bytes.push(chunk);
    assert.equal(Buffer.concat(bytes).toString(), 'durable cloud attachment');
    assert.equal((await desktop.host.ctx.attachments.readImage(image)).ref.attachmentId, image.attachmentId);
    const restored = await desktop.bind({ binding, tools: [], sessionId: bound.sessionId });
    assert.equal(restored.sessionId, bound.sessionId);
    assert.equal(desktop.host.ctx.workspaceRegistry.archivedSessionIds.includes(bound.sessionId as never), false);
    const agent = desktop.host.ctx.agents.get(bound.sessionId as never)!;
    const cwd = desktop.host.ctx.workingDirectory.get(agent.session);
    assert.ok(desktop.host.ctx.fs.contains(await desktop.host.ctx.fs.resolve(dataRoot), await desktop.host.ctx.fs.resolve(cwd)), `${cwd} is outside ${dataRoot}`);
    assert.equal((await desktop.host.ctx.fs.stat(await desktop.host.ctx.fs.resolve(cwd)))?.type, 'directory');
    assert.deepEqual((await persistence.sessions.read(bound.sessionId)).slice(0, storedEvents.length), storedEvents);
    assert.deepEqual(await Promise.all([persistence.host.claimReceipt('one'), persistence.host.claimReceipt('one')]).then(values => values.sort()), [false, true]);
    await persistence.host.settleReceipt('one', { success: true });
    assert.deepEqual((await persistence.host.receipt('one'))?.payload, { success: true });
    assert.equal(await agentPersistence(other.id).host.receipt('one'), undefined);
    await assert.rejects(persistence.sessions.append(bound.sessionId, [{ seq: 999 } as never], storedEvents.length));
    const rows = Array.from({ length: 1105 }, (_, i) => ({
      user_id: owner.id, scope: 'records:test', key: JSON.stringify(['items', `item-${i}`]), payload: { i },
    }));
    assert.equal((await admin.from('agent_state').insert(rows)).error, null);
    assert.equal((await persistence.domain.records('test')).length, 1105);
    assert.deepEqual(await agentPersistence(other.id).domain.records('test'), []);
  } finally {
    await desktop?.host.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    if (objects.length) assert.equal((await admin.storage.from(resolveBucket('assets')).remove(objects)).error, null);
    const cleanup = await admin.from('users').delete().in('id', [owner.id, other.id]);
    assert.equal(cleanup.error, null);
  }
});
