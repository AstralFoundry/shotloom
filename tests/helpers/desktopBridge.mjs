/**
 * 测试用的桌面桥替身：形状与 Electron preload 暴露的 window.shotloomDesktop 一致。
 * 渲染进程的 desktop/ 传输层只认这个对象，测试不再伪造 Tauri 内核。
 */
export function installDesktopBridge({ invoke, platform = 'darwin', dialog, update, convertFileSrc } = {}) {
  const listeners = new Map();
  const disposed = [];
  window.shotloomDesktop = {
    invoke: invoke || (async () => null),
    listen(event, handler) {
      const set = listeners.get(event) || new Set();
      set.add(handler);
      listeners.set(event, set);
      return () => {
        set.delete(handler);
        disposed.push(event);
      };
    },
    createChannel() {
      return () => {};
    },
    convertFileSrc: convertFileSrc || ((path) => `shotloom://asset/${encodeURIComponent(path)}`),
    dialog: dialog || { open: async () => null, save: async () => null },
    window: {
      control: async () => null,
      onResized: () => () => {},
      onCloseRequested: () => () => {},
    },
    update: update || {
      check: async () => null,
      download: async () => ({ ok: false }),
      cancel: async () => ({ ok: true }),
      install: async () => ({ ok: false }),
      relaunch: async () => {},
      onProgress: () => () => {},
    },
    platform,
    versions: {},
  };
  return {
    bridge: window.shotloomDesktop,
    disposed,
    emit(event, payload) {
      for (const handler of [...(listeners.get(event) || [])]) handler(payload);
    },
    listenerCount(event) {
      return (listeners.get(event) || new Set()).size;
    },
  };
}
