import { Box3, Mesh, Raycaster, Vector3 } from 'three';
import type { Entity, Project } from '../model.ts';
import { makeProp } from '../assets/props.ts';
import { makeHuman, scaleHuman } from '../assets/humanoid.ts';
import { disposeTree } from '../assets/dispose.ts';
import { worldContactAnchors } from '../assets/contact-anchors.ts';
import { seatedPlacement } from './seat-placement.ts';
import { shiftPath } from '../timeline.ts';

/** Measure draft geometry, so earlier edits in the same atomic batch are respected. */
export function directingModel(entity: Entity) {
    if (entity.external || !['prop', 'actor'].includes(entity.kind)) throw Error('当前几何操作需要已支持的内置道具或人物；外部模型请先使用实际预览测量');
    const rig = entity.kind === 'actor' ? makeHuman(entity) : null;
    if (rig) scaleHuman(rig, entity);
    const root = rig?.root ?? makeProp(entity);
    root.position.fromArray(entity.position);
    root.rotation.set(...entity.rotation);
    if (!rig) root.scale.fromArray(entity.scale);
    root.updateWorldMatrix(true, true);
    return root;
}

export function placeOnSurface(project: Project, entityId: string, targetId: string, anchorId?: string, seated = false) {
    const entity = project.entities.find(e => e.id === entityId), target = project.entities.find(e => e.id === targetId);
    if (!entity || !target || entity === target) throw Error('需要两个不同且存在的实体');
    if (entity.handBinding) throw Error('请先解除手持绑定');
    const support = directingModel(target);
    let moving: ReturnType<typeof directingModel> | undefined;
    try {
        const anchors = worldContactAnchors(target, support);
        const anchor = anchorId ? anchors.find(a => a.id === anchorId) : undefined;
        if (anchorId && !anchor) throw Error(`接触点不存在：${anchorId}；可用：${anchors.map(a => a.id).join(', ')}`);
        const before = [...entity.position];
        if (seated) {
            if (!anchor) throw Error('坐姿定位需要显式选择 seat/bed 接触点');
            const placement = seatedPlacement(entity, anchor);
            shiftPath(entity, new Vector3(...placement.position).sub(new Vector3(...entity.position)));
            entity.rotation[1] = placement.yaw;
        } else {
            moving = directingModel(entity);
            const bounds = new Box3().setFromObject(moving), top = new Box3().setFromObject(support);
            const ray = new Raycaster(new Vector3(entity.position[0], top.max.y + 1, entity.position[2]), new Vector3(0, -1, 0));
            const hit = ray.intersectObject(support, true).find(h => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.5);
            if (!anchor && !hit) throw Error('实体下方没有可承托表面；请移动到目标上方或指定接触点');
            if (anchor && anchor.normal[1] < 0.98) throw Error('落面需要水平承托点；墙面请使用 align_surface');
            const point = anchor ? new Vector3(...anchor.position) : hit!.point;
            const delta = new Vector3(anchor ? point.x - entity.position[0] : 0, point.y - bounds.min.y, anchor ? point.z - entity.position[2] : 0);
            shiftPath(entity, delta);
        }
        return { entityId, targetEntityId: targetId, position: entity.position, displacement: entity.position.map((v, i) => v - before[i]), anchors };
    } finally { disposeTree(support); if (moving) disposeTree(moving); }
}

/** Align local +Z to an explicit surface normal, then put the back face on its plane. */
export function alignSurface(project: Project, entityId: string, targetId: string, anchorId?: string) {
    const entity = project.entities.find(e => e.id === entityId), target = project.entities.find(e => e.id === targetId);
    if (!entity || !target || entity === target || entity.handBinding) throw Error('需要两个不同的实体，且不能移动手持道具');
    const support = directingModel(target);
    let moving: ReturnType<typeof directingModel> | undefined;
    try {
        const anchor = anchorId ? worldContactAnchors(target, support).find(a => a.id === anchorId) : undefined;
        if (anchorId && !anchor) throw Error('接触点不存在；使用 entity_relations 查询');
        const origin = new Vector3(...entity.position), center = new Box3().setFromObject(support).getCenter(new Vector3());
        const hit = anchor ? undefined : new Raycaster(origin, center.sub(origin).normalize()).intersectObject(support, true)[0];
        if (!anchor && !hit?.face) throw Error('无法测得目标表面，请移动实体到目标外侧或指定接触点');
        const normal = anchor ? new Vector3(...anchor.normal) : hit!.face!.normal.clone().transformDirection(hit!.object.matrixWorld);
        const point = anchor ? new Vector3(...anchor.position) : hit!.point;
        moving = directingModel(entity);
        moving.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
        moving.position.copy(point);
        moving.updateWorldMatrix(true, true);
        let projection = Infinity;
        moving.traverse(node => {
            if (!(node instanceof Mesh) || !node.visible) return;
            const positions = node.geometry.getAttribute('position');
            if (!positions) return;
            for (let i = 0; i < positions.count; i++) projection = Math.min(projection, new Vector3().fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld).sub(point).dot(normal));
        });
        if (!Number.isFinite(projection)) throw Error('实体没有可测量网格');
        shiftPath(entity, point.clone().addScaledVector(normal, -projection).sub(new Vector3(...entity.position)));
        entity.rotation = [moving.rotation.x, moving.rotation.y, moving.rotation.z];
        return { entityId, targetEntityId: targetId, anchorId, position: entity.position, normal: normal.toArray() };
    } finally { disposeTree(support); if (moving) disposeTree(moving); }
}
