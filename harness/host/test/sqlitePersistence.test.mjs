import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import Persistence from '../dist/sqlitePersistence.js';
import { openDatabase } from '../dist/db/connection.js';
import { HostCrud } from '../dist/crud/hostCrud.js';

test('SQLite receipts have exclusive claims, survive reopen and contain no JSON files', async () => {
  const root=await mkdtemp(join(tmpdir(),'shotloom-sqlite-receipt-'));
  try {
    const path=join(root,'agent.sqlite');
    let database=openDatabase(path);let crud=new HostCrud(database);
    assert.equal(crud.claimReceipt('one'),true);
    assert.equal(crud.claimReceipt('one'),false);
    crud.settleReceipt('one',{success:true,taskId:'real-task'});database.close();
    database=openDatabase(path);crud=new HostCrud(database);
    assert.deepEqual(crud.receipt('one').payload,{success:true,taskId:'real-task'});
    assert.equal(crud.claimReceipt('one'),false);database.close();
    assert.equal((await readFile(path)).subarray(0,16).toString(),'SQLite format 3\0');
  } finally {await rm(root,{recursive:true,force:true});}
});

test('SQLite official seam enforces writer ownership, read-only handles, closed handles and empty-session durability', async () => {
  const root=await mkdtemp(join(tmpdir(),'shotloom-sqlite-seam-'));
  const path=join(root,'agent.sqlite');
  let ctx=new Context();
  try {
    await ctx.plugin(Persistence,{path});
    const id=SessionId('sqlite-empty');
    // Obtain the current logical header vocabulary from the official Sessions package.
    const { default: Sessions }=await import('@deepseek-ai/dsh-session');
    await ctx.plugin(Sessions);
    const session=ctx.sessions.create(id,{cwd:root});
    const header=session.header;
    const writer=await ctx.sessionPersistence.create(header);
    await assert.rejects(ctx.sessionPersistence.open(id,'write'),/owned/i);
    const reader=await ctx.sessionPersistence.open(id,'read');
    await assert.rejects(reader.append([]),/read handle/i);
    await writer.flush();
    assert.equal((await ctx.sessionPersistence.stat(id)).eventCount,0);
    await reader.close();await assert.rejects(reader.read(),/closed/i);
    await writer.close();await ctx.fiber.dispose();
    ctx=new Context();await ctx.plugin(Persistence,{path});
    const restored=await ctx.sessionPersistence.open(id,'write');
    assert.deepEqual((await restored.read()).events,[]);
    await assert.rejects(restored.append([{seq:2,type:'unknown-required'}]));
    assert.equal((await ctx.sessionPersistence.stat(id)).eventCount,0);
    await restored.close();
  } finally {await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
