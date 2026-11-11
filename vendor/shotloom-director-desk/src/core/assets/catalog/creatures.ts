import type { AssetDefinition } from './types.ts';
import { creatureParameterSchema } from './animal-options.ts';
import { BIRD_JOINTS, FISH_JOINTS, SERPENT_JOINTS } from '../joint-schema.ts';

export interface CreatureShape {
    rig: 'bird' | 'fish' | 'serpent';
    species: 'chicken' | 'duck' | 'pigeon' | 'eagle' | 'pterosaur' | 'fish' | 'shark' | 'snake';
    height: number;
    body: number;
    width: number;
    leg: number;
    neck: number;
    wing: number;
}
const presets: Array<{ name: string; aliases: string[]; shape: CreatureShape }> = [
    {
        name: '鸡',
        aliases: ['家禽', 'chicken'],
        shape: {
            rig: 'bird',
            species: 'chicken',
            height: 0.5,
            body: 0.5,
            width: 0.18,
            leg: 0.18,
            neck: 0.22,
            wing: 0.24,
        },
    },
    {
        name: '鸭',
        aliases: ['家禽', 'duck'],
        shape: { rig: 'bird', species: 'duck', height: 0.45, body: 0.65, width: 0.2, leg: 0.12, neck: 0.2, wing: 0.28 },
    },
    {
        name: '鸽子',
        aliases: ['飞鸟', 'pigeon'],
        shape: {
            rig: 'bird',
            species: 'pigeon',
            height: 0.3,
            body: 0.5,
            width: 0.14,
            leg: 0.13,
            neck: 0.12,
            wing: 0.32,
        },
    },
    {
        name: '鹰',
        aliases: ['猛禽', 'eagle'],
        shape: {
            rig: 'bird',
            species: 'eagle',
            height: 0.8,
            body: 0.7,
            width: 0.22,
            leg: 0.22,
            neck: 0.12,
            wing: 0.85,
        },
    },
    {
        name: '翼龙轮廓',
        aliases: ['幻想生物', 'pterosaur'],
        shape: {
            rig: 'bird',
            species: 'pterosaur',
            height: 1.6,
            body: 0.85,
            width: 0.22,
            leg: 0.3,
            neck: 0.45,
            wing: 1.65,
        },
    },
    {
        name: '鱼',
        aliases: ['游鱼', 'fish'],
        shape: { rig: 'fish', species: 'fish', height: 0.28, body: 0.8, width: 0.15, leg: 0, neck: 0, wing: 0.18 },
    },
    {
        name: '鲨鱼',
        aliases: ['水生', 'shark'],
        shape: { rig: 'fish', species: 'shark', height: 0.9, body: 2.2, width: 0.27, leg: 0, neck: 0, wing: 0.6 },
    },
    {
        name: '蛇',
        aliases: ['爬虫', 'snake'],
        shape: { rig: 'serpent', species: 'snake', height: 0.12, body: 2.0, width: 0.055, leg: 0, neck: 0, wing: 0 },
    },
];
export const CREATURE_SHAPES: Readonly<Record<string, CreatureShape>> = Object.fromEntries(
    presets.map((p) => ['animal-' + p.shape.species, p.shape]),
);
export const CREATURE_ASSETS: readonly AssetDefinition[] = presets.map((p) => ({
    id: 'animal-' + p.shape.species,
    name: p.name,
    aliases: p.aliases,
    kind: 'actor',
    group: '飞禽水生幻想',
    icon: '♧',
    family: p.shape.rig + '-v1',
    defaults: { height: p.shape.height },
    capabilities: { rig: p.shape.rig, actions: ['idle'], pose: true, path: true },
    parameters: creatureParameterSchema(p.shape),
    joints: p.shape.rig === 'bird' ? BIRD_JOINTS : p.shape.rig === 'fish' ? FISH_JOINTS : SERPENT_JOINTS,
}));
