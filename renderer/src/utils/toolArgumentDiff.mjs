const MAX_VALUE_LENGTH = 60;

function preview(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof text !== 'string') return '';
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

/**
 * 汇总用户在确认时改动了哪些顶层参数。
 *
 * 只描述顶层键和值的短预览：模型需要的是"改了什么方向"，而不是把整份长参数体
 * （提示词、操作列表）重新灌回上下文。没有改动时返回空串，调用方据此不附加说明。
 */
export function describeArgumentChanges(before, after) {
  const previous = before && typeof before === 'object' ? before : {};
  const next = after && typeof after === 'object' ? after : {};
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();
  const changes = [];
  for (const key of keys) {
    const from = JSON.stringify(previous[key]);
    const to = JSON.stringify(next[key]);
    if (from === to) continue;
    if (!(key in next)) changes.push(`${key}：已移除`);
    else if (!(key in previous)) changes.push(`${key}：新增 ${preview(next[key])}`);
    else changes.push(`${key}：${preview(previous[key])} → ${preview(next[key])}`);
  }
  return changes.join('；');
}

export function userOverrideNote(changes) {
  if (!changes) return '';
  return `用户在确认时手动修改了参数（${changes}）。请把这次执行结果当作最终结果，不要再用原参数重试。`;
}
