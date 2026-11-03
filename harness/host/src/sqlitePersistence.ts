import { Context } from '@deepseek-ai/cordis';
import Persistence, {
  SessionAlreadyExistsError, SessionAlreadyOwnedError, SessionHandleClosedError,
  SessionPersistenceNotFoundError, SessionReadOnlyError, SessionPersistenceRevision,
  materializeCreateHeader, materializeAppendBatch, assertVersion, assertContiguous, validateStoredEvents,
  type SessionHandle, type SessionAccess, type SessionPersistenceCreateOptions,
} from '@deepseek-ai/dsh-session-persistence';
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session';
import { SessionCrud } from './crud/sessionCrud.js';
import { openDatabase } from './db/connection.js';

/** Official persistence seam; the Agent loop, vocabulary and projections stay official. */
export default class SqlitePersistence extends Persistence {
  private database;
  private crud;
  private writers=new Map<string,SessionHandle>();
  private handles=new Set<SessionHandle>();
  private pending = new Map<string, SessionEvent[]>();
  constructor(ctx:Context, options:{path:string}) {
    super(ctx);
    this.database=openDatabase(options.path);
    this.crud=new SessionCrud(this.database);
    ctx.on('session/event',(session,event)=>{
      const writer=this.writers.get(session.id);
      if(!writer) return;
      const events=this.pending.get(session.id)??[];
      events.push(event);this.pending.set(session.id,events);
      try { this.drain(session.id); } catch(error) { ctx.logger.warn(`Session events retained for retry: ${String(error)}`); }
    });
    ctx.on('session/flush',session=>this.writers.get(session.id)?.flush());
    ctx.on('session/disposed',session=>{ void this.writers.get(session.id)?.close().catch(error=>ctx.logger.warn(String(error))); });
    ctx.effect(()=>async()=>{
      try { for(const handle of [...this.handles]) await handle.close(); }
      finally { this.database.close(); }
    });
  }
  private drain(id:SessionId) {
    const events=this.pending.get(id);
    if(!events?.length) return;
    const row=this.crud.find(id);if(!row)throw new SessionPersistenceNotFoundError(id);
    const batch=materializeAppendBatch(events);
    assertContiguous(id,batch,row.eventCount);validateStoredEvents(row.header,[...batch]);
    this.crud.append(id,batch,row.eventCount);
    this.pending.delete(id);
  }
  async create(header:SessionHeader, options?:SessionPersistenceCreateOptions):Promise<SessionHandle> {
    options?.signal?.throwIfAborted();
    const meta=materializeCreateHeader(header); assertVersion(meta);
    const inherited=Number(options?.inheritedEventCount??0);
    if(!Number.isSafeInteger(inherited)||inherited<0||(!meta.isSeeded&&inherited!==0)||(meta.isSeeded&&options?.inheritedEventCount===undefined)) throw new TypeError('Invalid inherited event count');
    if(this.crud.find(meta.id)) throw new SessionAlreadyExistsError(meta.id);
    this.crud.create(meta,inherited);
    return this.makeHandle(meta.id,'write');
  }
  async open(id:SessionId,access:SessionAccess,options?:{signal?:AbortSignal}) { options?.signal?.throwIfAborted(); return this.makeHandle(id,access); }
  private makeHandle(id:SessionId,access:SessionAccess):SessionHandle {
    const row=this.crud.find(id); if(!row) throw new SessionPersistenceNotFoundError(id);
    assertVersion(row.header);
    if(access==='write'&&this.writers.has(id)) throw new SessionAlreadyOwnedError(id);
    let closed=false;
    const check=()=>{if(closed)throw new SessionHandleClosedError(id, 'access');};
    const writable=(operation:string)=>{check();if(access!=='write')throw new SessionReadOnlyError(id,operation);};
    const handle:SessionHandle={
      id,header:structuredClone(row.header),inheritedEventCount:row.inheritedCount as SessionLogOffset,access,
      read:async(offset=0,length,options)=>{
        check();options?.signal?.throwIfAborted();
        if(!Number.isSafeInteger(offset)||offset<0||(length!==undefined&&(!Number.isSafeInteger(length)||length<0)))throw new RangeError('Invalid event slice');
        const events=this.crud.read(id,offset,length);
        validateStoredEvents(row.header,events);
        assertContiguous(id,events,offset);
        return {eventState:'detached',events};
      },
      append:async(events,options)=>{
        writable('append');options?.signal?.throwIfAborted();
        this.drain(id);
        const batch=materializeAppendBatch(events);
        const stored=this.crud.find(id)!;assertContiguous(id,batch,stored.eventCount);
        validateStoredEvents(row.header,[...batch]);
        this.crud.append(id,batch,stored.eventCount);
      },
      flush:async(options)=>{writable('flush');options?.signal?.throwIfAborted();this.drain(id);},
      close:async()=>{if(closed)return;if(access==='write'){await handle.flush();this.writers.delete(id);}closed=true;this.handles.delete(handle);},
      [Symbol.asyncDispose]:async()=>handle.close(),
    };
    this.handles.add(handle);if(access==='write')this.writers.set(id,handle);
    return handle;
  }
  async flush() {
    const failures:unknown[]=[];
    for(const writer of this.writers.values())try{await writer.flush();}catch(error){failures.push(error);}
    if(failures.length)throw new AggregateError(failures,'Agent persistence flush failed');
  }
  async stat(id:SessionId,options?:{signal?:AbortSignal}) {
    options?.signal?.throwIfAborted();const row=this.crud.find(id);
    return row?{header:row.header,eventCount:row.eventCount,revision:SessionPersistenceRevision(`${row.id}:${row.eventCount}`)}:undefined;
  }
  async list(options?:{signal?:AbortSignal}) {
    options?.signal?.throwIfAborted();return this.crud.list().map(row=>({header:row.header,eventCount:row.eventCount,revision:SessionPersistenceRevision(`${row.id}:${row.eventCount}`)}));
  }
}
