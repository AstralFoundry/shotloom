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
import type { PersistenceBackend } from './persistenceBackend.js';
import { isDeepStrictEqual } from 'node:util';

/** Official persistence seam; the Agent loop, vocabulary and projections stay official. */
export default class SqlitePersistence extends Persistence {
  private database?: ReturnType<typeof openDatabase>;
  private crud: PersistenceBackend['sessions'];
  private writers=new Map<string,SessionHandle>();
  private handles=new Set<SessionHandle>();
  private pending = new Map<string, SessionEvent[]>();
  private tails = new Map<string, Promise<void>>();
  constructor(ctx:Context, options:{path:string; crud?:PersistenceBackend['sessions']}) {
    super(ctx);
    this.database=options.crud ? undefined : openDatabase(options.path);
    this.crud=options.crud ?? new SessionCrud(this.database!);
    ctx.on('session/event',(session,event)=>{
      const writer=this.writers.get(session.id);
      if(!writer) return;
      const events=this.pending.get(session.id)??[];
      events.push(event);this.pending.set(session.id,events);
      void this.commit(session.id).catch(error=>ctx.logger.warn(`Session events retained for retry: ${String(error)}`));
    });
    ctx.on('session/flush',session=>this.writers.get(session.id)?.flush());
    ctx.on('session/disposed',session=>{ void this.writers.get(session.id)?.close().catch(error=>ctx.logger.warn(String(error))); });
    ctx.effect(()=>async()=>{
      try { for(const handle of [...this.handles]) await handle.close(); }
      finally { this.database?.close(); }
    });
  }
  private commit(id:SessionId, additional?:readonly SessionEvent[]) {
    const work=(this.tails.get(id)??Promise.resolve()).then(async()=>{
      const events=this.pending.get(id);
      for(const source of [events?.slice(),additional]) {
        if(!source?.length)continue;
        const row=await this.crud.find(id);if(!row)throw new SessionPersistenceNotFoundError(id);
        let batch=materializeAppendBatch(source);
        const acknowledged=Math.min(batch.length,row.eventCount-batch[0]!.seq);
        if(acknowledged>0) {
          const stored=await this.crud.read(id,batch[0]!.seq,acknowledged);
          if(!isDeepStrictEqual(stored,batch.slice(0,acknowledged))) throw new Error('Persisted Session prefix differs from pending events');
          if(source!==additional)events!.splice(0,acknowledged);
          batch=batch.slice(acknowledged);
        }
        if(!batch.length)continue;
        assertContiguous(id,batch,row.eventCount);validateStoredEvents(row.header,[...batch]);
        await this.crud.append(id,batch,row.eventCount);
        if(source!==additional)events!.splice(0,batch.length);
      }
    });
    const settled=work.then(()=>{},()=>{});
    this.tails.set(id,settled);
    void settled.then(()=>{if(this.tails.get(id)===settled)this.tails.delete(id);});
    return work;
  }
  async create(header:SessionHeader, options?:SessionPersistenceCreateOptions):Promise<SessionHandle> {
    options?.signal?.throwIfAborted();
    const meta=materializeCreateHeader(header); assertVersion(meta);
    const inherited=Number(options?.inheritedEventCount??0);
    if(!Number.isSafeInteger(inherited)||inherited<0||(!meta.isSeeded&&inherited!==0)||(meta.isSeeded&&options?.inheritedEventCount===undefined)) throw new TypeError('Invalid inherited event count');
    if(await this.crud.find(meta.id)) throw new SessionAlreadyExistsError(meta.id);
    await this.crud.create(meta,inherited);
    return this.makeHandle(meta.id,'write');
  }
  async open(id:SessionId,access:SessionAccess,options?:{signal?:AbortSignal}) { options?.signal?.throwIfAborted(); return this.makeHandle(id,access); }
  private async makeHandle(id:SessionId,access:SessionAccess):Promise<SessionHandle> {
    const row=await this.crud.find(id); if(!row) throw new SessionPersistenceNotFoundError(id);
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
        const events=await this.crud.read(id,offset,length);
        validateStoredEvents(row.header,events);
        assertContiguous(id,events,offset);
        return {eventState:'detached',events};
      },
      append:async(events,options)=>{
        writable('append');options?.signal?.throwIfAborted();
        await this.commit(id,events);
      },
      flush:async(options)=>{writable('flush');options?.signal?.throwIfAborted();await this.commit(id);},
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
    options?.signal?.throwIfAborted();const row=await this.crud.find(id);
    return row?{header:row.header,eventCount:row.eventCount,revision:SessionPersistenceRevision(`${row.id}:${row.eventCount}`)}:undefined;
  }
  async list(options?:{signal?:AbortSignal}) {
    options?.signal?.throwIfAborted();return (await this.crud.list()).map(row=>({header:row.header,eventCount:row.eventCount,revision:SessionPersistenceRevision(`${row.id}:${row.eventCount}`)}));
  }
}
