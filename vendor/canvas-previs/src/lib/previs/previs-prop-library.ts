import type { PrevisObject, PrevisVec3 } from "@/types/previs";

/**
 * 道具库（语义化尺寸，单位米）。
 * 几何体以中心为原点：box 边长 1、sphere 半径 0.6、cylinder 高 1.2，scale 把它们拉成真实尺寸。
 * 放置高度由 previsPrimitiveHalfHeight 求出，保证道具底面落在地面上。
 */
export type PrevisPropPrimitive = "box" | "sphere" | "cylinder";
export type PrevisPropItem = { id: string; name: string; primitive: PrevisPropPrimitive; size: PrevisVec3 };
export type PrevisPropCategory = { id: string; label: string; items: PrevisPropItem[] };

/** 单位几何体的尺寸（scale=1 时的宽/高/深）。 */
const UNIT_SIZE: Record<PrevisPropPrimitive, PrevisVec3> = { box: [1, 1, 1], sphere: [1.2, 1.2, 1.2], cylinder: [1, 1.2, 1] };

const item = (id: string, name: string, primitive: PrevisPropPrimitive, size: PrevisVec3): PrevisPropItem => ({ id, name, primitive, size });

export const PREVIS_PROP_LIBRARY: PrevisPropCategory[] = [
    {
        id: "furniture",
        label: "家具",
        items: [
            item("sofa-1", "单人沙发", "box", [0.9, 0.85, 0.85]),
            item("sofa-3", "三人沙发", "box", [2.2, 0.85, 0.85]),
            item("dining-table", "餐桌", "box", [1.6, 0.75, 0.9]),
            item("coffee-table", "茶几", "box", [1.0, 0.45, 0.6]),
            item("stool", "凳子", "cylinder", [0.4, 0.45, 0.4]),
            item("bed", "双人床", "box", [1.8, 0.5, 2.1]),
        ],
    },
    {
        id: "structure",
        label: "空间结构",
        items: [item("wall", "墙板", "box", [3, 2.8, 0.2]), item("door", "门", "box", [0.9, 2.1, 0.1]), item("window", "窗框", "box", [1.2, 1.4, 0.1]), item("floor", "地面板", "box", [4, 0.1, 4]), item("step", "台阶", "box", [1, 0.2, 0.3])],
    },
    {
        id: "nature",
        label: "自然 / 外景",
        items: [
            item("hill", "山体", "box", [8, 4, 6]),
            item("rock", "岩石", "sphere", [1.5, 1, 1.2]),
            item("trunk", "树干", "cylinder", [0.3, 3, 0.3]),
            // 旧版用竖直 plane，放下去是一块立着的板；地面背板应当是平铺的薄板。
            item("ground", "地面背板", "box", [6, 0.05, 6]),
        ],
    },
    {
        id: "props",
        label: "道具",
        items: [item("car", "汽车轮廓", "box", [4.5, 1.5, 2]), item("pillar", "柱子", "cylinder", [0.4, 3, 0.4]), item("crate", "箱子", "box", [0.6, 0.6, 0.6]), item("ball", "球体道具", "sphere", [0.5, 0.5, 0.5])],
    },
];

export function previsPropScale(prop: PrevisPropItem): PrevisVec3 {
    const unit = UNIT_SIZE[prop.primitive];
    return [prop.size[0] / unit[0], prop.size[1] / unit[1], prop.size[2] / unit[2]];
}

export function formatPrevisPropSize(size: PrevisVec3) {
    const fmt = (value: number) => String(Number(value.toFixed(2)));
    return `${fmt(size[0])}×${fmt(size[1])}×${fmt(size[2])}m`;
}

/**
 * 几何体中心到底面的距离（米）。只对中心原点的程序化几何体有意义；
 * 模型、背板、平面返回 null，由调用方退回「原点不低于地面」规则。
 */
export function previsPrimitiveHalfHeight(object: Pick<PrevisObject, "kind" | "primitive" | "transform">): number | null {
    if (object.kind !== "primitive") return null;
    const primitive = object.primitive;
    if (primitive !== "box" && primitive !== "sphere" && primitive !== "cylinder") return null;
    const sy = Math.abs(object.transform.scale[1]);
    if (!Number.isFinite(sy)) return null;
    return (UNIT_SIZE[primitive][1] / 2) * sy;
}
