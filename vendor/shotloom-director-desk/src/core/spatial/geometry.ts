import { Box3, InstancedMesh, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import type { Vec3 } from '../model.ts';
import { modelNodeHidden } from '../resources/model-node-visibility.ts';

export interface BoundsData {
    min: Vec3;
    max: Vec3;
    size: Vec3;
    center: Vec3;
}

export function geometryBounds(root: Object3D, excluded?: Object3D): Box3 | null {
    root.updateWorldMatrix(true, true);
    // SkinnedMesh updates its attached bind inverse in updateMatrixWorld, not updateWorldMatrix.
    root.updateMatrixWorld(true);
    const bounds = new Box3(),
        vertex = new Vector3();
    function visit(node: Object3D) {
        if (node === excluded || modelNodeHidden(node)) return;
        if (node instanceof Mesh) {
            const positions = node.geometry.getAttribute('position');
            if (positions && node instanceof InstancedMesh) {
                const instance = new Matrix4(),
                    world = new Matrix4();
                const morph = node.morphTexture ? new Mesh(node.geometry, node.material) : null;
                for (let index = 0; index < node.count; index++) {
                    node.getMatrixAt(index, instance);
                    world.multiplyMatrices(node.matrixWorld, instance);
                    if (morph) node.getMorphAt(index, morph);
                    for (let i = 0; i < positions.count; i++) {
                        (morph ?? node).getVertexPosition(i, vertex).applyMatrix4(world);
                        bounds.expandByPoint(vertex);
                    }
                }
            } else if (positions)
                for (let i = 0; i < positions.count; i++) {
                    node.getVertexPosition(i, vertex).applyMatrix4(node.matrixWorld);
                    bounds.expandByPoint(vertex);
                }
        }
        node.children.forEach(visit);
    }
    visit(root);
    return bounds.isEmpty() ? null : bounds;
}
export function boundsData(box: Box3): BoundsData {
    return {
        min: box.min.toArray(),
        max: box.max.toArray(),
        size: box.getSize(new Vector3()).toArray(),
        center: box.getCenter(new Vector3()).toArray(),
    };
}
