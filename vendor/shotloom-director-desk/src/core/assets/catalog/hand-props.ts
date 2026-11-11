import type { AssetDefinition } from './types.ts';

export const HAND_PROP_SPECS = [
    {
        id: 'prop-cup',
        name: '杯子 · 空心',
        style: 'cup',
        width: 0.1,
        height: 0.1,
        depth: 0.08,
        aliases: ['水杯', 'cup'],
    },
    { id: 'prop-bowl', name: '碗', style: 'bowl', width: 0.18, height: 0.09, depth: 0.18, aliases: ['bowl'] },
    {
        id: 'prop-plate',
        name: '盘子',
        style: 'plate',
        width: 0.25,
        height: 0.025,
        depth: 0.25,
        aliases: ['碟', 'plate'],
    },
    {
        id: 'prop-bottle',
        name: '瓶子',
        style: 'bottle',
        width: 0.075,
        height: 0.28,
        depth: 0.075,
        aliases: ['水瓶', 'bottle'],
    },
    { id: 'prop-book', name: '书', style: 'book', width: 0.16, height: 0.035, depth: 0.24, aliases: ['书本', 'book'] },
    {
        id: 'prop-phone',
        name: '手机',
        style: 'phone',
        width: 0.075,
        height: 0.008,
        depth: 0.155,
        aliases: ['电话', 'phone'],
    },
    {
        id: 'prop-suitcase',
        name: '行李箱',
        style: 'suitcase',
        width: 0.4,
        height: 0.6,
        depth: 0.25,
        aliases: ['旅行箱', 'suitcase'],
    },
    {
        id: 'prop-backpack',
        name: '背包',
        style: 'backpack',
        width: 0.3,
        height: 0.48,
        depth: 0.2,
        aliases: ['书包', '箱包', 'backpack'],
    },
] as const;
export const HAND_PROP_ASSETS: readonly AssetDefinition[] = HAND_PROP_SPECS.map((s) => ({
    id: s.id,
    name: s.name,
    kind: 'prop',
    group: '生活道具',
    icon: '◇',
    family: 'hand-prop-v1',
    aliases: s.aliases,
    capabilities: { rig: 'none', actions: [], pose: false, path: true },
    parameters: Object.fromEntries(
        (
            [
                ['width', '宽度'],
                ['height', '高度'],
                ['depth', '进深'],
            ] as const
        ).map(([key, label]) => [key, { label, default: s[key], min: 0.002, max: 20, step: 0.005, unit: '米' }]),
    ),
}));
