import type { AssetDefinition } from './types.ts';
import { quadrupedParameterSchema } from './animal-options.ts';

export interface QuadrupedShape {
    body: number;
    leg: number;
    neck: number;
    head: number;
    muzzle: number;
    ear: number;
    tail: number;
    width: number;
    hoof?: boolean;
    horn?: boolean;
    species:
        | 'dog'
        | 'cat'
        | 'rabbit'
        | 'rodent'
        | 'horse'
        | 'cow'
        | 'sheep'
        | 'pig'
        | 'deer'
        | 'turtle'
        | 'lizard'
        | 'camel'
        | 'bear'
        | 'lion'
        | 'tiger'
        | 'elephant'
        | 'giraffe'
        | 'gorilla';
}
const base: QuadrupedShape = {
    body: 0.7,
    leg: 0.42,
    neck: 0.14,
    head: 0.16,
    muzzle: 0.1,
    ear: 0.13,
    tail: 0.4,
    width: 0.17,
    species: 'dog',
};
const presets: Array<{
    id: string;
    name: string;
    height: number;
    group: string;
    shape: Partial<QuadrupedShape>;
    aliases: string[];
}> = [
    {
        id: 'animal-dog-small',
        name: '小型犬',
        height: 0.38,
        group: '宠物',
        shape: { body: 0.65, leg: 0.32, ear: 0.17 },
        aliases: ['狗', '宠物犬', 'dog'],
    },
    { id: 'animal-dog-large', name: '大型犬', height: 0.9, group: '宠物', shape: {}, aliases: ['狗', '大型狗', 'dog'] },
    {
        id: 'animal-cat',
        name: '猫',
        height: 0.4,
        group: '宠物',
        shape: { species: 'cat', body: 0.62, leg: 0.32, muzzle: 0.035, ear: 0.1, tail: 0.58, width: 0.13 },
        aliases: ['小猫', 'cat'],
    },
    {
        id: 'animal-rabbit',
        name: '兔',
        height: 0.4,
        group: '宠物',
        shape: {
            species: 'rabbit',
            body: 0.46,
            leg: 0.14,
            head: 0.15,
            muzzle: 0.035,
            ear: 0.29,
            tail: 0.06,
            width: 0.18,
        },
        aliases: ['兔子', 'rabbit'],
    },
    {
        id: 'animal-hamster',
        name: '仓鼠',
        height: 0.12,
        group: '宠物',
        shape: {
            species: 'rodent',
            body: 0.42,
            leg: 0.1,
            head: 0.14,
            muzzle: 0.04,
            ear: 0.07,
            tail: 0.025,
            width: 0.2,
        },
        aliases: ['鼠', 'hamster'],
    },
    {
        id: 'animal-guineapig',
        name: '豚鼠',
        height: 0.22,
        group: '宠物',
        shape: {
            species: 'rodent',
            body: 0.58,
            leg: 0.1,
            head: 0.17,
            muzzle: 0.04,
            ear: 0.045,
            tail: 0.015,
            width: 0.22,
        },
        aliases: ['荷兰猪', 'guinea pig'],
    },
    {
        id: 'animal-horse',
        name: '马',
        height: 2.15,
        group: '家畜坐骑',
        shape: {
            species: 'horse',
            body: 0.95,
            leg: 0.7,
            neck: 0.4,
            head: 0.2,
            muzzle: 0.22,
            ear: 0.12,
            tail: 0.6,
            width: 0.23,
            hoof: true,
        },
        aliases: ['坐骑', 'horse'],
    },
    {
        id: 'animal-donkey',
        name: '驴',
        height: 1.6,
        group: '家畜坐骑',
        shape: {
            species: 'horse',
            body: 0.85,
            leg: 0.6,
            neck: 0.28,
            muzzle: 0.2,
            ear: 0.24,
            tail: 0.42,
            width: 0.22,
            hoof: true,
        },
        aliases: ['坐骑', 'donkey'],
    },
    {
        id: 'animal-cow',
        name: '牛',
        height: 1.65,
        group: '家畜坐骑',
        shape: {
            species: 'cow',
            body: 1.0,
            leg: 0.58,
            neck: 0.16,
            head: 0.24,
            muzzle: 0.14,
            ear: 0.14,
            tail: 0.55,
            width: 0.31,
            hoof: true,
            horn: true,
        },
        aliases: ['家畜', 'cow'],
    },
    {
        id: 'animal-sheep',
        name: '羊',
        height: 1.0,
        group: '家畜坐骑',
        shape: {
            species: 'sheep',
            body: 0.8,
            leg: 0.4,
            neck: 0.17,
            head: 0.16,
            muzzle: 0.1,
            ear: 0.11,
            tail: 0.12,
            width: 0.29,
            hoof: true,
        },
        aliases: ['绵羊', 'sheep'],
    },
    {
        id: 'animal-goat',
        name: '山羊',
        height: 1.0,
        group: '家畜坐骑',
        shape: {
            species: 'sheep',
            body: 0.7,
            leg: 0.43,
            neck: 0.19,
            head: 0.15,
            muzzle: 0.12,
            ear: 0.13,
            tail: 0.11,
            width: 0.2,
            hoof: true,
            horn: true,
        },
        aliases: ['goat'],
    },
    {
        id: 'animal-pig',
        name: '猪',
        height: 0.85,
        group: '家畜坐骑',
        shape: {
            species: 'pig',
            body: 0.86,
            leg: 0.25,
            neck: 0.04,
            head: 0.23,
            muzzle: 0.15,
            ear: 0.14,
            tail: 0.14,
            width: 0.31,
            hoof: true,
        },
        aliases: ['pig'],
    },
    {
        id: 'animal-deer',
        name: '鹿',
        height: 1.8,
        group: '家畜坐骑',
        shape: {
            species: 'deer',
            body: 0.78,
            leg: 0.64,
            neck: 0.34,
            head: 0.15,
            muzzle: 0.13,
            ear: 0.17,
            tail: 0.11,
            width: 0.18,
            hoof: true,
            horn: true,
        },
        aliases: ['deer'],
    },
    {
        id: 'animal-wolf',
        name: '狼',
        height: 1.0,
        group: '野生动物',
        shape: { body: 0.85, leg: 0.5, head: 0.18, ear: 0.12, tail: 0.5, width: 0.19 },
        aliases: ['wolf'],
    },
    {
        id: 'animal-fox',
        name: '狐狸',
        height: 0.55,
        group: '野生动物',
        shape: { body: 0.72, leg: 0.34, head: 0.13, muzzle: 0.14, ear: 0.18, tail: 0.66, width: 0.14 },
        aliases: ['fox'],
    },
    {
        id: 'animal-turtle',
        name: '乌龟',
        height: 0.18,
        group: '宠物',
        shape: {
            species: 'turtle',
            body: 0.7,
            leg: 0.12,
            neck: 0.04,
            head: 0.12,
            muzzle: 0.01,
            ear: 0,
            tail: 0.1,
            width: 0.29,
        },
        aliases: ['龟', 'turtle'],
    },
    {
        id: 'animal-lizard',
        name: '蜥蜴',
        height: 0.14,
        group: '宠物',
        shape: {
            species: 'lizard',
            body: 0.8,
            leg: 0.1,
            neck: 0.02,
            head: 0.12,
            muzzle: 0.1,
            ear: 0,
            tail: 0.85,
            width: 0.13,
        },
        aliases: ['爬虫', 'lizard'],
    },
    {
        id: 'animal-camel',
        name: '骆驼',
        height: 2.5,
        group: '家畜坐骑',
        shape: {
            species: 'camel',
            body: 0.95,
            leg: 0.75,
            neck: 0.42,
            head: 0.18,
            muzzle: 0.18,
            ear: 0.1,
            tail: 0.45,
            width: 0.25,
            hoof: true,
        },
        aliases: ['坐骑', 'camel'],
    },
    {
        id: 'animal-bear',
        name: '熊',
        height: 1.5,
        group: '野生动物',
        shape: {
            species: 'bear',
            body: 1,
            leg: 0.47,
            neck: 0.05,
            head: 0.28,
            muzzle: 0.12,
            ear: 0.09,
            tail: 0.045,
            width: 0.38,
        },
        aliases: ['bear'],
    },
    {
        id: 'animal-lion',
        name: '狮子',
        height: 1.4,
        group: '野生动物',
        shape: {
            species: 'lion',
            body: 1,
            leg: 0.56,
            neck: 0.12,
            head: 0.23,
            muzzle: 0.1,
            ear: 0.1,
            tail: 0.7,
            width: 0.25,
        },
        aliases: ['狮', 'lion'],
    },
    {
        id: 'animal-tiger',
        name: '老虎',
        height: 1.2,
        group: '野生动物',
        shape: {
            species: 'tiger',
            body: 1.1,
            leg: 0.52,
            neck: 0.09,
            head: 0.23,
            muzzle: 0.09,
            ear: 0.09,
            tail: 0.72,
            width: 0.26,
        },
        aliases: ['虎', 'tiger'],
    },
    {
        id: 'animal-elephant',
        name: '大象',
        height: 3.4,
        group: '野生动物',
        shape: {
            species: 'elephant',
            body: 1.3,
            leg: 0.82,
            neck: 0.1,
            head: 0.38,
            muzzle: 0.08,
            ear: 0.08,
            tail: 0.45,
            width: 0.48,
        },
        aliases: ['象', 'elephant'],
    },
    {
        id: 'animal-giraffe',
        name: '长颈鹿',
        height: 5.0,
        group: '野生动物',
        shape: {
            species: 'giraffe',
            body: 0.9,
            leg: 0.98,
            neck: 1.25,
            head: 0.19,
            muzzle: 0.17,
            ear: 0.13,
            tail: 0.47,
            width: 0.25,
            hoof: true,
        },
        aliases: ['giraffe'],
    },
    {
        id: 'animal-gorilla',
        name: '猩猩',
        height: 1.65,
        group: '野生动物',
        shape: {
            species: 'gorilla',
            body: 0.6,
            leg: 0.55,
            neck: 0.07,
            head: 0.24,
            muzzle: 0.08,
            ear: 0.045,
            tail: 0,
            width: 0.37,
        },
        aliases: ['大猩猩', 'gorilla', 'ape'],
    },
];
export const QUADRUPED_SHAPES: Readonly<Record<string, QuadrupedShape>> = Object.fromEntries(
    presets.map((p) => [p.id, { ...base, ...p.shape }]),
);
export const QUADRUPED_JOINTS = {
    head: '头部俯仰',
    headYaw: '头部转向',
    torso: '躯干俯仰',
    leftArm: '左前腿',
    rightArm: '右前腿',
    leftElbow: '左前腿下段',
    rightElbow: '右前腿下段',
    leftHip: '左后腿',
    rightHip: '右后腿',
    leftKnee: '左后腿下段',
    rightKnee: '右后腿下段',
};
export const ANIMAL_ASSETS: readonly AssetDefinition[] = presets.map((p) => ({
    id: p.id,
    name: p.name,
    kind: 'actor',
    group: p.group,
    icon: '♧',
    family: 'quadruped-v1',
    aliases: p.aliases,
    parameters: quadrupedParameterSchema(QUADRUPED_SHAPES[p.id]),
    defaults: { height: p.height },
    joints: QUADRUPED_JOINTS,
    capabilities: { rig: 'quadruped', actions: ['idle'], pose: true, path: true },
}));
