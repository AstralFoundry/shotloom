export interface PrevisAgentFrameRequest {
  sceneId: string;
  updatedAt: string;
  shotId: string;
  mode: 'clay' | 'beauty';
}

type CaptureFrame = (request: PrevisAgentFrameRequest) => Promise<string>;
const targets = new Map<string, CaptureFrame>();

export function registerPrevisAgentPreview(nodeId: string, capture: CaptureFrame) {
  targets.set(nodeId, capture);
  return () => { if (targets.get(nodeId) === capture) targets.delete(nodeId); };
}

export async function capturePrevisAgentFrame(nodeId: string, request: PrevisAgentFrameRequest) {
  const capture = targets.get(nodeId);
  if (!capture) throw new Error('Open the bound world engine workspace before requesting a preview.');
  const image = await capture(request);
  if (targets.get(nodeId) !== capture) throw new Error('The world engine workspace closed during capture.');
  return image;
}
