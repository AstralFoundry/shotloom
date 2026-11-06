/** 工作流展示用的轻量缩略图；快照结构见 snapshot.ts。 */
export interface WorkflowNodePreview {
  kind: 'image' | 'video' | 'audio' | 'text';
  /** 小尺寸 JPEG data URL；可能缺省（解码失败/超限）。 */
  dataUrl?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** 素材名或节点标题，展示在缩略图下方。 */
  label?: string | undefined;
}
