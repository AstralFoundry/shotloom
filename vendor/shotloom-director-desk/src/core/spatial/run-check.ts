import type { Project } from '../model.ts';
import { activeCameraId } from '../timeline.ts';
import type { Engine } from '../engine.ts';
import type { RenderLease } from '../editor/render-lease.ts';
import { checkSample, groupIssues, toSpatialBox, type SpatialBox, type SpatialIssue } from './checks.ts';

export interface CheckRequest {
    subjectIds?: string[];
    start: number;
    end: number;
    /** Samples per second; higher finds shorter events at proportionally higher cost. */
    sampleRate: number;
    /** Camera whose framing is checked, or `program` to follow the cut list. */
    cameraId: string;
    /** Compare characters against props and walls as well as each other. */
    includeObstacles: boolean;
    /** Also flag characters that leave the frame. */
    includeFraming: boolean;
}

export interface CheckResult {
    issues: SpatialIssue[];
    /** True when the sampler stopped early because it hit the result cap. */
    truncated: boolean;
    samples: number;
}

/** Beyond this the report stops being actionable and the sampling cost stops being worth it. */
const MAX_ISSUES = 400;

/**
 * Sample the scene over a time range and report spatial problems.
 *
 * Reading the live engine means the checks see exactly what the viewport shows — imported
 * models, foot contact, action blending — instead of an approximation rebuilt from entity JSON.
 * Each sample repositions the engine, so the caller holds the busy lock and the previous
 * playhead is restored afterwards, even when the run is canceled.
 */
export async function runSpatialCheck(
    engine: Engine,
    project: Project,
    request: CheckRequest,
    signal: AbortSignal,
    progress: (fraction: number) => void,
    lease: RenderLease,
): Promise<CheckResult> {
    const start = Math.max(0, Math.min(request.start, request.end));
    const end = Math.min(project.duration, Math.max(request.start, request.end));
    if (!(end > start)) throw Error('时间范围无效');
    if (!(request.sampleRate > 0)) throw Error('采样次数无效');
    if (request.subjectIds?.some(id => !project.entities.some(e => e.id === id && (e.kind === 'actor' || e.kind === 'crowd')))) throw Error('subjectIds 包含不存在的角色');
    const count = Math.max(2, Math.min(2000, Math.round((end - start) * request.sampleRate)));
    const step = (end - start) / (count - 1);
    const collected: SpatialIssue[] = [];
    const occluders = new Set(
        project.entities.filter((entity) => entity.kind === 'prop' && !entity.light).map((entity) => entity.id),
    );
    // Moving and hand-held props are expected to leave the floor; only standing pieces are judged
    // for floating. Props join the sample only with obstacles enabled, so the check follows that switch.
    const standingPropIds = request.includeObstacles
        ? new Set(project.entities
            .filter((entity) => occluders.has(entity.id) && !entity.path && !entity.handBinding)
            .map((entity) => entity.id))
        : undefined;
    // The whole sweep runs under one borrow: sampling repositions the engine on every frame, so
    // a concurrent thumbnail or export would otherwise sample a time this loop just moved to.
    return lease.borrow(async () => {
        for (let index = 0; index < count; index += 1) {
            signal.throwIfAborted();
            const time = start + index * step;
            await engine.prepareOutput(time);
            const cameraId = request.cameraId === 'program' ? activeCameraId(project, time) : request.cameraId;
            const boxes: SpatialBox[] = [];
            for (const entity of project.entities) {
                if (!entity.visible) continue;
                const bounds = engine.worldBounds(entity.id);
                if (!bounds) continue;
                // Only characters and obstacles participate: a light rig has no volume worth
                // intersecting, and a camera body would report itself as an obstruction.
                const tracked = entity.kind === 'actor' || entity.kind === 'crowd';
                const obstacle = request.includeObstacles && occluders.has(entity.id);
                if (!tracked && !obstacle) continue;
                boxes.push(
                    toSpatialBox(
                        entity.id,
                        entity.name,
                        entity.kind,
                        { min: bounds.min, max: bounds.max },
                        occluders.has(entity.id),
                    ),
                );
            }
            // 相机位置与取景矩阵分开传：机位卡在墙里、主体被挡住这两件事，
            // 即使关掉"是否在画面内"也值得检查（它们只依赖机位位置和包围盒）。
            const shotCamera = project.entities.some((entity) => entity.kind === 'camera')
                ? engine.shotCameraFor(cameraId)
                : null;
            const cameraPosition = shotCamera?.position.toArray() as [number, number, number] | undefined;
            // 每个切镜自己声明要看谁：没有目标时退回"所有人物"，避免把候场演员全报成出画。
            const cut = [...project.cuts].reverse().find(c => c.time <= time);
            const declared = request.subjectIds ?? (request.cameraId === 'program' ? cut?.subjectIds : undefined);
            const targetId = project.entities.find((entity) => entity.id === cameraId)?.camera?.targetId;
            collected.push(
                ...checkSample(
                    {
                        boxes,
                        cameraPosition,
                        ...(request.includeFraming && shotCamera
                            ? {
                                  camera: {
                                      projectionMatrix: shotCamera.projectionMatrix,
                                      matrixWorldInverse: shotCamera.matrixWorldInverse,
                                  },
                              }
                            : {}),
                        ...(declared !== undefined ? { requiredIds: declared } : targetId && boxes.some((box) => box.id === targetId) ? { requiredIds: [targetId] } : {}),
                        ...(standingPropIds ? { standingPropIds } : {}),
                    },
                    time,
                ),
            );
            progress((index + 1) / count);
            if (collected.length > MAX_ISSUES) {
                return { issues: groupIssues(collected, project.fps), truncated: true, samples: index + 1 };
            }
        }
        return { issues: groupIssues(collected, project.fps), truncated: false, samples: count };
    });
}
