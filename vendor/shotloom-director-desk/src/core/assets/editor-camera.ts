import * as T from 'three';

/** A solid camera marker that reads clearly against both editor backgrounds. */
export function makeEditorCamera(): T.Group {
    const root = new T.Group();
    const body = new T.MeshBasicMaterial({ color: '#bd7617' });
    const top = new T.MeshBasicMaterial({ color: '#d99628' });
    const dark = new T.MeshBasicMaterial({ color: '#181a1c' });
    const glass = new T.MeshBasicMaterial({ color: '#34424b' });

    const addBox = (
        width: number,
        height: number,
        depth: number,
        x: number,
        y: number,
        z: number,
        material: T.Material,
    ) => {
        const mesh = new T.Mesh(new T.BoxGeometry(width, height, depth), material);
        mesh.position.set(x, y, z);
        root.add(mesh);
    };
    const addLens = (radius: number, depth: number, z: number, material: T.Material) => {
        const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, depth, 20), material);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.z = z;
        root.add(mesh);
    };

    // Three.js cameras look down -Z. Keep the lens on that side so the marker
    // remains aligned with the actual camera while its position and aim animate.
    addBox(0.24, 0.19, 0.17, 0, 0, 0.005, body);
    addBox(0.11, 0.025, 0.08, 0.025, 0.108, 0.015, top);
    addBox(0.045, 0.023, 0.025, -0.072, 0.109, 0.04, dark);
    addBox(0.028, 0.12, 0.14, 0.133, -0.005, 0.006, dark);
    addLens(0.071, 0.055, -0.105, dark);
    addLens(0.059, 0.05, -0.153, dark);
    addLens(0.042, 0.004, -0.18, glass);
    root.traverse((object) => object.layers.set(1));
    return root;
}
