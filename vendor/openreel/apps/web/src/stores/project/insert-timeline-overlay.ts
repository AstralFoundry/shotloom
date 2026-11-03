import { v4 as uuidv4 } from "uuid";
import { resolveTimelinePlacement } from "@openreel/core";
import { useProjectStore } from "../project-store";

/**
 * Put a newly-authored visual item on an available timeline row. Occupied
 * rows stack above automatically and track creation stays in the same history
 * transaction as the item creation.
 */
export async function insertTimelineOverlay<T>(
  startTime: number,
  duration: number,
  create: (trackId: string) => T | null,
  preferredTrackId?: string,
): Promise<T | null> {
  const initialState = useProjectStore.getState();
  const initialProject = initialState.project;
  const preferredTrack = preferredTrackId
    ? initialProject.timeline.tracks.find(
        (track) => track.id === preferredTrackId,
      )
    : undefined;
  if (preferredTrackId && (!preferredTrack || preferredTrack.locked)) {
    return null;
  }
  const targetTrack =
    preferredTrack ??
    initialProject.timeline.tracks.find((track) => !track.locked);
  const newTrackId = `track-${uuidv4()}`;
  const placement = targetTrack
    ? resolveTimelinePlacement(initialProject, {
        targetTrackId: targetTrack.id,
        startTime,
        duration,
        policy: "stack-above",
        newTrackId,
      })
    : {
        ok: true as const,
        trackId: newTrackId,
        startTime: Math.max(0, startTime),
        createdTrack: { id: newTrackId, position: 0 },
      };

  if (!placement.ok) return null;

  initialState.beginHistoryGroup("Place timeline item");
  try {
    if (placement.createdTrack) {
      const result = await useProjectStore.getState().addTrack(
        "video",
        placement.createdTrack.position,
        {
          mode: "standard",
          trackId: placement.createdTrack.id,
        },
      );
      if (!result.success) return null;
    }
    return create(placement.trackId);
  } finally {
    useProjectStore.getState().endHistoryGroup();
  }
}
