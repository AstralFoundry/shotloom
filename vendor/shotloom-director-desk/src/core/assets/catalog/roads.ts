import type { AssetDefinition } from './types.ts';
import { lengthField } from './architecture.ts';
const specs = [
    ['straight', '直路', 6, 10, 0.12],
    ['curve', '弯路', 6, 10, 0.12],
    ['junction', '十字路口', 6, 16, 0.12],
    ['sidewalk', '人行道', 2, 8, 0.18],
    ['curb', '路缘石', 0.2, 4, 0.18],
    ['bridge', '桥面 · 带护栏', 5, 10, 0.35],
    ['busstop', '公交站亭', 4, 1.8, 2.5],
    ['parking', '停车位', 2.5, 5, 0.08],
] as const;
export const ROAD_ASSETS: readonly AssetDefinition[] = specs.map(([style, name, width, length, height]) => ({
    id: 'road-' + style,
    name,
    kind: 'prop',
    group: '道路市政',
    icon: 'Ⅱ',
    family: 'road-v1',
    aliases: [style, '道路'],
    capabilities: { rig: 'none', actions: [], pose: false, path: true },
    parameters: {
        width: lengthField('宽度', width),
        height: lengthField(style === 'busstop' ? '站亭高度' : '结构厚度', height, style === 'busstop' ? 1.2 : 0.02),
        ...(style === 'curve'
            ? {
                  radius: lengthField('中心线半径', 8),
                  turn: { label: '弯曲角度', default: 90, min: 15, max: 270, step: 1, unit: '度' },
              }
            : { length: lengthField('长度／进深', length) }),
    },
}));
