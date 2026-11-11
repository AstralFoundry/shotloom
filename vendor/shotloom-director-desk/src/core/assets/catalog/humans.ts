import type { AssetDefinition } from './types.ts';
import { humanParameterSchema } from './human-options.ts';

/** Relative limb dimensions are defined separately from the entity's height. */
export interface HumanProportions {
    thigh: number;
    shin: number;
    torso: number;
    upperArm: number;
    forearm: number;
    shoulder: number;
    pelvis: number;
    head: number;
    girth: number;
    form?: 'elf' | 'orc' | 'robot' | 'skeleton';
    outfit?: 'casual' | 'dress' | 'robe' | 'armor' | 'uniform' | 'helmet' | 'hat' | 'backpack';
}
const adult: HumanProportions = {
    thigh: 0.42,
    shin: 0.414,
    torso: 0.44,
    upperArm: 0.27,
    forearm: 0.25,
    shoulder: 0.19,
    pelvis: 0.1,
    head: 0.15,
    girth: 1,
};
const profiles: Array<{
    id: string;
    name: string;
    height: number;
    gender?: 'male' | 'female';
    group?: string;
    shape?: Partial<HumanProportions>;
    aliases: string[];
}> = [
    { id: 'human-adult', name: '标准成年人物', height: 1.75, aliases: ['男', '成年人', 'human', 'adult'] },
    {
        id: 'human-female',
        name: '成年女性',
        height: 1.65,
        gender: 'female',
        shape: { shoulder: 0.17, pelvis: 0.11, girth: 0.94 },
        aliases: ['女', 'woman'],
    },
    {
        id: 'human-child',
        name: '儿童',
        height: 1.12,
        shape: { thigh: 0.31, shin: 0.3, torso: 0.4, head: 0.18, shoulder: 0.16, upperArm: 0.22, forearm: 0.2 },
        aliases: ['小孩', 'child'],
    },
    {
        id: 'human-teen',
        name: '青少年',
        height: 1.52,
        shape: { shoulder: 0.17, girth: 0.88, head: 0.16 },
        aliases: ['少年', '少女', 'teen'],
    },
    {
        id: 'human-elder',
        name: '老年人物',
        height: 1.62,
        shape: { shoulder: 0.17, girth: 0.92, torso: 0.42 },
        aliases: ['老人', 'elder'],
    },
    {
        id: 'human-slender',
        name: '瘦型人物',
        height: 1.78,
        shape: { shoulder: 0.17, girth: 0.78 },
        aliases: ['纤细', 'slim'],
    },
    {
        id: 'human-muscular',
        name: '壮型人物',
        height: 1.85,
        shape: { shoulder: 0.23, pelvis: 0.11, girth: 1.3 },
        aliases: ['健壮', '肌肉', 'muscular'],
    },
    {
        id: 'human-full',
        name: '丰体型人物',
        height: 1.72,
        shape: { shoulder: 0.22, pelvis: 0.14, girth: 1.48 },
        aliases: ['胖', '丰满', 'full'],
    },
    {
        id: 'human-giant',
        name: '巨人',
        height: 4.2,
        shape: { shoulder: 0.23, pelvis: 0.12, torso: 0.49, head: 0.135, girth: 1.25 },
        aliases: ['巨大', 'giant'],
    },
    {
        id: 'human-dwarf',
        name: '矮人',
        height: 1.2,
        shape: {
            thigh: 0.26,
            shin: 0.24,
            torso: 0.47,
            shoulder: 0.23,
            pelvis: 0.12,
            head: 0.17,
            upperArm: 0.24,
            forearm: 0.22,
            girth: 1.25,
        },
        aliases: ['矮个', 'dwarf'],
    },
    {
        id: 'human-heavy-giant',
        name: '魁梧巨人',
        height: 5.5,
        shape: { thigh: 0.39, shin: 0.37, torso: 0.51, shoulder: 0.28, pelvis: 0.16, girth: 1.65 },
        aliases: ['巨兽人形', 'heavy giant'],
    },
    {
        id: 'human-longlimb',
        name: '长肢人形',
        height: 2.3,
        shape: { thigh: 0.57, shin: 0.54, torso: 0.41, upperArm: 0.36, forearm: 0.34, girth: 0.85 },
        aliases: ['长腿', '长臂', 'long limbs'],
    },
    {
        id: 'human-elf',
        name: '精灵人形',
        height: 1.85,
        group: '特殊人形',
        shape: { form: 'elf', shoulder: 0.17, girth: 0.85 },
        aliases: ['精灵', 'elf'],
    },
    {
        id: 'human-orc',
        name: '兽人人形',
        height: 2.05,
        group: '特殊人形',
        shape: { form: 'orc', shoulder: 0.25, pelvis: 0.13, girth: 1.4, head: 0.17 },
        aliases: ['兽人', 'orc'],
    },
    {
        id: 'human-robot',
        name: '机器人',
        height: 1.8,
        group: '特殊人形',
        shape: { form: 'robot', shoulder: 0.21 },
        aliases: ['机械人', 'robot'],
    },
    {
        id: 'human-skeleton',
        name: '骨架人偶',
        height: 1.75,
        group: '特殊人形',
        shape: { form: 'skeleton', girth: 0.45, shoulder: 0.17 },
        aliases: ['骷髅', '骨骼', 'skeleton'],
    },
    ...(['casual', 'dress', 'robe', 'armor', 'uniform', 'helmet', 'hat', 'backpack'] as const).map((outfit, i) => ({
        id: 'human-outfit-' + outfit,
        name: ['便装人物', '长裙人物', '长袍人物', '盔甲人物', '制服人物', '头盔人物', '宽檐帽人物', '背包人物'][i],
        height: 1.75,
        group: '服装轮廓',
        shape: { outfit },
        aliases: [outfit, '服装'],
    })),
];
export const HUMAN_PROPORTIONS: Readonly<Record<string, HumanProportions>> = Object.fromEntries(
    profiles.map((p) => [p.id, { ...adult, ...p.shape }]),
);
const actions = [
    'idle',
    'walk',
    'run',
    'sit',
    'standup',
    'crouch',
    'crawl',
    'jump',
    'lie',
    'fall',
    'wave',
    'point',
    'turn',
    'guard',
    'punch',
    'kick',
    'roundhouse',
    'flying-kick',
    'dodge',
    'throw',
    'push',
    'stumble',
    'roll',
] as const;
const editableVariantIds = new Set([
    'human-adult',
    'human-female',
    'human-teen',
    'human-elder',
    'human-slender',
    'human-muscular',
    'human-full',
]);
const retiredVariantIds = new Set([
    'human-giant',
    'human-dwarf',
    'human-heavy-giant',
    'human-longlimb',
    'human-elf',
    'human-orc',
    'human-robot',
    'human-skeleton',
]);
export const HUMAN_ASSETS: readonly AssetDefinition[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    kind: 'actor',
    group:
        p.group ??
        (p.id.includes('giant') || p.id.includes('dwarf') || p.id.includes('longlimb') ? '特殊人形' : '人物'),
    icon: '♙',
    aliases: p.aliases,
    libraryHidden: editableVariantIds.has(p.id) || p.id.startsWith('human-outfit-'),
    libraryRetired: retiredVariantIds.has(p.id),
    family: 'human-v2',
    defaults: { height: p.height, gender: p.gender ?? 'male' },
    parameters: humanParameterSchema(HUMAN_PROPORTIONS[p.id]),
    capabilities: { rig: 'human', actions, pose: true, path: true },
}));
