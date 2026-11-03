import { editorMessage } from "../shotloom-mode";
import {
  TransitionEngine,
  createTransitionEngine,
  type TransitionValidationResult,
  type TransitionValidationIssue,
} from "@openreel/core";
import type { Transition, Clip, Track, TransitionEdge } from "@openreel/core";
import type { TransitionType, TransitionParams } from "@openreel/core";

/** Localize known validation facts without interpreting engine error text. */
export function transitionValidationMessage(issue: TransitionValidationIssue): string {
  switch (issue.code) {
    case "clips-not-adjacent":
      return editorMessage("editor.transitionValidation.notAdjacent");
    case "different-tracks":
      return editorMessage("editor.transitionValidation.differentTracks");
    case "non-positive-transition-duration":
      return editorMessage("editor.transitionValidation.positiveTransition");
    case "non-positive-clip-duration":
      return editorMessage("editor.transitionValidation.positiveClip");
    case "insufficient-handles":
      return editorMessage("editor.transitionValidation.handles", { maxDuration: issue.maxDuration.toFixed(2) });
    case "exceeds-clip-length":
      return editorMessage("editor.transitionValidation.clipLength", { maxDuration: issue.maxDuration.toFixed(2) });
  }
}

/**
 * Result of a transition operation
 */
export interface TransitionOperationResult {
  success: boolean;
  transitionId?: string;
  error?: string;
  warning?: string;
  maxDuration?: number;
  errorIssue?: TransitionValidationIssue;
  warningIssue?: TransitionValidationIssue;
}

/**
 * Transition configuration for UI
 */
export interface TransitionConfig {
  type: TransitionType;
  duration: number;
  params: Record<string, unknown>;
}

/**
 * Available transition types with display info
 */
export interface TransitionTypeInfo {
  type: TransitionType;
  name: string;
  description: string;
  hasDirection: boolean;
  hasCustomParams: boolean;
}

const isSameTransitionPlacement = (
  candidate: Transition,
  transition: Transition,
): boolean => {
  if (candidate.id === transition.id) {
    return true;
  }

  if (candidate.clipBId || transition.clipBId) {
    return (
      candidate.clipAId === transition.clipAId &&
      candidate.clipBId === transition.clipBId
    );
  }

  return (
    candidate.clipAId === transition.clipAId &&
    (candidate.edge ?? "out") === (transition.edge ?? "out")
  );
};

/**
 * TransitionBridge class for connecting UI to transition functionality
 *
 * - 12.2: Blend outgoing and incoming clips over specified duration
 * - 12.3: Update blend timing when duration is adjusted
 * - 12.4: Restore hard cut when transition is removed
 */
export class TransitionBridge {
  private transitionEngine: TransitionEngine | null = null;
  private initialized = false;

  // Store transitions per track
  private trackTransitions: Map<string, Transition[]> = new Map();

  /**
   * Initialize the transition bridge
   * Connects to TransitionEngine
   */
  initialize(width: number = 1920, height: number = 1080): void {
    if (this.initialized) {
      return;
    }

    try {
      this.transitionEngine = createTransitionEngine(width, height);
      this.initialized = true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown initialization error";
      throw new Error(
        `TransitionBridge initialization failed: ${errorMessage}`,
      );
    }
  }

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the underlying TransitionEngine
   */
  getEngine(): TransitionEngine | null {
    return this.transitionEngine;
  }

  /**
   * Create a transition between two adjacent clips
   *
   * Blend outgoing and incoming clips over specified duration
   *
   * @param clipA - The outgoing clip
   * @param clipB - The incoming clip
   * @param type - The transition type
   * @param duration - The transition duration in seconds
   * @param params - Optional transition-specific parameters
   * @returns Transition operation result
   */
  createTransition(
    clipA: Clip,
    clipB: Clip,
    type: TransitionType,
    duration: number,
    params?: Partial<TransitionParams[typeof type]>,
  ): TransitionOperationResult {
    if (!this.initialized || !this.transitionEngine) {
      return { success: false, error: editorMessage("editor.transitionValidation.notInitialized") };
    }

    // Validate the transition
    const validation = this.transitionEngine.validateTransition(
      clipA,
      clipB,
      duration,
    );

    if (!validation.valid && !validation.warning) {
      return {
        success: false,
        error: validation.errorIssue ? transitionValidationMessage(validation.errorIssue) : validation.error,
        errorIssue: validation.errorIssue,
      };
    }

    // Create the transition
    const transition = this.transitionEngine.createTransition(
      clipA,
      clipB,
      type,
      duration,
      params,
    );

    if (!transition) {
      return { success: false, error: editorMessage("editor.transitionValidation.createFailed") };
    }

    // Store the transition
    const trackId = clipA.trackId;
    const transitions = this.trackTransitions.get(trackId) || [];

    // Remove any existing transition at this clip-to-clip placement
    const filteredTransitions = transitions.filter(
      (t) => !isSameTransitionPlacement(t, transition),
    );

    filteredTransitions.push(transition);
    this.trackTransitions.set(trackId, filteredTransitions);

    return {
      success: true,
      transitionId: transition.id,
      warning: validation.warningIssue ? transitionValidationMessage(validation.warningIssue) : validation.warning,
      warningIssue: validation.warningIssue,
      maxDuration: validation.maxDuration,
    };
  }

  /**
   * Create a transition on a single clip edge.
   *
   * Intro transitions blend from the project background into the clip.
   * Outro transitions blend from the clip into the project background.
   */
  createClipEdgeTransition(
    clip: Clip,
    edge: TransitionEdge,
    type: TransitionType,
    duration: number,
    params?: Partial<TransitionParams[typeof type]>,
  ): TransitionOperationResult {
    if (!this.initialized || !this.transitionEngine) {
      return { success: false, error: editorMessage("editor.transitionValidation.notInitialized") };
    }

    const validation = this.transitionEngine.validateClipEdgeTransition(
      clip,
      duration,
    );

    if (!validation.valid && !validation.warning) {
      return {
        success: false,
        error: validation.errorIssue ? transitionValidationMessage(validation.errorIssue) : validation.error,
        errorIssue: validation.errorIssue,
      };
    }

    const transition = this.transitionEngine.createClipEdgeTransition(
      clip,
      edge,
      type,
      duration,
      params,
    );

    if (!transition) {
      return { success: false, error: editorMessage("editor.transitionValidation.createFailed") };
    }

    const transitions = this.trackTransitions.get(clip.trackId) || [];
    const filteredTransitions = transitions.filter(
      (t) => !isSameTransitionPlacement(t, transition),
    );

    filteredTransitions.push(transition);
    this.trackTransitions.set(clip.trackId, filteredTransitions);

    return {
      success: true,
      transitionId: transition.id,
      warning: validation.warningIssue ? transitionValidationMessage(validation.warningIssue) : validation.warning,
      warningIssue: validation.warningIssue,
      maxDuration: validation.maxDuration,
    };
  }

  /**
   * Update a transition's parameters
   *
   * Update blend timing when duration is adjusted
   *
   * @param transitionId - The transition to update
   * @param updates - The parameters to update
   * @returns Transition operation result
   */
  updateTransition(
    transitionId: string,
    updates: Partial<{
      type: TransitionType;
      duration: number;
      params: Record<string, unknown>;
    }>,
  ): TransitionOperationResult {
    if (!this.initialized || !this.transitionEngine) {
      return { success: false, error: editorMessage("editor.transitionValidation.notInitialized") };
    }

    // Find the transition
    let foundTransition: Transition | null = null;
    let foundTrackId: string | null = null;

    for (const [trackId, transitions] of this.trackTransitions.entries()) {
      const transition = transitions.find((t) => t.id === transitionId);
      if (transition) {
        foundTransition = transition;
        foundTrackId = trackId;
        break;
      }
    }

    if (!foundTransition || !foundTrackId) {
      return { success: false, error: editorMessage("editor.transitionValidation.notFound") };
    }

    // Create updated transition
    const updatedTransition: Transition = {
      ...foundTransition,
      type: updates.type ?? foundTransition.type,
      duration: updates.duration ?? foundTransition.duration,
      params: updates.params
        ? { ...foundTransition.params, ...updates.params }
        : foundTransition.params,
    };

    // Update in storage
    const transitions = this.trackTransitions.get(foundTrackId) || [];
    const index = transitions.findIndex((t) => t.id === transitionId);
    if (index !== -1) {
      transitions[index] = updatedTransition;
      this.trackTransitions.set(foundTrackId, transitions);
    }

    return { success: true, transitionId };
  }

  /**
   * Remove a transition (restore hard cut)
   *
   * Restore hard cut when transition is removed
   *
   * @param transitionId - The transition to remove
   * @returns Transition operation result
   */
  removeTransition(transitionId: string): TransitionOperationResult {
    if (!this.initialized) {
      return { success: false, error: editorMessage("editor.transitionValidation.notInitialized") };
    }

    // Find and remove the transition
    for (const [trackId, transitions] of this.trackTransitions.entries()) {
      const index = transitions.findIndex((t) => t.id === transitionId);
      if (index !== -1) {
        transitions.splice(index, 1);
        this.trackTransitions.set(trackId, transitions);
        return { success: true, transitionId };
      }
    }

    return { success: false, error: editorMessage("editor.transitionValidation.notFound") };
  }

  /**
   * Get a transition by ID
   *
   * @param transitionId - The transition ID
   * @returns The transition or undefined
   */
  getTransition(transitionId: string): Transition | undefined {
    for (const transitions of this.trackTransitions.values()) {
      const transition = transitions.find((t) => t.id === transitionId);
      if (transition) {
        return transition;
      }
    }
    return undefined;
  }

  /**
   * Get all transitions for a track
   *
   * @param trackId - The track ID
   * @returns Array of transitions
   */
  getTransitionsForTrack(trackId: string): Transition[] {
    return this.trackTransitions.get(trackId) || [];
  }

  setTransitionsForTrack(trackId: string, transitions: Transition[]): void {
    this.trackTransitions.set(
      trackId,
      transitions.map((transition) => ({
        ...transition,
        params: { ...transition.params },
      })),
    );
  }

  /**
   * Get transition between two specific clips
   *
   * @param clipAId - The outgoing clip ID
   * @param clipBId - The incoming clip ID
   * @returns The transition or undefined
   */
  getTransitionBetweenClips(
    clipAId: string,
    clipBId: string,
  ): Transition | undefined {
    for (const transitions of this.trackTransitions.values()) {
      const transition = transitions.find(
        (t) => t.clipAId === clipAId && t.clipBId === clipBId,
      );
      if (transition) {
        return transition;
      }
    }
    return undefined;
  }

  /**
   * Validate a potential transition between two clips
   *
   * @param clipA - The outgoing clip
   * @param clipB - The incoming clip
   * @param duration - The requested duration
   * @returns Validation result
   */
  validateTransition(
    clipA: Clip,
    clipB: Clip,
    duration: number,
  ): TransitionValidationResult {
    if (!this.initialized || !this.transitionEngine) {
      return { valid: false, error: editorMessage("editor.transitionValidation.notInitialized") };
    }

    return this.transitionEngine.validateTransition(clipA, clipB, duration);
  }

  validateClipEdgeTransition(
    clip: Clip,
    duration: number,
  ): TransitionValidationResult {
    if (!this.initialized || !this.transitionEngine) {
      return { valid: false, error: editorMessage("editor.transitionValidation.notInitialized") };
    }

    return this.transitionEngine.validateClipEdgeTransition(clip, duration);
  }

  /**
   * Check if two clips are adjacent and can have a transition
   *
   * @param clipA - The first clip
   * @param clipB - The second clip
   * @returns Whether the clips are adjacent
   */
  areClipsAdjacent(clipA: Clip, clipB: Clip): boolean {
    if (!this.initialized || !this.transitionEngine) {
      return false;
    }

    return this.transitionEngine.areClipsAdjacent(clipA, clipB);
  }

  /**
   * Find all adjacent clip pairs on a track
   *
   * @param track - The track to search
   * @returns Array of adjacent clip pairs
   */
  findAdjacentClipPairs(track: Track): Array<{ clipA: Clip; clipB: Clip }> {
    if (!this.initialized || !this.transitionEngine) {
      return [];
    }

    return this.transitionEngine.findAdjacentClipPairs(track);
  }

  /**
   * Get available transition types with display information
   *
   * @returns Array of transition type info
   */
  getAvailableTransitionTypes(): TransitionTypeInfo[] {
    return [
      {
        type: "crossfade",
        name: editorMessage("editor.transitions.catalog.crossfade.name"),
        description: editorMessage("editor.transitions.catalog.crossfade.description"),
        hasDirection: false,
        hasCustomParams: false,
      },
      {
        type: "dipToBlack",
        name: editorMessage("editor.transitions.catalog.dipToBlack.name"),
        description: editorMessage("editor.transitions.catalog.dipToBlack.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "dipToWhite",
        name: editorMessage("editor.transitions.catalog.dipToWhite.name"),
        description: editorMessage("editor.transitions.catalog.dipToWhite.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "wipe",
        name: editorMessage("editor.transitions.catalog.wipe.name"),
        description: editorMessage("editor.transitions.catalog.wipe.description"),
        hasDirection: true,
        hasCustomParams: true,
      },
      {
        type: "slide",
        name: editorMessage("editor.transitions.catalog.slide.name"),
        description: editorMessage("editor.transitions.catalog.slide.description"),
        hasDirection: true,
        hasCustomParams: true,
      },
      {
        type: "zoom",
        name: editorMessage("editor.transitions.catalog.zoom.name"),
        description: editorMessage("editor.transitions.catalog.zoom.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "push",
        name: editorMessage("editor.transitions.catalog.push.name"),
        description: editorMessage("editor.transitions.catalog.push.description"),
        hasDirection: true,
        hasCustomParams: true,
      },
      {
        type: "circleReveal",
        name: editorMessage("editor.transitions.catalog.circleReveal.name"),
        description: editorMessage("editor.transitions.catalog.circleReveal.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "blur",
        name: editorMessage("editor.transitions.catalog.blur.name"),
        description: editorMessage("editor.transitions.catalog.blur.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "whipPan",
        name: editorMessage("editor.transitions.catalog.whipPan.name"),
        description: editorMessage("editor.transitions.catalog.whipPan.description"),
        hasDirection: true,
        hasCustomParams: true,
      },
      {
        type: "radialWipe",
        name: editorMessage("editor.transitions.catalog.radialWipe.name"),
        description: editorMessage("editor.transitions.catalog.radialWipe.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "pixelate",
        name: editorMessage("editor.transitions.catalog.pixelate.name"),
        description: editorMessage("editor.transitions.catalog.pixelate.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "glitch",
        name: editorMessage("editor.transitions.catalog.glitch.name"),
        description: editorMessage("editor.transitions.catalog.glitch.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "blinds",
        name: editorMessage("editor.transitions.catalog.blinds.name"),
        description: editorMessage("editor.transitions.catalog.blinds.description"),
        hasDirection: true,
        hasCustomParams: true,
      },
      {
        type: "diamondReveal",
        name: editorMessage("editor.transitions.catalog.diamondReveal.name"),
        description: editorMessage("editor.transitions.catalog.diamondReveal.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "spin",
        name: editorMessage("editor.transitions.catalog.spin.name"),
        description: editorMessage("editor.transitions.catalog.spin.description"),
        hasDirection: true,
        hasCustomParams: true,
      },
      {
        type: "flip",
        name: editorMessage("editor.transitions.catalog.flip.name"),
        description: editorMessage("editor.transitions.catalog.flip.description"),
        hasDirection: true,
        hasCustomParams: true,
      },
      {
        type: "splitReveal",
        name: editorMessage("editor.transitions.catalog.splitReveal.name"),
        description: editorMessage("editor.transitions.catalog.splitReveal.description"),
        hasDirection: true,
        hasCustomParams: true,
      },
      {
        type: "flash",
        name: editorMessage("editor.transitions.catalog.flash.name"),
        description: editorMessage("editor.transitions.catalog.flash.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "filmBurn",
        name: editorMessage("editor.transitions.catalog.filmBurn.name"),
        description: editorMessage("editor.transitions.catalog.filmBurn.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "mosaic",
        name: editorMessage("editor.transitions.catalog.mosaic.name"),
        description: editorMessage("editor.transitions.catalog.mosaic.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "ripple",
        name: editorMessage("editor.transitions.catalog.ripple.name"),
        description: editorMessage("editor.transitions.catalog.ripple.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
      {
        type: "pageTurn",
        name: editorMessage("editor.transitions.catalog.pageTurn.name"),
        description: editorMessage("editor.transitions.catalog.pageTurn.description"),
        hasDirection: true,
        hasCustomParams: true,
      },
      {
        type: "colorSplit",
        name: editorMessage("editor.transitions.catalog.colorSplit.name"),
        description: editorMessage("editor.transitions.catalog.colorSplit.description"),
        hasDirection: false,
        hasCustomParams: true,
      },
    ];
  }

  /**
   * Get default parameters for a transition type
   *
   * @param type - The transition type
   * @returns Default parameters
   */
  getDefaultParams(type: TransitionType): Record<string, unknown> {
    if (!this.initialized || !this.transitionEngine) {
      return {};
    }

    return this.transitionEngine.getDefaultParams(type);
  }

  /**
   * Calculate transition progress at a given time
   *
   * @param transition - The transition
   * @param clipA - The outgoing clip
   * @param currentTime - The current playback time
   * @returns Progress value (0 to 1)
   */
  calculateProgress(
    transition: Transition,
    clipA: Clip,
    currentTime: number,
  ): number {
    if (!this.initialized || !this.transitionEngine) {
      return 0;
    }

    return this.transitionEngine.calculateTransitionProgress(
      transition,
      clipA,
      currentTime,
    );
  }

  /**
   * Check if a time position is within a transition
   *
   * @param transition - The transition
   * @param clipA - The outgoing clip
   * @param currentTime - The current playback time
   * @returns Whether the time is within the transition
   */
  isTimeInTransition(
    transition: Transition,
    clipA: Clip,
    currentTime: number,
  ): boolean {
    if (!this.initialized || !this.transitionEngine) {
      return false;
    }

    return this.transitionEngine.isTimeInTransition(
      transition,
      clipA,
      currentTime,
    );
  }

  /**
   * Render a transition frame
   *
   * @param outgoingFrame - The frame from the outgoing clip
   * @param incomingFrame - The frame from the incoming clip
   * @param transition - The transition configuration
   * @param progress - Progress through the transition (0 to 1)
   * @returns The blended frame
   */
  async renderTransition(
    outgoingFrame: globalThis.CanvasImageSource,
    incomingFrame: globalThis.CanvasImageSource,
    transition: Transition,
    progress: number,
  ): Promise<{ frame: ImageBitmap; processingTime: number } | null> {
    if (!this.initialized || !this.transitionEngine) {
      return null;
    }

    try {
      const result = await this.transitionEngine.renderTransition(
        outgoingFrame,
        incomingFrame,
        transition,
        progress,
      );
      return {
        frame: result.frame,
        processingTime: result.processingTime,
      };
    } catch (error) {
      console.error("[TransitionBridge] Render error:", error);
      return null;
    }
  }

  async renderTransitionToCanvas(
    outgoingFrame: globalThis.CanvasImageSource,
    incomingFrame: globalThis.CanvasImageSource,
    transition: Transition,
    progress: number,
  ): Promise<OffscreenCanvas | null> {
    if (!this.initialized || !this.transitionEngine) {
      return null;
    }

    try {
      return await this.transitionEngine.renderTransitionToCanvas(
        outgoingFrame,
        incomingFrame,
        transition,
        progress,
      );
    } catch (error) {
      console.error("[TransitionBridge] Render error:", error);
      return null;
    }
  }

  /**
   * Clear all transitions for a track
   *
   * @param trackId - The track ID
   */
  clearTransitionsForTrack(trackId: string): void {
    this.trackTransitions.delete(trackId);
  }

  /**
   * Clear all transitions
   */
  clearAllTransitions(): void {
    this.trackTransitions.clear();
  }

  /**
   * Resize the transition engine
   *
   * @param width - New width
   * @param height - New height
   */
  resize(width: number, height: number): void {
    if (this.transitionEngine) {
      this.transitionEngine.resize(width, height);
    }
  }

  /**
   * Dispose of the transition bridge and clean up resources
   */
  dispose(): void {
    if (this.transitionEngine) {
      this.transitionEngine.dispose();
    }

    this.trackTransitions.clear();
    this.transitionEngine = null;
    this.initialized = false;
  }
}

// Singleton instance
let transitionBridgeInstance: TransitionBridge | null = null;

/**
 * Get the shared TransitionBridge instance
 */
export function getTransitionBridge(): TransitionBridge {
  if (!transitionBridgeInstance) {
    transitionBridgeInstance = new TransitionBridge();
  }
  return transitionBridgeInstance;
}

/**
 * Initialize the shared TransitionBridge
 */
export function initializeTransitionBridge(
  width: number = 1920,
  height: number = 1080,
): TransitionBridge {
  const bridge = getTransitionBridge();
  bridge.initialize(width, height);
  return bridge;
}

/**
 * Dispose of the shared TransitionBridge
 */
export function disposeTransitionBridge(): void {
  if (transitionBridgeInstance) {
    transitionBridgeInstance.dispose();
    transitionBridgeInstance = null;
  }
}
