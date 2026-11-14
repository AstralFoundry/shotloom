import { useCallback, useEffect, useState } from "react";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import {
  initializePlaybackBridge,
  disposePlaybackBridge,
} from "../bridges/playback-bridge";
import {
  initializeMediaBridge,
  disposeMediaBridge,
} from "../bridges/media-bridge";
import {
  initializeRenderBridge,
  disposeRenderBridge,
} from "../bridges/render-bridge";
import {
  initializeEffectsBridge,
  disposeEffectsBridge,
} from "../bridges/effects-bridge";
import { editorMessage, markShotloomEditorReady } from "../shotloom-mode";
import {
  initializeTransitionBridge,
  disposeTransitionBridge,
} from "../bridges/transition-bridge";

/**
 * Engine and bridge initialization hook
 * Ensures all engines and bridges are fully initialized before rendering editor
 */
export const useEditorInitialization = () => {
  const initialize = useEngineStore((state) => state.initialize);
  const initialized = useEngineStore((state) => state.initialized);
  const initializing = useEngineStore((state) => state.initializing);
  const initError = useEngineStore((state) => state.initError);
  const [bridgesReady, setBridgesReady] = useState(false);
  const [initStatus, setInitStatus] = useState(() => editorMessage("editor.startup.starting"));
  const [localError, setLocalError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLocalError(null);
    setBridgesReady(false);
    setAttempt((previous) => previous + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;
    let cancelWait: (() => void) | undefined;

    const initAll = async () => {
      try {
        const currentState = useEngineStore.getState();
        if (!currentState.initialized && !currentState.initializing) {
          setInitStatus(editorMessage("editor.startup.video"));
          await initialize();
        } else if (currentState.initializing) {
          await new Promise<void>((resolve) => {
            const unsubscribe = useEngineStore.subscribe((state) => {
              if (state.initialized || state.initError) {
                unsubscribe();
                cancelWait = undefined;
                resolve();
              }
            });
            cancelWait = () => {
              unsubscribe();
              resolve();
            };
          });
        }

        if (!isMounted) return;

        const engineState = useEngineStore.getState();
        if (!engineState.initialized) {
          throw new Error(
            engineState.initError || editorMessage("editor.startup.engineFailed"),
          );
        }

        setInitStatus(editorMessage("editor.startup.media"));
        await initializeMediaBridge();
        if (!isMounted) return;

        setInitStatus(editorMessage("editor.startup.playback"));
        await initializePlaybackBridge();
        if (!isMounted) return;

        setInitStatus(editorMessage("editor.startup.render"));
        await initializeRenderBridge();
        if (!isMounted) return;

        setInitStatus(editorMessage("editor.startup.effects"));
        const projectState = useProjectStore.getState();
        const { width, height } = projectState.project.settings;
        try {
          await initializeEffectsBridge(width, height);
        } catch (effectsError) {
          console.error(
            "[EditorInterface] EffectsBridge initialization failed:",
            effectsError,
          );
        }
        if (!isMounted) return;

        setInitStatus(editorMessage("editor.startup.transition"));
        try {
          initializeTransitionBridge(width, height);
        } catch (transitionError) {
          console.error(
            "[EditorInterface] TransitionBridge initialization failed:",
            transitionError,
          );
        }
        if (!isMounted) return;

        setBridgesReady(true);
        // Shotloom 的宿主桥必须等 effects/transition 也初始化完再收 load，
        // 否则 loadProject 的 bridge 同步会静默 no-op，恢复出来的特效/转场不渲染。
        markShotloomEditorReady();
      } catch (error) {
        console.error("Failed to initialize engines/bridges:", error);
        if (isMounted) {
          setLocalError(
            error instanceof Error ? error.message : editorMessage("editor.startup.unknown"),
          );
        }
      }
    };

    initAll();

    return () => {
      isMounted = false;
      cancelWait?.();
      disposePlaybackBridge();
      disposeMediaBridge();
      disposeRenderBridge();
      disposeEffectsBridge();
      disposeTransitionBridge();
    };
  }, [initialize, attempt]);

  const error = initError || localError;
  return {
    initialized: initialized && bridgesReady,
    initializing: initializing || (!bridgesReady && initialized),
    initError: error,
    initStatus: error ? editorMessage("editor.startup.error", { detail: error }) : initStatus,
    retry,
  };
};
