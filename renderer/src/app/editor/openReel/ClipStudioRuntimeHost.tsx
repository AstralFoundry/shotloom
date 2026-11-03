import { getLocale, t } from '@/i18n';
import { useEffect, useRef } from "react";
import { showToast } from "../../../store/notificationStore";
import { getAgentProjectKey } from "../../../services/agentProjectIdentity";
import { getAgentProjectIdentity, assertAgentProject } from "../../../services/agentProjectIdentity";
import { store } from "../../../store/projectStore";
import { desktopApi } from "../../../services/desktopApi";
import { createNativeEditorExport } from "../../../services/openReelNativeExport";
import { listEditorMediaCandidates, resolveEditorMediaAsset, type EditorMediaCandidate } from "../../../services/editorMediaCatalog";
import { buildAssetPayload } from "./projectBridge";
import type { ClipStudioHost, ClipStudioLayout, ClipStudioRuntimeController, ClipStudioRuntimeEvents, ClipStudioRuntimeModule } from "./runtimeTypes";

type RuntimeUI = Omit<ClipStudioHost["ui"], "notify" | "saveAgentFile">;
type Props = {
  nodeId: string;
  presentation: "canvas" | "editor";
  active: boolean;
  layout?: ClipStudioLayout | undefined;
  callbacks: ClipStudioRuntimeEvents & RuntimeUI;
  bindRuntime: (runtime: ClipStudioRuntimeController | null) => void;
  flushSnapshot: () => Promise<void>;
};

/** The local factory owns one module graph, DOM scope and React root per session. */
export function ClipStudioRuntimeHost(props: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const shadowRoot = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    const root = document.createElement("div");
    root.className = "clip-studio-root";
    shadowRoot.append(root);
    const persistenceKey = `${getAgentProjectKey()}:${props.nodeId}`;
    const owner = getAgentProjectIdentity();
    const projectDirectory = store.projectDir;
    const storageDirectory = () => {
      assertAgentProject(owner.projectKey, owner.instanceId, owner.generation);
      if (!projectDirectory) throw new Error(t("ui.ClipStudioRuntimeHost.text.d602a79a"));
      return projectDirectory;
    };
    const flushers = new Set<() => Promise<void>>();
    let runtime: ClipStudioRuntimeController | undefined;
    let cancelled = false;
    const nativeEncoder = desktopApi.platform !== 'browser' && store.projectDir
      ? createNativeEditorExport(store.projectDir, () => {
        assertAgentProject(owner.projectKey, owner.instanceId, owner.generation);
        if (cancelled || !store.project.nodes.some((node: { id: string }) => node.id === props.nodeId)) throw new Error(t("ui.ClipStudioRuntimeHost.text.3e17728f"));
      }) : undefined;
    const host: ClipStudioHost = {
      ...(nativeEncoder ? { nativeExport: nativeEncoder.bridge } : {}),
      ready: Promise.resolve(), persistenceKey,
      app: { locale: getLocale(), theme: "light" },
      project: {
        changed: () => { void runtime?.getState().catch(props.callbacks.onError); },
        bindFlush: (flush) => { flushers.add(flush); return () => { flushers.delete(flush); }; },
      },
      storage: {
        get: async (key) => desktopApi.project.getEditorRecord(storageDirectory(), props.nodeId, key),
        set: async (key, value) => { await desktopApi.project.setEditorRecord(storageDirectory(), props.nodeId, key, value); },
        delete: async (key) => { await desktopApi.project.setEditorRecord(storageDirectory(), props.nodeId, key, null); },
      },
      media: {
        fetchAgentMedia: async (url) => {
          assertAgentProject(owner.projectKey, owner.instanceId, owner.generation);
          if (!store.project.nodes.some((node: { id: string }) => node.id === props.nodeId)) throw new Error(t("ui.ClipStudioRuntimeHost.text.7554a1c0"));
          const parsed = new URL(url);
          if (parsed.protocol === 'data:' && url.startsWith('data:image/')) {
            const response = await fetch(url);
            return { bytes: await response.arrayBuffer(), mime: response.headers.get('content-type') || 'image/png' };
          }
          if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(t("ui.ClipStudioRuntimeHost.text.19787dca"));
          if (desktopApi.platform === 'browser') throw new Error(t("ui.ClipStudioRuntimeHost.text.21e6d8eb"));
          const downloaded = await desktopApi.file.downloadUrlToProject(url, parsed.pathname.split('/').pop() || 'media.bin');
          assertAgentProject(owner.projectKey, owner.instanceId, owner.generation);
          const path = downloaded?.filePath || downloaded?.path;
          if (!path) throw new Error(t("ui.ClipStudioRuntimeHost.text.ccbd7543"));
          const bytes = await desktopApi.file.readArrayBuffer(path);
          assertAgentProject(owner.projectKey, owner.instanceId, owner.generation);
          if (!store.project.nodes.some((node: { id: string }) => node.id === props.nodeId)) throw new Error(t("ui.ClipStudioRuntimeHost.text.7554a1c0"));
          return { bytes, mime: String(downloaded.mime || downloaded.contentType || '') };
        },
        listIncoming: async () => listEditorMediaCandidates(),
        read: async (candidate) => (await buildAssetPayload(await resolveEditorMediaAsset(candidate as EditorMediaCandidate))).bytes,
        removeOwned: async () => { throw new Error(t("ui.ClipStudioRuntimeHost.text.df172fa0")); },
      },
      ui: { ...props.callbacks, notify: (message) => { showToast(message); },
        saveAgentFile: async (filename, bytes) => {
          const assertOwner = () => {
            assertAgentProject(owner.projectKey, owner.instanceId, owner.generation);
            if (!store.project.nodes.some((node: { id: string }) => node.id === props.nodeId)) throw new Error(t("ui.ClipStudioRuntimeHost.text.7554a1c0"));
          };
          assertOwner();
          if (desktopApi.platform === 'browser' || !store.projectDir) throw new Error(t("ui.ClipStudioRuntimeHost.text.458e1a76"));
          if (!bytes.byteLength) throw new Error(t("ui.ClipStudioRuntimeHost.text.3422628d"));
          const safeName = filename.split(/[\\/]/).pop()?.replace(/[\\/:*?"<>|]/g, '-') || 'export.bin';
          const path = `${store.projectDir.replace(/[\\/]$/, '')}/assets/${crypto.randomUUID()}-${safeName}`;
          const result = await desktopApi.file.writeFileToPath(path, bytes);
          assertOwner();
          if (!result || result.filePath !== path || Number(result.size) !== bytes.byteLength) throw new Error(t("ui.ClipStudioRuntimeHost.text.d3f1ae3a"));
          return { filePath: result.filePath, filename: safeName, size: Number(result.size) };
        },
      },
    };
    void (async () => {
      const url = new URL("/openreel/embedded-runtime.js", window.location.href).href;
      const module = await import(/* @vite-ignore */ url) as ClipStudioRuntimeModule;
      if (cancelled) return;
      runtime = module.createRuntime({ root, shadowRoot, host, presentation: latest.current.presentation,
        active: latest.current.active, ...(latest.current.layout ? { layout: latest.current.layout } : {}), events: props.callbacks });
      await runtime.ready;
      if (cancelled) return;
      props.bindRuntime(runtime);
    })().catch((error: unknown) => {
      if (!cancelled) props.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    });
    return () => {
      cancelled = true;
      void nativeEncoder?.dispose();
      // Capture before detach, then release the engine even when persistence fails.
      const release = async () => {
        try {
          if (runtime) { await runtime.ready.catch(() => {}); await latest.current.flushSnapshot(); }
          for (const flush of flushers) await flush();
        } catch (error) { props.callbacks.onError(error instanceof Error ? error : new Error(String(error))); }
        finally { props.bindRuntime(null); await runtime?.dispose(); root.remove(); }
      };
      void release();
    };
  }, [props.nodeId, props.bindRuntime, props.callbacks]);
  return <div className="clip-studio-runtime-host" ref={elementRef} aria-label={t("ui.ClipStudioRuntimeHost.arialabel.d65719d8")} />;
}
