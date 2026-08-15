export function optionValue(option) {
  return option && typeof option === 'object' ? option.value ?? option.label : option;
}

export function modelTypeLabel(type) {
  return {
    textGeneration: '文本生成',
    imageGeneration: '图片生成',
    videoGeneration: '视频生成',
    audioGeneration: '音频生成',
  }[type] || type || '未知类型';
}

export function optionLabel(param, value) {
  if (param.optionLabels?.[value] != null) return String(param.optionLabels[value]);
  const option = (param.options || []).find((item) => optionValue(item) === value);
  if (option && typeof option === 'object') return option.label ?? option.value ?? value;
  return String(option ?? value ?? param.default ?? '');
}

export function isAspectRatioParam(param) {
  const control = param.presentation && typeof param.presentation === 'object'
    ? param.presentation.control
    : param.presentation;
  return control === 'ratio' || control === 'aspectRatio'
    || param.key === 'aspectRatio'
    || String(param.label || '').includes('比例');
}

export function paramPresentation(param) {
  return param?.presentation && typeof param.presentation === 'object'
    ? param.presentation
    : {};
}

export function isSizeParam(param) {
  const key = String(param?.key || '').toLowerCase();
  return key.includes('size') || String(param?.label || '').includes('尺寸');
}

function paramVisualType(param) {
  const key = String(param.key || param.label || '').toLowerCase();
  const label = String(param.label || '');
  if (isSizeParam(param)) return 'size';
  if (key.includes('count') || label.includes('张数') || label.includes('数量')) return 'count';
  if (key.includes('duration') || label.includes('时长')) return 'duration';
  if (key.includes('resolution') || label.includes('清晰') || label.includes('画质')) return 'resolution';
  if (key.includes('token') || label.includes('长度')) return 'length';
  if (key.includes('temperature') || label.includes('温度')) return 'temperature';
  if (key.includes('style') || label.includes('风格')) return 'style';
  return 'option';
}

export function paramVisualClass(param, value) {
  return [`param-visual-${paramVisualType(param)}`, `param-visual-value-${String(value).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'default'}`];
}

export function paramVisualText(param, value) {
  const type = paramVisualType(param);
  const text = String(optionLabel(param, value));
  if (type === 'resolution') {
    if (text.toLowerCase().includes('1080')) return 'HD';
    return text.replace(/p$/i, '').replace(/^0+/, '') || text;
  }
  if (type === 'duration') return text.replace('秒', 's');
  if (type === 'temperature') return '℃';
  if (type === 'style') return text.slice(0, 1).toUpperCase();
  if (type === 'length') return text.replace('K', 'k');
  return text;
}

export function paramOptionHint(param) {
  const type = paramVisualType(param);
  return {
    size: '输出规格',
    count: '生成数量',
    duration: '生成时长',
    resolution: '输出清晰度',
    length: '文本长度',
    temperature: '创意发散度',
    style: '风格预设',
  }[type] || param.label || '参数选项';
}

export function aspectRatioStyle(value) {
  const match = String(value || '1:1').trim().match(
    /([0-9]+(?:\.[0-9]+)?)\s*(?::|x|×|\/)\s*([0-9]+(?:\.[0-9]+)?)/i,
  );
  const rawWidth = Number(match?.[1]);
  const rawHeight = Number(match?.[2]);
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;
  const ratio = width / height;
  return {
    width: `${ratio >= 1 ? 18 : Math.max(9, Math.round(18 * ratio))}px`,
    height: `${ratio >= 1 ? Math.max(9, Math.round(18 / ratio)) : 18}px`,
  };
}

export function modelDescription(model = '', type = '') {
  const value = String(model).toLowerCase();
  const descriptions = [
    [(v) => v.includes('gpt-image'), 'StarRouter /v1/images/generations 图片模型'],
    [(v) => v.includes('doubao') || v.includes('seedream'), 'StarRouter 可用图片/视频模型，需对应专用 endpoint'],
    [(v) => v.includes('grok') && v.includes('image'), 'xAI 图像模型，StarRouter 可用'],
    [(v) => v.includes('gemini') && v.includes('image'), 'Gemini 图像模型，StarRouter 可用'],
    [(v) => v.includes('midjourney'), '风格感强，适合艺术视觉和氛围图'],
    [(v) => v.includes('flux'), '写实稳定，适合角色与产品细节'],
    [(v) => v.includes('sdxl') || v.includes('stable'), '本地/开源生态，适合可控生成'],
    [(v) => v.includes('kling'), '快手 Kling 视频模型，适合图生视频和镜头运动'],
    [(v) => v.includes('seedance'), '豆包 Seedance 视频模型，适合短片和镜头生成'],
    [(v) => v.includes('vidu'), 'Vidu 视频模型，适合短视频生成'],
    [(v) => v.includes('veo'), 'Google Veo 视频模型'],
    [(v) => v.includes('grok') && v.includes('video'), 'xAI 视频模型，StarRouter 可用'],
    [(v) => v.includes('sora'), '长镜头与复杂运动表现更强'],
    [(v) => v.includes('runway'), '视频编辑和商业短片常用'],
    [(v) => v.includes('pika'), '轻量短视频生成'], [(v) => v.includes('luma'), '镜头感和空间运动较好'],
    [(v) => v.includes('suno'), '音乐、歌词和歌曲生成'],
    [(v) => v.includes('whisper') || v.includes('asr'), '语音识别/音频转写模型'],
    [(v) => v.includes('pawsense'), '音频理解模型'], [(v) => v.includes('udio'), '音乐质感和编曲表现较好'],
    [(v) => v.includes('eleven'), '语音、旁白和角色声音'],
    [(v) => v.includes('gemini'), 'Gemini 文本/多模态模型'], [(v) => v.includes('deepseek'), 'DeepSeek 推理和结构化文本'],
    [(v) => v.includes('qwen'), '通义千问文本/视觉语言模型'], [(v) => v.includes('gpt'), 'OpenAI-compatible 文本模型'],
    [(v) => v.includes('grok'), 'xAI 文本模型'],
  ];
  const matched = descriptions.find(([matches]) => matches(value));
  if (matched) return matched[1];
  return {
    imageGeneration: '图片生成模型',
    videoGeneration: '视频生成模型',
    audioGeneration: '音频生成模型',
  }[type] || '文本生成模型';
}
