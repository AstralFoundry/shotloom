import { and, eq } from 'drizzle-orm';
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage';
import type { AgentDatabase } from '../db/connection.js';
import { storageUnits, storageRecords } from '../db/schema.js';

export class DomainCrud {
  constructor(private db:AgentDatabase) {}
  unit(name:string) {return this.db.orm.select().from(storageUnits).where(eq(storageUnits.name,name)).get();}
  create(descriptor:KvUnitDescriptor) {this.db.orm.insert(storageUnits).values({name:descriptor.name,descriptor}).onConflictDoNothing().run();}
  records(unit:string) {return this.db.orm.select().from(storageRecords).where(eq(storageRecords.unit,unit)).all();}
  put(unit:string,table:string,key:string,payload:unknown) {
    this.db.orm.insert(storageRecords).values({unit,table,key,payload}).onConflictDoUpdate({target:[storageRecords.unit,storageRecords.table,storageRecords.key],set:{payload}}).run();
  }
  remove(unit:string,table:string,key:string) {
    this.db.orm.delete(storageRecords).where(and(eq(storageRecords.unit,unit),eq(storageRecords.table,table),eq(storageRecords.key,key))).run();
  }
  setGlobal(unit:string,global:unknown) {this.db.orm.update(storageUnits).set({global}).where(eq(storageUnits.name,unit)).run();}
}
