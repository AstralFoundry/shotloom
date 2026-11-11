import type { startDesktopHost } from './desktopHost.js';

/** The inherited native pipe is the carrier boundary. No browser login or cookies. */
export function nativeTransport(desktop: Awaited<ReturnType<typeof startDesktopHost>>, send: (message: unknown) => void) {
  const streams = new Map<string, { control: AbortController; inbox: unknown[]; wake?: () => void }>();
  const fetchHandler = desktop.host.ctx.connection.createSharedFetchHandler('/api');
  return async (message: { requestId: string; kind: string; payload?: any }) => {
    const { requestId, kind, payload } = message;
    try {
      if (kind === 'cancel') { streams.get(requestId)?.control.abort(); streams.get(requestId)?.wake?.(); return; }
      if (kind === 'uplink') { const stream = streams.get(requestId); if (stream) { stream.inbox.push(payload); stream.wake?.(); } return; }
      if (kind === 'bind') {
        send({ requestId, kind: 'result', value: await desktop.bind(payload) }); return;
      }
      if (kind === 'set-sessions-archived') {
        send({ requestId, kind: 'result', value: await desktop.setSessionsArchived(payload.projectKey, payload.sessionIds, payload.archived) }); return;
      }
      if (kind === 'fetch') {
        const path = new URL(payload.path, 'http://native.invalid');
        if (path.origin !== 'http://native.invalid' || !path.pathname.startsWith('/api/')) throw new Error('Invalid native API route');
        const response = await fetchHandler.fetch(new Request(path, { method: payload.method ?? 'POST',
          headers: payload.headers, ...(payload.body === undefined ? {} : { body: Buffer.from(payload.body, 'base64') }) }));
        send({ requestId, kind: 'result', value: { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()).toString('base64') } }); return;
      }
      if (kind === 'stream') {
        if (streams.has(requestId)) throw new Error('Stream already exists');
        const control = new AbortController();
        const stream: { control: AbortController; inbox: unknown[]; wake?: () => void } = { control, inbox: [] };
        streams.set(requestId, stream);
        const uplink = { async *[Symbol.asyncIterator]() {
          while (!control.signal.aborted) {
            if (!stream.inbox.length) await new Promise<void>(resolve => { stream.wake = resolve; });
            while (stream.inbox.length) yield stream.inbox.shift();
          }
        } };
        try {
          const source = await desktop.host.ctx.typertGateway.wireStream.open(payload.endpoint, payload.payload, uplink, undefined, control.signal);
          for await (const value of source) send({ requestId, kind: 'item', value });
          send({ requestId, kind: 'end' });
        } finally { control.abort(); stream.wake?.(); streams.delete(requestId); }
        return;
      }
      throw new Error('Unknown native transport operation');
    } catch (error) {
      send({ requestId, kind: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  };
}
