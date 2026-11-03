import { and, asc, eq, gte } from 'drizzle-orm';
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session';
import type { AgentDatabase } from '../db/connection.js';
import { sessions, sessionEvents } from '../db/schema.js';

export class SessionCrud {
  constructor(private db: AgentDatabase) {}
  find(id:string) { return this.db.orm.select().from(sessions).where(eq(sessions.id,id)).get(); }
  list() { return this.db.orm.select().from(sessions).all(); }
  create(header:SessionHeader, inheritedCount:number) { this.db.orm.insert(sessions).values({id:header.id,header,inheritedCount}).run(); }
  read(id:string, offset=0, length?:number) {
    const query=this.db.orm.select().from(sessionEvents).where(and(eq(sessionEvents.sessionId,id),gte(sessionEvents.seq,offset))).orderBy(asc(sessionEvents.seq));
    return (length===undefined ? query.all() : query.limit(length).all()).map(row=>row.payload);
  }
  append(id:string, events:readonly SessionEvent[], expected:number) {
    this.db.orm.transaction(tx=>{
      const stored=tx.select().from(sessions).where(eq(sessions.id,id)).get();
      if(!stored || stored.eventCount!==expected) throw new Error('Session append revision conflict');
      for(const event of events) tx.insert(sessionEvents).values({sessionId:id,seq:event.seq,payload:event}).run();
      tx.update(sessions).set({eventCount:expected+events.length}).where(eq(sessions.id,id)).run();
    });
  }
}
