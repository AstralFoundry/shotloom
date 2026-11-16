import { nativeRequestAllowed, type NativeReply, type NativeRequest } from '../../../shared/nativeBridge';

export class NativeApi {
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private send: (request: NativeRequest) => void, private uuid: () => string) {}
  request<T>(path: string, method = 'GET', value?: unknown): Promise<T> {
    if (!nativeRequestAllowed(method, path)) return Promise.reject(new Error('Request is unavailable'));
    const id = this.uuid();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Connection timed out. Please retry.')); }, 30000);
      this.pending.set(id, { resolve: result => resolve(result as T), reject, timer });
      try { this.send({ id, method, path, ...(value === undefined ? {} : { value }) }); }
      catch (error) { this.receive({ type: 'response', id, error: error instanceof Error ? error.message : String(error) }); }
    });
  }
  receive(reply: NativeReply) {
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(reply.id);
    if (reply.error) pending.reject(Object.assign(new Error(reply.error), { status: reply.status }));
    else pending.resolve(reply.data);
  }
  disconnect() {
    for (const [id] of this.pending) this.receive({ type: 'response', id, error: 'Connection interrupted. Please retry.' });
  }
}
