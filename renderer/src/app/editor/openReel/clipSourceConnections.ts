import { t } from '@/i18n';
import type { OpenReelBridgeState, OpenReelImportedAsset } from "../../../../../vendor/openreel/apps/web/src/embedded/runtime-types";
import type { VideoEditorAsset } from "../videoEditorTypes";

type RecordValue = Record<string, any>;
export type ClipSourceRecord = {
  edge: RecordValue;
  assetId: string;
  state: "connected" | "disconnected" | "timeline-removed";
  used: boolean;
  clips?: RecordValue[];
};
type SourceHost = {
  /** Returning null invalidates every pending write after deletion/project switch. */
  node: () => RecordValue | null;
  edges: () => RecordValue[];
  setEdges: (edges: RecordValue[]) => void;
  sourceExists: (id: string) => boolean;
  resolve: (sourceId: string) => Promise<VideoEditorAsset>;
  importAsset: (asset: VideoEditorAsset) => Promise<OpenReelImportedAsset>;
  place: (item: OpenReelImportedAsset, connectionId: string) => Promise<void>;
  actions: (actions: Array<{ type: string; params: RecordValue }>, description: string) => Promise<void>;
  changed: () => void;
  error: (error: Error) => void;
};

/** Coordinates concrete source ownership. No media-name matching or inferred clip lineage. */
export class ClipSourceConnections {
  private records = new Map<string, ClipSourceRecord>();
  private state: OpenReelBridgeState | null = null;
  private busy = false;
  private dirty = false;
  private disposed = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(private host: SourceHost) {
    for (const record of host.node()?.clipSources || []) {
      if (record.edge?.id) this.records.set(record.edge.id, JSON.parse(JSON.stringify(record)));
    }
  }

  private clips(connectionId: string) {
    const native = this.state?.native as RecordValue | null;
    return (native?.timeline?.tracks || []).flatMap((track: RecordValue) =>
      (track.clips || []).filter((clip: RecordValue) => clip.sourceConnectionId === connectionId));
  }

  private save() {
    const node = this.host.node();
    if (!node) return;
    const records = [...this.records.values()];
    if (JSON.stringify(node.clipSources || []) === JSON.stringify(records)) return;
    node.clipSources = JSON.parse(JSON.stringify(records));
    this.host.changed();
  }

  observe(state: OpenReelBridgeState) {
    this.state = state;
    if (!this.busy) this.reconcileUsage();
  }

  private reconcileUsage() {
    if (this.disposed || !this.host.node()) return;
    let edges = this.host.edges();
    let changed = false;
    for (const [id, record] of this.records) {
      const clips = this.clips(id);
      if (clips.length) {
        record.clips = JSON.parse(JSON.stringify(clips));
        record.used = true;
        // Native undo restores the actual clips first, then restores their source edge.
        if (record.state !== "connected" && this.host.sourceExists(String(record.edge.source))) {
          if (!edges.some((edge) => edge.id === id)) { edges = [...edges, record.edge]; changed = true; }
          record.state = "connected";
        }
        const edge = edges.find((item) => item.id === id);
        if (edge) {
          const ids = clips.map((clip: RecordValue) => clip.id);
          if (JSON.stringify(edge.data?.clipIds) !== JSON.stringify(ids)) {
            edge.data = { ...edge.data, clipIds: ids };
            record.edge = JSON.parse(JSON.stringify(edge));
            changed = true;
          }
        }
      } else if (record.used && record.state === "connected" && edges.some((edge) => edge.id === id)) {
        edges = edges.filter((edge) => edge.id !== id);
        record.state = "timeline-removed";
        changed = true;
      }
    }
    if (changed) this.host.setEdges(edges);
    this.save();
  }

  sync() {
    this.dirty = true;
    if (this.busy || this.disposed || !this.state) return this.tail;
    this.busy = true;
    this.tail = (async () => {
      try {
        while (this.dirty && !this.disposed && this.host.node()) {
          this.dirty = false;
          await this.syncOnce();
        }
      } catch (cause) {
        this.host.error(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        this.busy = false;
        this.reconcileUsage();
      }
    })();
    return this.tail;
  }

  private async syncOnce() {
    const node = this.host.node();
    if (!node) return;
    const incoming = this.host.edges().filter((edge) => edge.target === node.id && edge.data?.derivation !== "video-editor-export");
    const connected = new Set(incoming.map((edge) => edge.id));
    for (const [id, record] of this.records) {
      if (connected.has(id) || record.state !== "connected") continue;
      const clips = this.clips(id);
      record.state = "disconnected";
      if (clips.length) {
        record.clips = JSON.parse(JSON.stringify(clips));
        try {
          await this.host.actions(clips.map((clip: RecordValue) => ({ type: "clip/remove", params: { clipId: clip.id } })), t("ui.clipSourceConnections.text.e1e61622"));
        } catch (error) {
          record.state = "connected";
          // Failed native transaction keeps both sides intact.
          if (this.host.node() && this.host.sourceExists(String(record.edge.source))) this.host.setEdges([...this.host.edges(), record.edge]);
          throw error;
        }
      }
      if (!this.host.node() || this.disposed) return;
      this.save();
    }
    for (const edge of incoming) {
      if (!this.host.node() || this.disposed) return;
      const id = String(edge.id);
      const record = this.records.get(id);
      if (record?.state === "connected") continue;
      if (record?.clips?.length) {
        await this.host.actions(record.clips.map((clip) => ({ type: "clip/add", params: {
          trackId: clip.trackId, mediaId: clip.mediaId, startTime: clip.startTime, clipId: clip.id, sourceClip: clip,
        } })), t("ui.clipSourceConnections.text.4315eeb0"));
        record.state = "connected";
        this.save();
        continue;
      }
      const asset = await this.host.resolve(String(edge.source));
      if (!this.hasEdge(id)) return;
      const imported = await this.host.importAsset(asset);
      if (!this.hasEdge(id)) return;
      const next: ClipSourceRecord = { edge: JSON.parse(JSON.stringify(edge)), assetId: asset.id, state: "connected", used: false };
      this.records.set(id, next);
      try {
        await this.host.place(imported, id);
        next.used = true;
      } catch (error) { this.records.delete(id); throw error; }
      if (!this.hasEdge(id)) {
        const clips = this.clips(id);
        if (clips.length && this.host.node()) await this.host.actions(clips.map((clip: RecordValue) => ({ type: "clip/remove", params: { clipId: clip.id } })), t("ui.clipSourceConnections.text.01b12d9b"));
        next.state = "disconnected";
      }
      this.save();
    }
  }

  private hasEdge(id: string) {
    return !this.disposed && Boolean(this.host.node()) && this.host.edges().some((edge) => edge.id === id);
  }

  dispose() { this.disposed = true; }
}
