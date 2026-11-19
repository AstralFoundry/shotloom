import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

Object.assign(process.env, {
  NODE_ENV: 'test', GATEWAY_BASE_URL: 'https://gateway.example.com', GATEWAY_CLIENT_ID: 'nac_test',
  GATEWAY_CLIENT_SECRET: 'test-secret', GATEWAY_REDIRECT_URI: 'http://localhost:5173/api/auth/callback',
  FRONTEND_URL: 'http://localhost:5173', SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
  SESSION_ENCRYPTION_KEY: '11'.repeat(32),
});
const { app } = await import('../src/index');
const { encrypt } = await import('../src/lib/crypto');

test('feedback, administrator reply and inbox persist through the HTTP boundary with real Postgres transactions', async () => {
  const db = new PGlite();
  const originalFetch = globalThis.fetch;
  const user = randomUUID(), other = randomUUID(), admin = randomUUID(), foreign = randomUUID();
  const sessions = new Map([[randomUUID(), user], [randomUUID(), other], [randomUUID(), admin], [randomUUID(), foreign]]);
  let sessionReads = 0;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema shotloom;
      grant usage on schema shotloom to service_role;
      create table shotloom.users(id uuid primary key, client_id text not null);
      grant select on shotloom.users to service_role;`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261115131802_shotloom_model_administration.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261116060731_shotloom_support_notifications.sql', import.meta.url), 'utf8'));
    for (const [id, client] of [[user, 'nac_test'], [other, 'nac_test'], [admin, 'nac_test'], [foreign, 'other-app']]) {
      await db.query('insert into shotloom.users values($1,$2)', [id, client]);
    }
    await db.query('insert into shotloom.app_admins values($1,$2)', ['nac_test', admin]);
    await db.exec('set role service_role');
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const table = url.pathname.split('/').at(-1);
      if (table === 'sessions') {
        sessionReads++;
        const sessionId = url.searchParams.get('id')?.slice(3) || '';
        const userId = sessions.get(sessionId);
        assert.equal(url.searchParams.get('owner.client_id'), 'eq.nac_test');
        const owner = await db.query('select id from shotloom.users where id=$1 and client_id=$2', [userId, 'nac_test']);
        return Response.json(owner.rows[0] ? { id: sessionId, user_id: userId, owner: { ...owner.rows[0], sub: '1', username: null, email: null }, access_token_cipher: encrypt('token'),
          refresh_token_cipher: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() } : null);
      }
      if (table === 'users') {
        const value = await db.query('select id from shotloom.users where id=$1 and client_id=$2', [url.searchParams.get('id')?.slice(3), url.searchParams.get('client_id')?.slice(3)]);
        return Response.json(value.rows[0] || null);
      }
      if (table === 'app_admins') {
        const value = await db.query('select user_id from shotloom.app_admins where user_id=$1 and client_id=$2', [url.searchParams.get('user_id')?.slice(3), url.searchParams.get('client_id')?.slice(3)]);
        return Response.json(value.rows[0] || null);
      }
      if (table === 'support_action') {
        const args = JSON.parse(String(init?.body));
        assert.equal(args.p_client_id, 'nac_test');
        try {
          const value = await db.query<{ value: unknown }>('select shotloom.support_action($1,$2,$3,$4) as value',
            [args.p_client_id, args.p_actor_id, args.p_action, args.p_value]);
          return Response.json(value.rows[0]!.value);
        } catch (error) {
          return Response.json({ code: (error as { code: string }).code, message: 'database rejected request' }, { status: 400 });
        }
      }
      assert.fail(`Unexpected fetch ${url}`);
    };
    const request = (actor: string, path: string, method = 'GET', value?: unknown) => app.request(`/api${path}`, {
      method, headers: { cookie: `shotloom_session=${[...sessions].find(([, id]) => id === actor)?.[0]}`,
        origin: 'http://localhost:5173', 'content-type': 'application/json' },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    const data = async (response: Response, status = 200) => { const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body.data; };
    for (const path of ['/feedback', `/feedback/${randomUUID()}`, '/notifications', '/admin/feedback', `/admin/feedback/${randomUUID()}`]) {
      assert.equal((await app.request(`/api${path}`)).status, 401, `${path} must remain authenticated`);
    }
    assert.equal((await request(foreign, '/feedback')).status, 401);
    assert.equal((await request(user, '/feedback', 'POST', { description: '' })).status, 400);
    assert.equal((await request(user, '/feedback', 'POST', { id: randomUUID(), kind: 'feedback', description: 'ok', user_id: other })).status, 400);
    const submission = { id: randomUUID(), kind: 'report', description: 'A problem on my canvas', reference: 'Node A' };
    const saved = await data(await request(user, '/feedback', 'POST', submission), 201);
    assert.equal(saved.user_id, user); assert.equal(saved.status, 'pending');
    await data(await request(user, '/feedback', 'POST', submission), 201);
    const beforeList = sessionReads;
    assert.equal((await data(await request(user, '/feedback'))).total, 1);
    assert.equal(sessionReads - beforeList, 1, 'feedback list must authenticate exactly once');
    assert.equal((await request(user, '/feedback', 'POST', { ...submission, description: 'changed' })).status, 409);
    assert.equal((await data(await request(other, '/feedback'))).total, 0);
    assert.equal((await request(other, `/feedback/${saved.id}`)).status, 404);
    assert.equal((await request(user, '/admin/feedback')).status, 403);
    assert.equal((await request(user, `/admin/feedback/${saved.id}/replies`, 'POST', { replyId: randomUUID(), body: 'spoof' })).status, 403);
    assert.equal((await data(await request(admin, '/admin/feedback?kind=report&status=pending'))).total, 1);
    const reply = { replyId: randomUUID(), body: 'We are investigating.' };
    await data(await request(admin, `/admin/feedback/${saved.id}/replies`, 'POST', reply), 201);
    await data(await request(admin, `/admin/feedback/${saved.id}/replies`, 'POST', reply), 201);
    const thread = await data(await request(user, `/feedback/${saved.id}`));
    assert.equal(thread.replies.length, 1); assert.equal(thread.replies[0].body, reply.body);
    assert.equal(thread.item.revision, 2);
    const beforeInbox = sessionReads;
    const inbox = await data(await request(user, '/notifications'));
    assert.equal(sessionReads - beforeInbox, 1, 'notification list must authenticate exactly once');
    assert.equal(inbox.unread, 1); assert.equal(inbox.total, 1); assert.equal(inbox.items[0].feedback_id, saved.id);
    assert.equal((await data(await request(other, '/notifications'))).total, 0);
    assert.equal((await request(other, `/notifications/${inbox.items[0].id}/read`, 'PUT')).status, 404);
    await data(await request(user, `/notifications/${inbox.items[0].id}/read`, 'PUT'));
    await data(await request(user, `/notifications/${inbox.items[0].id}/read`, 'PUT'));
    assert.equal((await data(await request(user, '/notifications'))).unread, 0);
    await data(await request(admin, `/admin/feedback/${saved.id}/replies`, 'POST', { replyId: randomUUID(), body: 'Second reply' }), 201);
    await data(await request(user, '/notifications/read-all', 'PUT', { asOf: inbox.asOf }));
    assert.equal((await data(await request(user, '/notifications'))).unread, 1, 'mark all must not consume later replies');
    const latest = await data(await request(user, '/notifications'));
    await data(await request(user, '/notifications/read-all', 'PUT', { asOf: latest.asOf }));
    assert.equal((await data(await request(user, '/notifications'))).unread, 0);
    assert.equal((await request(admin, `/admin/feedback/${saved.id}/status`, 'PUT', { revision: 1, status: 'resolved' })).status, 409);
    const current = await data(await request(admin, `/admin/feedback/${saved.id}`));
    await data(await request(admin, `/admin/feedback/${saved.id}/status`, 'PUT', { revision: current.item.revision, status: 'resolved' }));
    assert.equal((await data(await request(user, `/feedback/${saved.id}`))).item.status, 'resolved');
    assert.equal((await request(user, '/feedback?limit=1000')).status, 400);
    assert.equal((await request(user, '/notifications?offset=-1')).status, 400);
    assert.equal((await request(user, '/notifications/read-all', 'PUT', { asOf: new Date(Date.now() + 3600000).toISOString() })).status, 400);
    const audit = await db.query('select * from shotloom.admin_audit');
    assert.equal(audit.rows.length, 3, 'duplicate replies must not create audit entries');
    // Force a failure after the reply insert to verify the whole transaction rolls back.
    await db.exec('reset role; alter table shotloom.inbox_notifications add constraint test_failure check(body <> \'rollback\'); set role service_role;');
    assert.equal((await request(admin, `/admin/feedback/${saved.id}/replies`, 'POST', { replyId: randomUUID(), body: 'rollback' })).status, 400);
    assert.equal((await data(await request(user, `/feedback/${saved.id}`))).replies.length, 2);
    await db.exec('reset role;');
    await db.query('delete from shotloom.app_admins where user_id=$1', [admin]);
    await db.exec('set role service_role;');
    assert.equal((await request(admin, `/admin/feedback/${saved.id}/replies`, 'POST', { replyId: randomUUID(), body: 'revoked' })).status, 403);
    await db.exec('reset role; set role authenticated;');
    await assert.rejects(db.query('select * from shotloom.feedback'), /permission denied/);
    await assert.rejects(db.query('select shotloom.support_action($1,$2,$3,$4)', ['nac_test', user, 'list', { offset: 0, limit: 20 }]), /permission denied/);
  } finally { globalThis.fetch = originalFetch; await db.close(); }
});
