export const TEXT_SUBTASKS = Object.freeze({
  GENERATE: 'text-generation',
  SEMANTIC_SPLIT: 'semantic-split',
  STORYBOARD: 'storyboard-generation',
});

export const TEXT_SUBTASK_OPTIONS = Object.freeze([
  { value: TEXT_SUBTASKS.GENERATE, label: '文本生成' },
  { value: TEXT_SUBTASKS.SEMANTIC_SPLIT, label: '语义拆分' },
  { value: TEXT_SUBTASKS.STORYBOARD, label: '分镜生成' },
]);

export const ADVANCED_TEXT_SUBTASK_MODELS = Object.freeze([
  'gemini-3.6-flash',
  'gpt-5.4',
  'gpt-5.6',
]);

export function normalizeTextSubtask(value) {
  return TEXT_SUBTASK_OPTIONS.some((option) => option.value === value)
    ? value
    : TEXT_SUBTASKS.GENERATE;
}

export function modelSupportsTextSubtask(model, subtask, capability = {}) {
  const normalizedSubtask = normalizeTextSubtask(subtask);
  if (normalizedSubtask === TEXT_SUBTASKS.GENERATE) return true;
  const configured = Array.isArray(capability.supportedTextSubtasks)
    ? capability.supportedTextSubtasks
    : [];
  return configured.includes(normalizedSubtask)
    || ADVANCED_TEXT_SUBTASK_MODELS.includes(String(model || ''));
}

export function stripJsonFence(value = '') {
  const text = String(value || '').trim();
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

export function parseSemanticSplitResult(value = '') {
  try {
    const parsed = JSON.parse(stripJsonFence(value));
    if (!Array.isArray(parsed)) return null;
    const segments = parsed.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const content = typeof item.content === 'string' ? item.content.trim() : '';
      const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
      if (!content || !summary) return null;
      const sourceId = Number(item.id);
      return {
        id: Number.isFinite(sourceId) ? sourceId : index + 1,
        summary,
        content,
      };
    }).filter(Boolean);
    return segments.length ? segments : null;
  } catch {
    return null;
  }
}

export function parseStoryboardResult(value = '', rows = 3, cols = 3) {
  const count = Math.max(1, Number(rows) || 3) * Math.max(1, Number(cols) || 3);
  try {
    const parsed = JSON.parse(stripJsonFence(value));
    if (!Array.isArray(parsed)) return null;
    const cells = parsed.map((item, index) => {
      if (typeof item === 'string') {
        const content = item.trim();
        return content ? { id: index + 1, content } : null;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const content = typeof item.content === 'string' ? item.content.trim() : '';
      if (!content) return null;
      const sourceId = Number(item.id);
      return {
        id: Number.isFinite(sourceId) ? sourceId : index + 1,
        summary: typeof item.summary === 'string' ? item.summary.trim() : '',
        content,
        schemaVersion: 2,
        scene: cleanStoryboardText(item.scene),
        shotSize: cleanStoryboardText(item.shotSize),
        cameraMove: cleanStoryboardText(item.cameraMove),
        action: cleanStoryboardText(item.action),
        orientation: cleanStoryboardText(item.orientation),
        spatialRelation: cleanStoryboardText(item.spatialRelation),
        emotion: cleanStoryboardText(item.emotion),
        duration: normalizeStoryboardDuration(item.duration),
        dialogue: cleanStoryboardText(item.dialogue),
        sound: cleanStoryboardText(item.sound),
      };
    }).filter(Boolean);
    if (!cells.length) return null;
    return Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      summary: cells[index]?.summary || '',
      content: cells[index]?.content || '',
      ...(cells[index] || {}),
      id: index + 1,
    }));
  } catch {
    return null;
  }
}

function cleanStoryboardText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStoryboardDuration(value) {
  const duration = Number(String(value ?? '').replace(/\s*s(?:ec(?:onds?)?)?$/i, ''));
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function orientationEntries(value) {
  const entries = new Map();
  cleanStoryboardText(value).split(/[;；]/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
    const separator = item.search(/[-—:：]/);
    const name = separator > 0 ? item.slice(0, separator).trim() : '主体';
    const detail = separator > 0 ? item.slice(separator + 1).trim() : item;
    const direction = /朝左|向左|面左/.test(detail) ? 'left' : /朝右|向右|面右/.test(detail) ? 'right' : '';
    if (direction) entries.set(name, direction);
  });
  return entries;
}

function spatialEntries(value) {
  const entries = new Map();
  const text = cleanStoryboardText(value);
  const pattern = /([^、,，;；()（）]+)[(（]([^()（）]+)[)）]/g;
  for (const match of text.matchAll(pattern)) {
    const position = match[2].trim();
    entries.set(match[1].trim(), {
      horizontal: position.includes('左') ? 'left' : position.includes('右') ? 'right' : 'center',
      depth: position.includes('前') ? 'front' : position.includes('后') ? 'back' : 'middle',
    });
  }
  return entries;
}

function hasTransitionEvidence(cell) {
  return /转身|转头|回身|绕行|绕到|换位|移动|走到|跑到|穿过|越过|过轴|轴线变化|反向建立/.test([
    cell?.action,
    cell?.content,
  ].filter(Boolean).join(' '));
}

function sameContinuitySpace(previous, current) {
  const previousScene = cleanStoryboardText(previous?.scene);
  const currentScene = cleanStoryboardText(current?.scene);
  return !previousScene || !currentScene || previousScene === currentScene;
}

export function isStructuredStoryboardCell(cell) {
  return Number(cell?.schemaVersion) >= 2 || [
    'scene', 'shotSize', 'cameraMove', 'action', 'orientation', 'spatialRelation',
    'emotion', 'duration', 'dialogue', 'sound',
  ].some((key) => cell?.[key] !== undefined && cell?.[key] !== '' && cell?.[key] !== null);
}

export function storyboardImagePrompt(cell = {}) {
  const sections = [cleanStoryboardText(cell.content)];
  const details = [
    ['场景', cell.scene],
    ['景别', cell.shotSize],
    ['运镜', cell.cameraMove],
    ['动作', cell.action],
    ['朝向', cell.orientation],
    ['空间关系', cell.spatialRelation],
    ['情绪', cell.emotion],
  ].filter(([, value]) => cleanStoryboardText(value));
  if (details.length) sections.push(details.map(([label, value]) => `${label}：${value}`).join('\n'));
  return sections.filter(Boolean).join('\n\n');
}

export function storyboardCellMetadata(cell = {}) {
  return [
    cell.summary,
    cell.scene && `场景：${cell.scene}`,
    cell.shotSize && `景别：${cell.shotSize}`,
    cell.cameraMove && `运镜：${cell.cameraMove}`,
    cell.action && `动作：${cell.action}`,
    cell.orientation && `朝向：${cell.orientation}`,
    cell.spatialRelation && `站位：${cell.spatialRelation}`,
    cell.emotion && `情绪：${cell.emotion}`,
    cell.duration && `时长：${cell.duration}s`,
    cell.dialogue && `台词：${cell.dialogue}`,
    cell.sound && `音效：${cell.sound}`,
  ].filter(Boolean).join('\n');
}

export function analyzeStoryboardContinuity(cells = []) {
  const issues = [];
  const shots = Array.isArray(cells) ? cells : [];
  shots.forEach((cell, index) => {
    if (!isStructuredStoryboardCell(cell)) return;
    const duration = Number(cell.duration);
    if (duration > 12) {
      issues.push({ code: 'duration-too-long', severity: 'warning', shotIndex: index, message: `镜头 ${index + 1} 时长 ${duration}s，建议拆镜或缩短到 12s 内` });
    }
    const dialogueLength = cleanStoryboardText(cell.dialogue).replace(/[\s，。！？、“”‘’：；,.!?"']/g, '').length;
    if (duration > 0 && dialogueLength > 0 && duration < Math.ceil(dialogueLength / 3) + 1) {
      issues.push({ code: 'dialogue-too-dense', severity: 'warning', shotIndex: index, message: `镜头 ${index + 1} 的 ${duration}s 可能放不下当前台词` });
    }
    if (!index || !sameContinuitySpace(shots[index - 1], cell) || hasTransitionEvidence(cell)) return;
    const previous = shots[index - 1];
    const previousOrientations = orientationEntries(previous.orientation);
    const currentOrientations = orientationEntries(cell.orientation);
    for (const [name, direction] of currentOrientations) {
      if (previousOrientations.has(name) && previousOrientations.get(name) !== direction) {
        issues.push({ code: 'orientation-flip', severity: 'warning', shotIndex: index, message: `镜头 ${index + 1} 的${name === '主体' ? '主体' : `“${name}”`}左右朝向改变，但动作中没有转身或过轴说明` });
      }
    }
    const previousPositions = spatialEntries(previous.spatialRelation);
    const currentPositions = spatialEntries(cell.spatialRelation);
    for (const [name, position] of currentPositions) {
      const before = previousPositions.get(name);
      if (!before) continue;
      if (before.horizontal !== position.horizontal && before.horizontal !== 'center' && position.horizontal !== 'center') {
        issues.push({ code: 'position-jump', severity: 'warning', shotIndex: index, message: `镜头 ${index + 1} 的“${name}”从画面${before.horizontal === 'left' ? '左' : '右'}侧跳到${position.horizontal === 'left' ? '左' : '右'}侧，但动作中没有换位说明` });
      }
    }
  });
  return issues;
}

export function textModeSystemPrompt(payload = {}) {
  const subtask = normalizeTextSubtask(payload.textSubtask);
  if (subtask === TEXT_SUBTASKS.SEMANTIC_SPLIT) {
    return [
      '你是专业的文本语义拆分编辑。',
      '请按语义完整性、场景变化、行动转折和叙事节奏拆分用户文本。',
      '只输出合法 JSON 数组，不要使用 Markdown 代码块或补充解释。',
      '每项格式必须是 {"id": 1, "summary": "简短标题", "content": "保留完整语义的原文或改写文本"}。',
    ].join('\n');
  }
  if (subtask === TEXT_SUBTASKS.STORYBOARD) {
    const rows = Math.max(1, Number(payload.splitRows) || 3);
    const cols = Math.max(1, Number(payload.splitCols) || 3);
    const count = rows * cols;
    return [
      '你是专业的影视分镜编剧。',
      `请把用户内容生成恰好 ${count} 个连续分镜，适配 ${rows} 行 × ${cols} 列分镜板。`,
      '每格只承载一个可由单次生成完成的连续镜头；场景、机位、主体或主要动作实质变化时才拆镜。',
      '保持相邻镜头的角色身份、动作进度、左右朝向、空间站位和屏幕轴线连续；发生转身、换位或过轴时必须写入 action。',
      'content 是可直接用于图片生成的完整画面提示词；dialogue 保留原话，sound 只写真实声源。',
      '只输出合法 JSON 数组，不要使用 Markdown 代码块或补充解释。',
      '每项格式必须是 {"id":1,"summary":"镜头标题","content":"完整画面提示词","scene":"场景","shotSize":"景别","cameraMove":"运镜","action":"含承接关系的动作链","orientation":"角色A-朝右;角色B-朝左","spatialRelation":"角色A(左前)、角色B(右中)","emotion":"情绪","duration":4,"dialogue":"台词或空字符串","sound":"真实音效或空字符串"}。',
    ].join('\n');
  }
  return '你是 Shotloom 的文本生成助手。请严格遵循用户要求，输出可直接使用的完整文本。';
}
