import { eq } from 'drizzle-orm';
import type { AgentDatabase } from '../db/connection.js';
import { bindings, catalogs, receipts } from '../db/schema.js';

export class HostCrud {
  constructor(private db: AgentDatabase) {}
  bindings() { return this.db.orm.select().from(bindings).all().map(row=>row.payload); }
  saveBindings(rows:Record<string,unknown>[]) {
    this.db.orm.transaction(tx=>{
      tx.delete(bindings).run();
      for(const payload of rows) tx.insert(bindings).values({sessionId:String(payload.sessionId),payload}).run();
    });
  }
  catalogs() { return this.db.orm.select().from(catalogs).all().map(row=>row.payload); }
  saveCatalog(key:string,payload:Record<string,unknown>) {
    this.db.orm.insert(catalogs).values({key,payload}).onConflictDoUpdate({target:catalogs.key,set:{payload}}).run();
  }
  receipt(requestId:string) { return this.db.orm.select().from(receipts).where(eq(receipts.requestId,requestId)).get(); }
  claimReceipt(requestId:string) {
    return this.db.orm.insert(receipts).values({requestId,status:'dispatching'}).onConflictDoNothing().run().changes===1;
  }
  settleReceipt(requestId:string,payload:unknown) {
    this.db.orm.update(receipts).set({status:'settled',payload}).where(eq(receipts.requestId,requestId)).run();
  }
}
