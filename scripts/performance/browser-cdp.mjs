import assert from 'node:assert/strict';

// Attach only to the caller's dedicated agent-browser session.
export async function connectPage(endpoint) {
  const targets = await (await fetch(`${endpoint}/json/list`)).json();
  const target = targets.find(value => value.type === 'page' && value.url.includes('shotloom.0xfiang.com'));
  assert.ok(target, 'The dedicated Shotloom browser page must already be open');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), listeners = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id); clearTimeout(task.timer);
      if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
    } else for (const handler of listeners.get(message.method) || []) handler(message.params);
  };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const call = ++id;
      const timer = setTimeout(() => { pending.delete(call); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
      pending.set(call, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: call, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function wait(expression, timeout = 30000) {
    const deadline = Date.now() + timeout;
    do {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(`Page readiness timeout: ${expression}`);
  }
  await send('Page.enable'); await send('Network.enable');
  return { send, evaluate, wait, on(method, handler) { const list = listeners.get(method) || []; list.push(handler); listeners.set(method, list); }, close() { socket.close(); } };
}
