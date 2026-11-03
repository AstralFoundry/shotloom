import { invoke } from '@tauri-apps/api/core';
import { canvasViewData } from '@/app/adapters/canvasAdapter';
import { saveProject, store } from '@/store/projectStore';
import { desktopApi } from '@/services/desktopApi';

type E2eHook = {
  click(selector: string): boolean;
  drag(from: string, to: string, durationMs?: number): boolean;
  editorState(): Record<string, unknown>;
  canvasState(): unknown;
  save(): Promise<unknown>;
  exportProject(): Promise<unknown>;
  screenshot(path?: string): Promise<unknown>;
};

declare global {
  interface Window { __SHOTLOOM_AGENT_E2E__?: E2eHook; }
}

export function installAgentE2eHook(): () => void {
  if (!import.meta.env.DEV || !window.__TAURI_INTERNALS__) return () => undefined;
  const hook: E2eHook = {
    click(selector) {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return false;
      element.click();
      return true;
    },
    drag(from, to, durationMs = 120) {
      const source = document.querySelector<HTMLElement>(from);
      const target = document.querySelector<HTMLElement>(to);
      if (!source || !target) return false;
      const start = source.getBoundingClientRect();
      const end = target.getBoundingClientRect();
      const event = (type: string, x: number, y: number) => new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 });
      source.dispatchEvent(event('mousedown', start.left + start.width / 2, start.top + start.height / 2));
      target.dispatchEvent(event('mousemove', end.left + end.width / 2, end.top + end.height / 2));
      target.dispatchEvent(event('mouseup', end.left + end.width / 2, end.top + end.height / 2));
      void durationMs;
      return true;
    },
    editorState: () => ({ route: store.route, projectDir: store.projectDir, projectId: store.project?.id, nodeCount: store.project?.nodes?.length || 0, edgeCount: store.project?.edges?.length || 0 }),
    canvasState: () => canvasViewData(),
    save: () => saveProject(),
    exportProject: () => desktopApi.project.exportPackage?.(store.projectDir, store.project?.name),
    screenshot: (path) => invoke('capture_agent_e2e_screen', { path }),
  };
  window.__SHOTLOOM_AGENT_E2E__ = hook;
  if (import.meta.env.VITE_SHOTLOOM_AGENT_E2E === '1') {
    window.setTimeout(() => {
      const interaction = {
        buttonClicked: hook.click('button[title="保存"]'),
        dragged: hook.drag('.canvas-node-semantic-frame', '.canvas-node-semantic-frame'),
        state: hook.editorState(),
        canvas: hook.canvasState(),
      };
      void Promise.allSettled([hook.save(), hook.exportProject(), hook.screenshot()]).then((results) => {
        console.info('[shotloom-agent-e2e]', interaction, results.map((item) => item.status));
      });
    }, 1800);
  }
  return () => { if (window.__SHOTLOOM_AGENT_E2E__ === hook) delete window.__SHOTLOOM_AGENT_E2E__; };
}
