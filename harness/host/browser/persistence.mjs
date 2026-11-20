import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// 复用现有持久层合同；每条会话和业务回执独立存文件，避免附件写入重写完整历史。
export function browserPersistence(root = '/dsh/state') {
  const name = value => createHash('sha256').update(value).digest('hex');
  const read = async (path, fallback) => {
    try { return JSON.parse(await readFile(`${root}/${path}.json`, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return fallback; }
  };
  const write = async (path, value) => {
    await mkdir(`${root}/${path.split('/').slice(0, -1).join('/')}`, { recursive: true });
    await writeFile(`${root}/${path}.json`, JSON.stringify(value));
  };
  const sessionPath = id => `sessions/${name(id)}`;
  const backend = {
    sessions: {
      find: id => read(sessionPath(id)),
      async list() { return Promise.all((await read('session-list', [])).map(id => read(sessionPath(id)))); },
      async create(header, inheritedCount) {
        if (await read(sessionPath(header.id))) throw new Error('Session already exists');
        await write(sessionPath(header.id), { id: header.id, header, inheritedCount, eventCount: 0 });
        await write('session-list', [...await read('session-list', []), header.id]);
      },
      async read(id, offset = 0, length) {
        const row = await read(sessionPath(id));
        if (!row) return [];
        const end = length === undefined ? row.eventCount : Math.min(row.eventCount, offset + length);
        const events = [];
        for (let seq = offset; seq < end; seq++) events.push(await read(`events/${name(id)}/${seq}`));
        return events;
      },
      async append(id, events, expected) {
        const row = await read(sessionPath(id));
        if (!row || row.eventCount !== expected) throw new Error('Session append revision conflict');
        for (const [index, event] of events.entries()) await write(`events/${name(id)}/${expected + index}`, event);
        await write(sessionPath(id), { ...row, eventCount: expected + events.length });
      },
    },
    host: {
      bindings: () => read('bindings', []), saveBindings: rows => write('bindings', rows),
      async catalogs() { return Object.values(await read('catalogs', {})); },
      async saveCatalog(key, payload) { const rows = await read('catalogs', {}); rows[key] = payload; await write('catalogs', rows); },
      receipt: id => read(`receipts/${name(id)}`),
      async claimReceipt(id) {
        const path = `receipts/${name(id)}`;
        if (await read(path)) return false;
        await write(path, { requestId: id, status: 'dispatching' });
        await globalThis.shotloomBrowserHost.barrier();
        return true;
      },
      async settleReceipt(id, payload) {
        await write(`receipts/${name(id)}`, { requestId: id, status: 'settled', payload });
        await globalThis.shotloomBrowserHost.barrier();
      },
    },
    domain: {
      unit: unit => read(`units/${name(unit)}`),
      async create(descriptor) {
        if (!await read(`units/${name(descriptor.name)}`)) await write(`units/${name(descriptor.name)}`, { descriptor, global: null });
      },
      records: unit => read(`records/${name(unit)}`, []),
      async put(unit, table, key, payload) {
        const path = `records/${name(unit)}`, rows = await read(path, []);
        const index = rows.findIndex(row => row.table === table && row.key === key);
        if (index >= 0) rows[index] = { table, key, payload }; else rows.push({ table, key, payload });
        await write(path, rows);
      },
      async remove(unit, table, key) {
        const path = `records/${name(unit)}`;
        await write(path, (await read(path, [])).filter(row => row.table !== table || row.key !== key));
      },
      async setGlobal(unit, global) { const path = `units/${name(unit)}`; await write(path, { ...await read(path), global }); },
    },
  };
  // 同一 Worker 的并发子会话共享目录与设置，读改写必须串行，避免覆盖其他会话的新记录。
  let pending = Promise.resolve();
  for (const area of Object.values(backend)) for (const [key, method] of Object.entries(area)) {
    area[key] = (...args) => {
      const work = pending.then(() => method(...args));
      pending = work.then(() => {}, () => {});
      return work;
    };
  }
  return backend;
}
