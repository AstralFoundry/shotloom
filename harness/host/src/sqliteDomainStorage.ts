import type { Context } from '@deepseek-ai/cordis';
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey, type KvUnit, type KvUnitDescriptor } from '@deepseek-ai/dsh-storage';
import { openDatabase } from './db/connection.js';
import { DomainCrud } from './crud/domainCrud.js';

export const name='shotloom-storage-sqlite';
export const inject=['storage'];
export function apply(ctx:Context, config:{path:string}) {
  const database=openDatabase(config.path);const crud=new DomainCrud(database);
  const units=new Map<string,KvUnit>();let closed=false;let closing:Promise<void>|undefined;
  const backend={
    kv:{async open(descriptor:KvUnitDescriptor):Promise<KvUnit> {
      if(closed)throw new StorageError('closed','SQLite domain backend closed');
      if(!UNIT_NAME_RE.test(descriptor.name)||descriptor.tables.some(table=>!UNIT_NAME_RE.test(table))||new Set(descriptor.tables).size!==descriptor.tables.length||!Number.isInteger(descriptor.version)||descriptor.version<0)throw new StorageError('malformed-medium','Invalid storage unit identity');
      descriptor=structuredClone(descriptor);
      if(units.has(descriptor.name))throw new Error(`Storage unit already open: ${descriptor.name}`);
      crud.create(descriptor);
      const stored=crud.unit(descriptor.name)!;
      if(stored.descriptor.version!==descriptor.version)throw new StorageError('version-mismatch',descriptor.name);
      if(stored.descriptor.hasGlobal!==descriptor.hasGlobal||JSON.stringify([...stored.descriptor.tables].sort())!==JSON.stringify([...descriptor.tables].sort()))throw new StorageError('malformed-medium','Storage unit shape mismatch');
      let unitClosed=false;
      const check=(table?:string)=>{
        if(closed||unitClosed)throw new StorageError('closed',descriptor.name);
        if(table!==undefined&&!descriptor.tables.includes(table))throw new StorageError('malformed-medium',`Unknown table ${table}`);
      };
      const unit:KvUnit={
        async loadAll() {
          check();const tables:Record<string,Record<string,unknown>>=Object.fromEntries(descriptor.tables.map(table=>[table,Object.create(null)]));
          for(const row of crud.records(descriptor.name)) {check(row.table);tables[row.table]![row.key]=row.payload;}
          return {tables,global:crud.unit(descriptor.name)!.global??null};
        },
        async putRecord(table,key,value) {check(table);if(descriptor.layout==='per-record'&&!/^[a-zA-Z0-9_-]+$/.test(key))throw new StorageError('malformed-medium','Invalid record key');crud.put(descriptor.name,table,key,value);},
        async deleteRecord(table,key) {check(table);if(descriptor.layout==='per-record'&&!/^[a-zA-Z0-9_-]+$/.test(key))throw new StorageError('malformed-medium','Invalid record key');crud.remove(descriptor.name,table,key);},
        async setGlobal(value) {check();if(!descriptor.hasGlobal)throw new StorageError('malformed-medium','Unit has no global slot');crud.setGlobal(descriptor.name,value);},
        async close() {if(unitClosed)return;unitClosed=true;units.delete(descriptor.name);},
      };
      units.set(descriptor.name,unit);return unit;
    }},
    close() {if(closing)return closing;closed=true;closing=(async()=>{for(const unit of [...units.values()])await unit.close();database.close();})();return closing;},
  };
  ctx.effect(()=>{const unregister=ctx.storage.backend.register('sqlite',backend);return async()=>{unregister();await backend.close();};});
  ctx.provide(storageBackendServiceKey('sqlite'),backend);
}
