/**
 * Campath DSL: describe a camera move as readable beats instead of raw keyframes.
 *
 * Point-by-point keyframes make the caller do the cinematography arithmetic — where a 3.5 m dolly
 * ends up, how far an orbit travels, whether the crane clears the table. That is where mis-typed
 * coordinates came from, including a follow camera that ended up inside a wall. This compiler turns
 * verbs (`dolly in 3.5 3s`, `orbit right 120 4s rise 1.2`) into timed positions, and reports the
 * source line on every mistake.
 *
 * Pure: no three.js, no DOM, no project access — so the whole grammar can be tested directly.
 */
import type { Vec3 } from '../model.ts';

export type CampathLook =
    | { mode: 'target'; entityId: string }
    | { mode: 'at'; point: Vec3 }
    | { mode: 'ahead' };

export interface CampathResult {
    name: string;
    /** Absolute seconds, strictly increasing, starting at the `from` position. */
    points: { time: number; position: Vec3 }[];
    look: CampathLook;
    /** Focal length per keyframe when any segment sets one; otherwise null keeps the camera's own. */
    focalKeys: { time: number; value: number }[] | null;
    duration: number;
    loop: false | 'loop' | 'pingpong';
    /** Non-fatal: values were clamped, or a requested behaviour is not expressible here. */
    warnings: string[];
}

const SEGMENT_SECONDS_MIN = 0.5;
const SEGMENT_SECONDS_MAX = 120;
const FOCAL_MIN = 10;
const FOCAL_MAX = 120;

const number = (text: string, line: number, what: string): number => {
    const value = Number(text);
    if (!Number.isFinite(value)) throw Error(`第 ${line} 行：${what}需要数值，收到「${text}」`);
    return value;
};

/** `3s` / `2.5s` — the DSL always says seconds explicitly, so a bare number cannot be misread as metres. */
const seconds = (text: string, line: number): number => {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(text);
    if (!match) throw Error(`第 ${line} 行：时长要写成「3s」这样的秒数，收到「${text}」`);
    const value = Number(match[1]);
    if (value <= 0) throw Error(`第 ${line} 行：时长必须大于 0`);
    return value;
};

const direction = (text: string, line: number, allowed: readonly string[]): string => {
    if (!allowed.includes(text)) throw Error(`第 ${line} 行：方向只能是 ${allowed.join(' / ')}，收到「${text}」`);
    return text;
};

function parseFocal(tokens: string[], from: number, line: number, warnings: string[]): { focal?: number; next: number } {
    if (tokens[from] !== 'fov') return { next: from };
    const raw = number(tokens[from + 1] ?? '', line, 'fov ');
    const focal = Math.min(FOCAL_MAX, Math.max(FOCAL_MIN, raw));
    if (focal !== raw) warnings.push(`第 ${line} 行：fov ${raw} 超出 ${FOCAL_MIN}—${FOCAL_MAX}，已按 ${focal} 处理`);
    return { focal, next: from + 2 };
}

/**
 * Compile campath source. Throws with a line number; clamping and unsupported combinations are
 * returned as warnings so the caller can tell the user rather than silently deliver a different move.
 */
export function compileCampath(source: string): CampathResult {
    if (typeof source !== 'string' || !source.trim()) throw Error('campath 内容为空');
    const lines = source.split('\n').map((text, index) => ({ text: text.trim(), line: index + 1 })).filter((entry) => entry.text && !entry.text.startsWith('#'));
    if (!lines.length) throw Error('campath 内容为空');

    const header = /^campath\s+"([^"]+)"$/.exec(lines[0].text);
    if (!header) throw Error(`第 ${lines[0].line} 行：第一行必须是 campath "名称"`);
    const name = header[1].trim();
    if (!name) throw Error('campath 名称不能为空');

    const warnings: string[] = [];
    let look: CampathLook | null = null;
    let from: Vec3 | null = null;
    let easing = false;
    let loop: CampathResult['loop'] = false;
    let cursor = 0;
    let time = 0;
    let position: Vec3 | null = null;
    const points: { time: number; position: Vec3 }[] = [];
    const focalKeys: { time: number; value: number }[] = [];
    let anyFocal = false;
    let focal = 0;

    const push = () => {
        if (!position) throw Error('campath 内部错误：位置未初始化');
        points.push({ time: Number(time.toFixed(4)), position: [...position] as Vec3 });
        if (anyFocal) focalKeys.push({ time: Number(time.toFixed(4)), value: focal });
    };

    for (const { text, line } of lines.slice(1)) {
        const tokens = text.split(/\s+/);
        const head = tokens[0];

        if (head === 'look') {
            if (look) throw Error(`第 ${line} 行：look 只能声明一次`);
            if (tokens[1] === 'target') {
                const quoted = /^"([^"]+)"$/.exec(tokens[2] ?? '');
                if (!quoted) throw Error(`第 ${line} 行：look target 需要一个带引号的目标 ID`);
                look = { mode: 'target', entityId: quoted[1] };
            } else if (tokens[1] === 'at') {
                look = {
                    mode: 'at',
                    point: [number(tokens[2] ?? '', line, 'look at 的 x '), number(tokens[3] ?? '', line, 'look at 的 y '), number(tokens[4] ?? '', line, 'look at 的 z ')],
                };
            } else if (tokens[1] === 'ahead') {
                look = { mode: 'ahead' };
                warnings.push(`第 ${line} 行：本导演台的机位朝向不会随路径自动转向，look ahead 只能保持手动朝向；要跟着转向请用 look at 分段或换机位`);
            } else throw Error(`第 ${line} 行：look 只能是 target / at / ahead`);
            continue;
        }
        if (head === 'easing') {
            if (!['linear', 'easeIn', 'easeOut', 'easeInOut', 'smoothstep'].includes(tokens[1] ?? ''))
                throw Error(`第 ${line} 行：easing 只能是 linear / easeIn / easeOut / easeInOut / smoothstep`);
            // Our paths interpolate per segment; a global easing is accepted for compatibility and
            // stated once, rather than pretending to apply it to individual keyframes.
            if (!easing) warnings.push(`第 ${line} 行：本导演台按关键帧插值，easing ${tokens[1]} 不会逐段改变速度曲线；要控速请调整相邻关键帧的时间间隔`);
            easing = true;
            continue;
        }
        if (head === 'loop') {
            loop = tokens[1] === 'pingpong' ? 'pingpong' : 'loop';
            if (tokens[1] && tokens[1] !== 'pingpong') throw Error(`第 ${line} 行：loop 后面只能写 pingpong`);
            warnings.push(`第 ${line} 行：本导演台没有循环标记，机位按给定关键帧播放一次；需要重复请复制机位或延长工程`);
            continue;
        }
        if (head === 'from') {
            from = [number(tokens[1] ?? '', line, 'from 的 x '), number(tokens[2] ?? '', line, 'from 的 y '), number(tokens[3] ?? '', line, 'from 的 z ')];
            const parsed = parseFocal(tokens, 4, line, warnings);
            if (parsed.focal !== undefined) {
                focal = parsed.focal;
                anyFocal = true;
            }
            continue;
        }

        if (!from) throw Error(`第 ${line} 行：from x y z 必须在任何运动段之前`);

        // First segment: seed the path at `from`.
        if (!position) {
            position = [...from] as Vec3;
            time = 0;
            push();
        }

        if (head === 'move') {
            if (tokens[1] !== 'to') throw Error(`第 ${line} 行：move 要写成「move to x y z 2s」`);
            const to: Vec3 = [number(tokens[2] ?? '', line, 'move 的 x '), number(tokens[3] ?? '', line, 'move 的 y '), number(tokens[4] ?? '', line, 'move 的 z ')];
            const secondsSpan = seconds(tokens[5] ?? '', line);
            const parsed = parseFocal(tokens, 6, line, warnings);
            if (parsed.focal !== undefined) { focal = parsed.focal; anyFocal = true; }
            cursor = 0;
            position = to;
            time += secondsSpan;
            push();
            continue;
        }
        if (head === 'dolly' || head === 'truck' || head === 'crane') {
            const kind = head;
            const dir = direction(tokens[1] ?? '', line, kind === 'dolly' ? ['in', 'out'] : kind === 'truck' ? ['left', 'right'] : ['up', 'down']);
            const metres = Math.abs(number(tokens[2] ?? '', line, `${kind} 的距离 `));
            const secondsSpan = seconds(tokens[3] ?? '', line);
            const parsed = parseFocal(tokens, 4, line, warnings);
            if (parsed.focal !== undefined) { focal = parsed.focal; anyFocal = true; }
            if ((kind === 'dolly' || kind === 'truck') && (!look || look.mode === 'ahead'))
                throw Error(`第 ${line} 行：${kind} 是相对主体的运动，需要 look target 或 look at`);
            if (!position) throw Error(`第 ${line} 行：缺少 from`);
            const focus = look && look.mode === 'at' ? look.point : null;
            let dx = 0, dy = 0, dz = 0;
            if (kind === 'crane') {
                dy = dir === 'up' ? metres : -metres;
            } else if (kind === 'dolly') {
                // Toward (in) or away from (out) the subject; a target id resolves its point at apply time,
                // so here the direction is only known for `look at` — otherwise keep it along the aim axis.
                if (focus) {
                    const away = [position[0] - focus[0], position[1] - focus[1], position[2] - focus[2]];
                    const length = Math.hypot(away[0], away[1], away[2]) || 1;
                    const sign = dir === 'in' ? -1 : 1;
                    dx = (away[0] / length) * metres * sign;
                    dy = (away[1] / length) * metres * sign * 0.35;
                    dz = (away[2] / length) * metres * sign;
                } else {
                    // `look target` cannot be resolved without the scene; move along the path's own
                    // heading, which the caller can correct with a later `move to`.
                    warnings.push(`第 ${line} 行：look target 的主体位置要到应用时才知道，dolly ${dir} 已按机位当前朝向推进 ${metres} 米；方向不对请改用 move to 或 look at`);
                    const previous = points[points.length - 1]?.position ?? position;
                    const heading = [position[0] - previous[0], 0, position[2] - previous[2]];
                    const length = Math.hypot(heading[0], heading[2]) || 1;
                    const sign = dir === 'in' ? 1 : -1;
                    dx = (heading[0] / length) * metres * sign;
                    dz = (heading[2] / length) * metres * sign;
                }
            } else {
                // Truck: sideways relative to the aim axis, horizontal only.
                const focusPoint = focus ?? [position[0], position[1], position[2] - 1];
                const away = [position[0] - focusPoint[0], 0, position[2] - focusPoint[2]];
                const length = Math.hypot(away[0], away[2]) || 1;
                const side = [away[2] / length, 0, -away[0] / length];
                const sign = dir === 'left' ? -1 : 1;
                dx = side[0] * metres * sign;
                dz = side[2] * metres * sign;
            }
            cursor = 0;
            position = [position[0] + dx, position[1] + dy, position[2] + dz];
            time += secondsSpan;
            push();
            continue;
        }
        if (head === 'orbit') {
            const dir = direction(tokens[1] ?? '', line, ['left', 'right']);
            const degrees = number(tokens[2] ?? '', line, 'orbit 的角度 ');
            const secondsSpan = seconds(tokens[3] ?? '', line);
            let rise = 0;
            let radius: number | null = null;
            let index = 4;
            while (index < tokens.length) {
                if (tokens[index] === 'rise') {
                    rise = number(tokens[index + 1] ?? '', line, 'rise 的高度 ');
                    index += 2;
                } else if (tokens[index] === 'radius') {
                    radius = Math.abs(number(tokens[index + 1] ?? '', line, 'radius 的半径 '));
                    index += 2;
                } else if (tokens[index] === 'fov') {
                    const raw = number(tokens[index + 1] ?? '', line, 'fov ');
                    focal = Math.min(FOCAL_MAX, Math.max(FOCAL_MIN, raw));
                    if (focal !== raw) warnings.push(`第 ${line} 行：fov ${raw} 超出 ${FOCAL_MIN}—${FOCAL_MAX}，已按 ${focal} 处理`);
                    anyFocal = true;
                    index += 2;
                } else throw Error(`第 ${line} 行：orbit 不认识的参数「${tokens[index]}」`);
            }
            if (!look || look.mode === 'ahead') throw Error(`第 ${line} 行：orbit 需要一个中心点，请写 look target 或 look at`);
            const centre: Vec3 = focusOf(look, position);
            const here: Vec3 = position;
            const away: [number, number, number] = [here[0] - centre[0], 0, here[2] - centre[2]];
            const distance: number = radius ?? Math.max(0.5, Math.hypot(away[0], away[2]));
            const startAngle = Math.atan2(away[2], away[0]);
            const sweep = (Math.PI / 180) * Math.abs(degrees) * (dir === 'right' ? -1 : 1);
            const arcRadius = distance;
            const startY = here[1];
            // Eight steps keep the arc visually round without flooding the timeline with keys.
            const steps = 8;
            for (let step = 1; step <= steps; step += 1) {
                const u = step / steps;
                const angle = startAngle + sweep * u;
                position = [
                    centre[0] + Math.cos(angle) * arcRadius,
                    startY + rise * u,
                    centre[2] + Math.sin(angle) * arcRadius,
                ];
                time += secondsSpan / steps;
                push();
            }
            continue;
        }
        if (head === 'hold') {
            const secondsSpan = seconds(tokens[1] ?? '', line);
            const parsed = parseFocal(tokens, 2, line, warnings);
            if (parsed.focal !== undefined) { focal = parsed.focal; anyFocal = true; }
            cursor = 0;
            time += secondsSpan;
            push();
            continue;
        }
        throw Error(`第 ${line} 行：不认识的动作「${head}」；可用 move to / dolly / truck / crane / orbit / hold`);
    }

    if (!look) throw Error('campath 缺少 look：请写 look target "id"、look at x y z 或 look ahead');
    if (!from) throw Error('campath 缺少 from x y z');
    if (!points.length) throw Error('campath 没有任何运动段：至少写一段 move / dolly / truck / crane / orbit / hold');
    const duration = points[points.length - 1].time;
    if (duration < SEGMENT_SECONDS_MIN || duration > SEGMENT_SECONDS_MAX)
        throw Error(`campath 总时长 ${duration.toFixed(2)}s 超出 ${SEGMENT_SECONDS_MIN}—${SEGMENT_SECONDS_MAX} 秒`);
    void cursor;
    return { name, points, look, focalKeys: anyFocal ? focalKeys : null, duration, loop, warnings };
}

/** Orbit/dolly centre: a fixed point, or — for `look target` — the camera's own aim is unknown here. */
function focusOf(look: CampathLook, position: Vec3): Vec3 {
    if (look.mode === 'at') return look.point;
    // `look target` needs the scene; aim a metre ahead of the camera as a stable stand-in and say so.
    return [position[0], position[1] - 0.4, position[2] - 1];
}
