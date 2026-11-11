import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/sourceContract.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const env = await createRendererEnv();
after(() => env.dispose());

test('中英文文案键与参数保持一致，参数内容不再次参与模板替换', async () => {
  const { default: zh } = await env.load('i18n/locales/zh-CN.json');
  const { default: en } = await env.load('i18n/locales/en-US.json');
  const { t, createTranslator } = await env.load('i18n/index');
  const placeholders = text => [...text.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).sort();
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of Object.keys(zh)) {
    assert.ok(zh[key].trim());
    assert.ok(en[key].trim());
    assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), key);
  }
  assert.equal(t('agent.connectionTimeout'), 'Agent 连接超时，请重试');
  assert.equal(createTranslator('en-US')('agent.connectionTimeout'), 'Agent connection timed out. Please retry.');
  assert.equal(t('project.exported', { count: 0 }), '项目包已导出（0 个文件）');
  assert.equal(t('project.copied', { name: '测试 {name} $&' }), '已复制项目「测试 {name} $&」');
});

test('厂商目录所有翻译键存在，英文展示不改变模型协议与提交选项值', async () => {
  const { default: zh } = await env.load('i18n/locales/zh-CN.json');
  const { default: en } = await env.load('i18n/locales/en-US.json');
  const { modelCatalogV2: { models } } = await env.load('config/model-catalog-v2/index');
  let references = 0;
  function verify(value) {
    if (!value || typeof value !== 'object') return;
    if (value.labelKey) {
      assert.equal(zh[value.labelKey], value.label);
      assert.ok(en[value.labelKey]);
      references++;
    }
    for (const [option, key] of Object.entries(value.optionLabelKeys || {})) {
      assert.equal(zh[key], value.optionLabels[option]);
      assert.ok(en[key]);
      references++;
    }
    for (const entry of Object.values(value)) verify(entry);
  }
  models.forEach(verify);
  assert.ok(references > 0);
  const english = await createRendererEnv({ storage: new Map([['shotloom:locale', 'en-US']]) });
  try {
    const { modelCatalog } = await english.load('domain/catalog/ModelCatalog');
    const { catalogLabel } = await english.load('i18n/index');
    assert.equal(catalogLabel('Custom label', 'unregistered.user.key'), 'Custom label');
    for (const model of models) {
      for (const mode of model.modes) {
        const runtime = modelCatalog.getModeConfig(model.id, mode.id);
        assert.deepEqual(runtime.requestTemplate, mode.requestTemplate);
        assert.deepEqual(runtime.endpoint, mode.endpoint);
        const displayed = modelCatalog.getModelModes(model.id).find(item => item.id === mode.id);
        assert.equal(displayed.label, mode.labelKey ? en[mode.labelKey] : mode.label);
        const schema = modelCatalog.getModelSchema(model.type, model.id, mode.id);
        for (const param of mode.params || []) {
          const presented = schema.params.find(item => item.key === param.key);
          assert.equal(presented.label, param.labelKey ? en[param.labelKey] : param.label || param.key);
          assert.deepEqual(presented.default, param.default);
          assert.deepEqual(presented.options, (param.options || []).map(value => value && typeof value === 'object' ? value.value : value));
          for (const [option, key] of Object.entries(param.optionLabelKeys || {})) assert.equal(presented.optionLabels[option], en[key]);
        }
      }
    }
  } finally { await english.dispose(); }
});

test('英文任务状态改变标签但保持状态值与颜色语义', async () => {
  const english = await createRendererEnv({ storage: new Map([['shotloom:locale', 'en-US']]) });
  try {
    const zh = await env.load('domain/tasks/TaskStatus');
    const en = await english.load('domain/tasks/TaskStatus');
    assert.deepEqual(en.TaskStatus, zh.TaskStatus);
    assert.equal(en.statusLabel('running'), 'Running');
    assert.equal(en.statusLabel('cancelled'), 'Canceled');
    assert.equal(en.statusLabel('provider-custom-status'), 'provider-custom-status');
    for (const value of Object.values(en.TaskStatus)) {
      assert.equal(en.statusTone(value), zh.statusTone(value));
      assert.equal(en.isActiveTaskStatus(value), zh.isActiveTaskStatus(value));
      assert.equal(en.isTerminalTaskStatus(value), zh.isTerminalTaskStatus(value));
    }
  } finally { await english.dispose(); }
});

test('原生错误仅翻译显式信封，未知错误与原始详情不按文字猜测', async () => {
  const { localizeNativeError } = await env.load('i18n/index');
  const error = {
    type: 'shotloom:localized-error', key: 'native.settings.versionUnsupported',
    params: { expected: 7, actual: 6 }, fallback: 'legacy settings error',
  };
  assert.equal(localizeNativeError(JSON.stringify(error), 'en-US'), 'Unsupported settings version: expected v7, found v6');
  assert.equal(localizeNativeError(error, 'zh-CN'), '设置数据版本不受支持：需要 v7，实际为 v6');
  assert.equal(localizeNativeError({ ...error, key: 'future.key' }, 'en-US'), error.fallback);
  assert.equal(localizeNativeError({ ...error, params: {} }, 'en-US'), error.fallback);
  assert.equal(localizeNativeError('设置数据缺少 storageVersion', 'en-US'), undefined);
  assert.equal(localizeNativeError('{"message":"upstream failure"}', 'en-US'), undefined);
  assert.equal(localizeNativeError(new Error('upstream failure'), 'en-US'), undefined);
  const detail = 'raw {expected} $& 错误';
  assert.equal(localizeNativeError({ ...error, key: 'native.file.openFailed', params: { detail } }, 'en-US'), `Unable to open path: ${detail}`);
});

test('已接入原生错误的文案键与具名参数在双语字典中完整登记', async () => {
  const { default: zh } = await env.load('i18n/locales/zh-CN.json');
  const { default: en } = await env.load('i18n/locales/en-US.json');
  let count = 0;
  const files = ['file', 'project', 'settings', 'media_paths', 'media_probe', 'media_tool', 'media_tasks', 'video_export', 'clipboard', 'recent', 'audio', 'video_frame', 'video_concat', 'openreel_export', 'image', 'generation_gateway', 'harness_runtime', 'harness_session'].map(name => `commands/${name}.rs`);
  files.push('database/mod.rs', 'crud/catalog_crud.rs', 'crud/project_crud.rs', 'crud/settings_crud.rs', 'crud/recent_crud.rs', 'services/storage_service.rs');
  for (const file of files) {
    const source = readSource(`src-tauri/src/${file}`);
    for (const match of source.matchAll(/localized_error\(\s*"([^"]+)",\s*json!\(\{([^}]*?)\}\)/g)) {
      const [, key, fields] = match;
      assert.ok(zh[key], key);
      assert.ok(en[key], key);
      const params = new Set([...fields.matchAll(/"([^"]+)"\s*:/g)].map(item => item[1]));
      for (const token of zh[key].matchAll(/\{([^{}]+)\}/g)) assert.ok(params.has(token[1]), `${key}: ${token[1]}`);
      count++;
    }
  }
  assert.ok(count > 0);
});


test('媒体导出错误在英文中保留文件标识与原始错误详情', async () => {
  const { localizeNativeError } = await env.load('i18n/index.ts');
  const envelope = (key, params) => ({ type: 'shotloom:localized-error', key, params, fallback: '回退提示' });
  const path = '/素材/镜头 {id}.mp4';
  assert.equal(localizeNativeError(envelope('native.error.34d30a8aea', { id: 'asset-1', path }), 'en-US'),
    `The video media has not been saved or its file does not exist: asset-1 (${path})`);
  const detail = 'ffmpeg: Invalid data {detail} $&';
  assert.equal(localizeNativeError(envelope('native.error.700ffa2075', { error: detail }), 'en-US'),
    `Unable to start media inspection: ${detail}`);
  assert.equal(localizeNativeError(envelope('native.error.34d30a8aea', { id: 'asset-1' }), 'en-US'), '回退提示');
});

test('英文模式下浏览器功能限制与剪辑快照错误使用字典', async () => {
  const english = await createRendererEnv({ storage: new Map([['shotloom:locale', 'en-US']]) });
  try {
    const { desktopApi } = await english.load('services/desktopApi');
    const result = await desktopApi.project.exportPackage('/project');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Project package export is unavailable in browser preview.');
    const { readNativeSnapshot } = await english.load('services/clipSnapshotStore');
    desktopApi.project.getEditorSnapshot = async () => null;
    await assert.rejects(readNativeSnapshot('/project', 'missing-node', true), {
      message: 'The editing project snapshot is missing. Check the project database.',
    });
    const requestViewportCapture = async () => { throw new Error('Viewport capture is not ready yet.'); };
    await assert.rejects(() => requestViewportCapture({ preset: 'current', source: 'camera-panel' }), {
      message: 'Viewport capture is not ready yet.',
    });
  } finally { await english.dispose(); }
});

test('英文模型失败提示保留 HTTP 状态、token 用量及厂商原始错误', async () => {
  const english = await createRendererEnv({ storage: new Map([['shotloom:locale', 'en-US']]) });
  try {
    const { modelResponseError } = await english.load('utils/modelResponseParsing');
    assert.equal(modelResponseError({}, 503), 'The upstream model gateway is temporarily unavailable (HTTP 503). Please retry later.');
    assert.equal(modelResponseError({}, 429), 'Too many model requests (HTTP 429). Please retry later.');
    assert.equal(modelResponseError({ error: { message: 'upstream 原始错误 {status}' } }, 503), 'upstream 原始错误 {status}');
    const { generationOutputIssue } = await english.load('utils/generationResultValidation');
    const issue = generationOutputIssue('textGeneration', { raw: {
      choices: [{ finish_reason: 'length' }],
      usage: { completion_tokens: 800, completion_tokens_details: { reasoning_tokens: 720 } },
    } });
    assert.equal(issue.code, 'empty-text-length');
    assert.match(issue.message, /Reasoning used 720\/800 tokens/);
    assert.equal(generationOutputIssue('textGeneration', {}, { text: '实际正文' }), null);
    const { inferEditorMediaType } = await english.load('utils/editorMediaImport');
    assert.throws(() => inferEditorMediaType('/素材/actual.exe'), { message: 'Unsupported editing media format: /素材/actual.exe' });
    const { WATERMARK_FONT_OPTIONS, WATERMARK_WEIGHT_OPTIONS } = await english.load('utils/watermarkRender');
    const chineseSans = WATERMARK_FONT_OPTIONS.find(item => item.value.includes('PingFang SC'));
    assert.equal(chineseSans.label, 'PingFang / Microsoft YaHei');
    assert.equal(chineseSans.value, "'PingFang SC', 'Microsoft YaHei', sans-serif");
    assert.equal(WATERMARK_WEIGHT_OPTIONS.find(item => item.value === 600).label, 'Semibold');
  } finally { await english.dispose(); }
});

test('素材分类与生成输入提示随语言变化，分类标识与模型输入保持一致', async () => {
  const snapshots = [];
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const { assetCategories } = await instance.load('domain/asset/assetCategories');
      assert.deepEqual(assetCategories.map(item => item.id), ['characters', 'scenes', 'props', 'shots', 'voice', 'music', 'soundEffects', 'other']);
      assert.equal(assetCategories.find(item => item.id === 'props').label, locale === 'en-US' ? 'Prop' : '道具');
      const { generationUpstreamReadiness, buildGenerationPayload } = await instance.load('domain/graph/generationPayload');
      const source = { id: 'source', type: 'imageGeneration', title: '用户原始名称 {value0}', status: 'idle' };
      const target = { id: 'target', type: 'imageGeneration', title: '目标', model: 'gpt-image-2.5-sunburst', prompt: '用户提示词', config: {} };
      const project = { nodes: [source, target], edges: [{ id: 'edge', source: 'source', target: 'target', data: { inputRole: 'referenceImage' } }], tasks: [], materials: [] };
      const blocked = generationUpstreamReadiness(target, project);
      assert.equal(blocked.ready, false);
      assert.ok(blocked.issues.includes(locale === 'en-US'
        ? '用户原始名称 {value0} is not finished and cannot be used as a referenceImage input.'
        : '用户原始名称 {value0} 尚未完成，不能作为 referenceImage 输入'));
      source.uploadedFile = { name: 'reference.png', path: '/project/assets/reference.png', type: 'image/png', resourceType: 'image' };
      assert.deepEqual(generationUpstreamReadiness(target, project).issues, []);
      snapshots.push(buildGenerationPayload(target, project).modelInputs);
    } finally { await instance.dispose(); }
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
});

test('模型网关的普通 IPC 和流式错误事件均翻译显式信封，保留上游详情', async () => {
  const instance = await createRendererEnv({ withWindow: true, storage: new Map([['shotloom:locale', 'en-US']]) });
  try {
    const { default: zh } = await instance.load('i18n/locales/zh-CN.json');
    const key = Object.keys(zh).find(key => zh[key] === '模型网络请求失败：{error}');
    const rawDetail = 'socket closed {error} 原始详情';
    let failure = JSON.stringify({ type: 'shotloom:localized-error', key, params: { error: rawDetail }, fallback: 'fallback' });
    let callback;
    let unlistened = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => { unlistened++; } };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: handler => { callback = handler; return 1; },
      invoke: async (command, args) => {
        if (command === 'plugin:event|listen') return 1;
        if (command === 'plugin:event|unlisten') return;
        if (command === 'generation_request') throw failure;
        if (command === 'generation_stream') {
          callback({ payload: { requestId: args.request.requestId, error: failure, done: true } });
          return { status: 200, body: '{}', contentType: 'text/event-stream' };
        }
        throw new Error(`Unexpected test command: ${command}`);
      },
    };
    const { createTauriApi } = await instance.load('services/tauriApi');
    const api = createTauriApi({});
    const expected = `The model network request failed: ${rawDetail}`;
    await assert.rejects(api.model.chatCompletion({}), { message: expected });
    await assert.rejects(api.model.chatCompletionStream({}), { message: expected });
    assert.equal(unlistened, 1);
    failure = 'upstream failure {error}';
    await assert.rejects(api.model.chatCompletionStream({}), { message: failure });
    assert.equal(unlistened, 2);
  } finally { await instance.dispose(); }
});

test('英文状态提示覆盖更新重试、画布错误与执行评估，不改变状态和回执标识', async () => {
  const instance = await createRendererEnv({ withWindow: true, storage: new Map([['shotloom:locale', 'en-US']]) });
  try {
    const { desktopApi } = await instance.load('services/desktopApi');
    const { checkForUpdate, updateStore } = await instance.load('store/updateStore');
    desktopApi.update.check = async () => ({ info: null, error: 'upstream detail' });
    await checkForUpdate();
    assert.equal(updateStore.phase, 'idle');
    assert.equal(updateStore.retryCount, 1);
    assert.equal(updateStore.error, 'Retrying in 2 seconds: Failed to check for updates. Please retry later.');
    desktopApi.update.check = async () => ({ info: null });
    await checkForUpdate({ openWhenNone: true });
    assert.equal(updateStore.notice, 'You are up to date');
    assert.equal(updateStore.retryCount, 0);
    const { canConnectCanvasNodes } = await instance.load('store/canvasGraphStore');
    assert.equal(canConnectCanvasNodes({ nodes: [], edges: [] }, 'missing', 'missing').error, 'A node cannot connect to itself.');
    const { evaluateGenerationTask } = await instance.load('store/agentEvaluationStore');
    const receipt = evaluateGenerationTask({ project: {}, node: { id: 'node', type: 'imageGeneration', title: '用户名称' }, task: { id: 'task', nodeId: 'node', status: 'completed', result: { archivedFiles: [{ filePath: '/真实/file.png' }] } } });
    assert.equal(receipt.taskId, 'task');
    assert.deepEqual(receipt.checks.map(item => item.id), ['task-completed', 'has-output', 'archive-valid']);
    assert.ok(receipt.checks.every(item => item.passed));
    assert.equal(receipt.summary, 'Generation completed. The result is archived and available in the original generation node.');
  } finally { await instance.dispose(); }
});

test('Agent 启动的直接 IPC 与状态错误均使用界面语言，未登记错误保持原值', async () => {
  const instance = await createRendererEnv({ withWindow: true, storage: new Map([['shotloom:locale', 'en-US']]) });
  try {
    const detail = 'spawn /用户/Agent {error}: ENOENT';
    const envelope = JSON.stringify({ type: 'shotloom:localized-error', key: 'native.harness.startFailed', params: { error: detail }, fallback: '启动失败' });
    let mode = 'reject';
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async command => {
        if (command === 'plugin:event|listen') return 1;
        if (command === 'start_harness_runtime') {
          if (mode === 'reject') throw envelope;
          if (mode === 'status') return { running: false, error: envelope };
          throw '厂商返回原始错误 {error}';
        }
        throw new Error(`Unexpected test command: ${command}`);
      },
    };
    const { desktopApi } = await instance.load('services/desktopApi');
    desktopApi.platform = 'macos';
    const { startHarnessIntegration } = await instance.load('app/agent-session/harnessIntegration');
    await assert.rejects(startHarnessIntegration(), { message: `Failed to start DeepSeek Harness: ${detail}` });
    mode = 'status';
    await assert.rejects(startHarnessIntegration(), { message: `Failed to start DeepSeek Harness: ${detail}` });
    mode = 'raw';
    await assert.rejects(startHarnessIntegration(), error => error === '厂商返回原始错误 {error}');
  } finally { await instance.dispose(); }
});

test('引用选择、媒体预览、快照校验和任务查询的产品提示使用英文，上游详情保持原文', async () => {
  const instance = await createRendererEnv({ withWindow: true, storage: new Map([['shotloom:locale', 'en-US']]) });
  try {
    const { readHarnessCanvasReference } = await instance.load('services/harnessProductTools');
    await assert.rejects(readHarnessCanvasReference('expired-session'), { message: 'This session cannot reference the canvas.' });
    const { assertNativeSnapshot } = await instance.load('domain/editor/NativeSnapshot');
    assert.throws(() => assertNativeSnapshot({}), { message: 'The editing project snapshot is invalid. Restore the file and retry. The original project was not overwritten.' });
    const { desktopApi } = await instance.load('services/desktopApi');
    desktopApi.file.readArrayBuffer = async () => undefined;
    const { acquireMediaPreview } = await instance.load('services/mediaPreviewCache');
    await assert.rejects(acquireMediaPreview({ kind: 'video', path: '/missing.mp4' }), { message: 'Unable to read the media preview.' });
    const { runningHubTaskState } = await instance.load('utils/runningHubWorkflow');
    assert.equal(runningHubTaskState({ code: 503 }).error, 'Failed to query the task.');
    assert.equal(runningHubTaskState({ code: 503, msg: '上游原始错误 {id}' }).error, '上游原始错误 {id}');
  } finally { await instance.dispose(); }
});

test('通用设置的 General 与共享素材的 Shared 按语境区分', async () => {
  const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', 'en-US']]) });
  try {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SettingsPanel } = await instance.load('app/views/SettingsPanel.tsx');
    const markup = renderToStaticMarkup(createElement(SettingsPanel, {
      data: { locale: 'en-US', projectRootDir: '/projects', downloadDir: '', pollInterval: 1500,
        projectModels: {}, agentModels: {}, availableModels: {}, agentToggles: {},
        providers: [], skills: [], shortcutLabels: {} }, controller: {},
    }));
    assert.match(markup, />General</);
    assert.doesNotMatch(markup, />Shared</);
    const { t } = await instance.load('i18n/index');
    assert.equal(t('ui.resourceLibraryAdapter.text.1a0fdce8'), 'Shared');
  } finally { await instance.dispose(); }
});

test('日期和条目数量采用所选语言，媒体缓存失败不改变预算和资源状态', async () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const { formatTime, formatItemCount } = await instance.load('utils/format');
      const date = new Date('2026-11-02T15:04:00Z');
      assert.equal(formatTime(date), date.toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
      assert.equal(formatTime('invalid'), '-');
      assert.equal(formatTime(undefined), '-');
      assert.equal(date.toISOString(), '2026-11-02T15:04:00.000Z');
      assert.deepEqual([0, 1, 2].map(formatItemCount), locale === 'en-US' ? ['0 items', '1 item', '2 items'] : ['0 个条目', '1 个条目', '2 个条目']);
      const { BoundedMediaCache } = await instance.load('services/boundedMediaCache');
      let created = 0;
      const cache = new BoundedMediaCache({ maxEntryBytes: 4, createUrl: () => { created++; return 'blob:test'; } });
      await assert.rejects(cache.acquire('', { kind: 'image', load: async () => ({}) }), {
        message: locale === 'en-US' ? 'Media cache key is required' : '缺少媒体缓存标识',
      });
      await assert.rejects(cache.acquire('empty', { kind: 'image', load: async () => ({ buffer: new ArrayBuffer(0) }) }), {
        message: locale === 'en-US' ? 'Media preview is empty' : '媒体预览为空',
      });
      await assert.rejects(cache.acquire('oversized', { kind: 'video', load: async () => ({ buffer: new ArrayBuffer(3), costBytes: 5 }) }), {
        message: locale === 'en-US' ? 'Media preview exceeds cache entry budget (5/4)' : '媒体预览超过单项缓存预算（5/4）',
      });
      assert.equal(created, 0);
      assert.equal(cache.diagnostics().entries, 0);
      assert.equal(cache.diagnostics().rejectedOversize, 1);
    } finally { await instance.dispose(); }
  }
});

test('模型参数摘要使用稳定键，翻译标签不会改变参数语义或配置', async () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const { paramSummary } = await instance.load('utils/modelPresentation');
      const withAudio = { key: 'generateAudio', type: 'boolean', label: '自定义声音标题 {id}', default: false };
      const watermark = { key: 'watermark', type: 'boolean', label: 'Custom label', default: true };
      const snapshot = JSON.stringify([withAudio, watermark]);
      assert.equal(paramSummary(withAudio, true), locale === 'en-US' ? 'With audio' : '有声');
      assert.equal(paramSummary(withAudio, false), locale === 'en-US' ? 'Silent' : '无声');
      assert.equal(paramSummary(watermark, true), locale === 'en-US' ? 'Watermark' : '水印');
      assert.equal(paramSummary(watermark, false), locale === 'en-US' ? 'No watermark' : '无水印');
      assert.equal(JSON.stringify([withAudio, watermark]), snapshot);
      assert.equal(paramSummary({ key: 'custom', type: 'boolean', label: '声音 水印 Audio' }, true), '声音 水印 Audio');
      assert.equal(paramSummary({ key: 'volume', type: 'number', label: 'Volume', presentation: { control: 'slider' } }, 1.5), 'Volume 1.5');
      const { t } = await instance.load('i18n/index');
      assert.equal(t('editor.media.selectionCount', { count: 1, max: 20 }), locale === 'en-US' ? 'Selected: 1 / 20' : '已选：1 / 20 项');
      assert.equal(t('common.selectedCount.one', { count: 1 }), locale === 'en-US' ? '1 item selected' : '已选 1 项');
      assert.equal(t('common.selectedCount.other', { count: 2 }), locale === 'en-US' ? '2 items selected' : '已选 2 项');
      assert.equal(t('editor.media.addFailures.one', { count: 1 }), locale === 'en-US'
        ? '1 item was not added. Confirm to retry only the current selection.' : '1 项未添加，确认后仅重试当前选择');
    } finally { await instance.dispose(); }
  }
});

test('新剪辑默认名和未命名文件采用当前语言，保存内容、空正文与时间轴保持原值', async () => {
  const protocols = [];
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const editor = await instance.load('utils/videoEditorProject');
      let id = 0;
      const createId = prefix => `${prefix}-${++id}`;
      const project = editor.createVideoEditorProject({ sourceFile: '/工程/用户素材.mp4', sourceName: '用户素材 {name}', duration: 5, createId });
      assert.deepEqual(project.tracks.map(track => track.name), locale === 'en-US' ? ['Main video', 'Music & sound'] : ['主画面', '音乐与音效']);
      protocols.push({ settings: project.settings, assets: project.assets, tracks: project.tracks.map(({ name, ...track }) => track) });
      project.tracks[0].name = '已保存的中文轨道';
      project.tracks.push({ id: 'text', type: 'text', name: '用户字幕轨道', clips: [
        { id: 'existing', type: 'text', timelineStart: 0, duration: 1, text: '已有正文 {name}' },
        { id: 'empty', type: 'text', timelineStart: 1, duration: 1, text: '' },
        { id: 'new', type: 'text', timelineStart: 2, duration: 1 },
      ] });
      const before = structuredClone(project);
      const normalized = editor.normalizeVideoEditorProject(project);
      assert.deepEqual(project, before);
      assert.equal(normalized.tracks[0].name, '已保存的中文轨道');
      assert.equal(normalized.assets[0].name, '用户素材 {name}');
      assert.deepEqual(normalized.tracks[2].clips.map(clip => clip.text), ['已有正文 {name}', '', locale === 'en-US' ? 'Text' : '文字']);
      const appended = editor.appendEditorMediaAsset(normalized, { id: 'still', type: 'image', sourceFile: '/工程/图片.png', width: 640, height: 480 }, { createId });
      assert.equal(appended.project.assets.at(-1).name, locale === 'en-US' ? 'Media' : '素材');
      assert.equal(appended.project.tracks.at(-1).name, locale === 'en-US' ? 'Visual media' : '画面素材');
      assert.throws(() => editor.createVideoSegmentProject({ duration: 5 }, { start: 1, end: 8 }), {
        message: locale === 'en-US' ? 'The selected video segment range is invalid.' : '所选视频片段范围无效',
      });
      const { semanticOutputFileName } = await instance.load('utils/generatedOutputNaming');
      assert.equal(semanticOutputFileName('   ', 'mp4', 1, 3), locale === 'en-US' ? 'Generated result-2.mp4' : '生成结果-2.mp4');
      assert.equal(semanticOutputFileName('用户作品 {name}', 'png'), '用户作品 {name}.png');
    } finally { await instance.dispose(); }
  }
  assert.deepEqual(protocols[0], protocols[1]);
});

test('模型目录校验在两种语言中保持相同约束与原始字段值', async () => {
  const counts = [];
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const { catalogModelValidationErrors } = await instance.load('domain/catalog/ModelCatalog');
      const mode = {
        id: '用户模式 {name}', endpoint: { method: 'POST', path: '/generate', scope: 'v1' },
        requestTemplate: {}, resultUrlPath: 'url',
      };
      const model = { id: '用户模型 {value1}', name: '保留中文', provider: 'custom', type: 'imageGeneration', defaultMode: mode.id, modes: [mode] };
      const before = structuredClone(model);
      assert.deepEqual(catalogModelValidationErrors(model, { requireProvider: true }), []);
      mode.endpoint.method = 'GET';
      mode.inputSlots = ['用户槽位 {value0}'];
      mode.isAsync = true;
      mode.taskEndpoint = { path: '//invalid', method: 'DELETE', scope: 'invalid' };
      mode.agent = { transport: 'openai-responses', supportsTools: false, requestOptions: { unsafe: () => {} } };
      const errors = catalogModelValidationErrors(model, { requireProvider: true });
      counts.push(errors.length);
      assert.ok(errors.length > 8);
      assert.ok(errors.some(error => error === (locale === 'en-US'
        ? '用户模型 {value1}/用户模式 {name}: generation endpoint method must be POST, PUT, PATCH, or DELETE'
        : '用户模型 {value1}/用户模式 {name} 的生成 endpoint method 必须是 POST、PUT、PATCH 或 DELETE')));
      assert.ok(errors.some(error => error.includes('用户槽位 {value0}')));
      assert.ok(errors.some(error => error.includes('agent.requestOptions')));
      assert.equal(model.id, before.id);
      assert.equal(model.name, before.name);
      assert.equal(mode.endpoint.method, 'GET');
      assert.deepEqual(catalogModelValidationErrors(null), [locale === 'en-US'
        ? 'The model protocol must be a JSON object' : '模型协议必须是 JSON 对象']);
    } finally { await instance.dispose(); }
  }
  assert.equal(counts[0], counts[1]);
});

test('全部产品工具标题切换语言，工具协议与草稿正文保持一致', async () => {
  const protocols = [];
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      for (const [module, register] of [
        ['canvasTools', 'registerCanvasTools'], ['catalogTools', 'registerCatalogTools'],
        ['productionPlanTools', 'registerProductionPlanTools'], ['videoEditorTools', 'registerVideoEditorTools'],
        ['directorTools', 'registerDirectorTools'],
        ['textTools', 'registerTextDraftTools'],
      ]) (await instance.load(`agent/tools/${module}`))[register]();
      const registry = await instance.load('agent/core/toolRegistry');
      const tools = registry.allAgentTools();
      const { default: dictionary } = await instance.load(`i18n/locales/${locale}.json`);
      const keys = Object.keys(dictionary).filter(key => key.startsWith('tool.title.') && !key.startsWith('tool.title.project_'));
      const productTools = tools.filter(tool => !tool.id.startsWith('openreel_'));
      const nativeTools = tools.filter(tool => tool.id.startsWith('openreel_'));
      const { default: upstream } = await instance.load('config/openreel-agent-tools.json');
      const { default: policy } = await instance.load('config/openreel-agent-policy.json');
      const supported = upstream.filter(tool => !Object.hasOwn(policy.excludedTools, tool.name));
      assert.equal(nativeTools.length, supported.length);
      assert.equal(Object.keys(dictionary).filter(key => key.startsWith('tool.openreel.')).length, supported.length);
      for (const tool of supported) {
        const registered = nativeTools.find(item => item.id === `openreel_${tool.name}`);
        assert.equal(registered.title, dictionary[`tool.openreel.${tool.name}`]);
        if (locale === 'en-US') assert.equal(registered.title, tool.title);
        assert.deepEqual(registered.inputSchema, tool.inputSchema);
      }
      for (const excluded of Object.keys(policy.excludedTools)) {
        assert.equal(nativeTools.some(tool => tool.id === `openreel_${excluded}`), false);
        assert.equal(Object.hasOwn(dictionary, `tool.openreel.${excluded}`), false);
      }
      assert.equal(productTools.length, keys.length);
      for (const tool of productTools) {
        assert.equal(registry.agentToolTitle(tool.id), dictionary[`tool.title.${tool.id}`], tool.id);
      }
      protocols.push(tools.map(({ id, description, inputSchema, effect, approvalRequired }) => ({ id, description, inputSchema, effect, approvalRequired })));
      const write = tools.find(tool => tool.id === 'text_draft_write');
      assert.equal(write.summarizeInput({ mode: 'append' }), locale === 'en-US' ? 'Append to draft' : '追加草稿');
      const { store } = await instance.load('store/projectStore');
      store.project.harnessSessions = [{ id: 'i18n-session', textNodeId: 'i18n-text' }];
      const context = { conversationId: 'i18n-session' };
      let draft = '用户正文 {count}';
      const { registerTextDraftTarget } = await instance.load('services/textDraftBridge');
      const unregister = registerTextDraftTarget({ nodeId: 'i18n-text', read: () => draft,
        apply: (content, mode) => { draft = mode === 'append' ? draft + content : content; return draft; } });
      const result = write.execute({ content: '中文 {added}', mode: 'append' }, context);
      assert.equal(draft, '用户正文 {count}中文 {added}');
      assert.deepEqual(write.summarizeResult(result), { summary: locale === 'en-US'
        ? `Appended characters: 10. Draft length: ${draft.length}.`
        : `已追加 10 字，草稿共 ${draft.length} 字` });
      assert.throws(() => write.execute({ content: '' }, context), { message: dictionary['tool.draft.empty'] });
      unregister();
      assert.throws(() => write.execute({ content: '正文' }, context), { message: dictionary['tool.draft.closed'] });
      store.project.harnessSessions = [];
      assert.throws(() => write.execute({ content: '正文' }, context), { message: dictionary['tool.draft.noNode'] });
    } finally { await instance.dispose(); }
  }
  assert.deepEqual(protocols[0], protocols[1]);
});

test('工具数量摘要使用完整短语和单复数，真实结果为空时不伪造计数', async () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const { formatToolCount } = await instance.load('utils/format');
      for (const [kind, singular, plural] of [
        ['nodes', '1 node', '2 nodes'], ['edges', '1 connection', '2 connections'],
        ['tasks', '1 task', '2 tasks'], ['assets', '1 asset', '2 assets'],
        ['frames', '1 source video frame', '2 source video frames'], ['images', '1 node image', '2 node images'],
      ]) {
        if (locale === 'en-US') {
          assert.equal(formatToolCount(kind, 1), singular);
          assert.equal(formatToolCount(kind, 2), plural);
        } else assert.ok(formatToolCount(kind, 2).startsWith('2 '));
      }
      (await instance.load('agent/tools/canvasTools')).registerCanvasTools();
      (await instance.load('agent/tools/catalogTools')).registerCatalogTools();
      const tools = (await instance.load('agent/core/toolRegistry')).allAgentTools();
      const browse = tools.find(tool => tool.id === 'canvas_list_nodes');
      assert.equal(browse.summarizeResult({ nodes: [], edges: [], tasks: [] }), undefined);
      assert.deepEqual(browse.summarizeResult({ nodes: [{}], edges: [{}, {}], tasks: [{}] }), { summary: locale === 'en-US'
        ? '1 node · 2 connections · 1 task' : '1 个节点 · 2 个连线 · 1 个任务' });
      const assets = tools.find(tool => tool.id === 'inspect_assets');
      assert.ok(assets);
      assert.equal(assets.summarizeResult({ assets: [{}] }).summary, locale === 'en-US' ? '1 asset' : '1 条素材');
      assert.equal(assets.summarizeResult({ assets: [] }).summary, locale === 'en-US' ? 'No matching assets' : '没有匹配的素材');
    } finally { await instance.dispose(); }
  }
});

test('画布连线校验翻译提示但保持输入角色和有效性，导演台自动比例保持原值', async () => {
  const facts = [];
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const { validateAgentInputRole } = await instance.load('services/agentInputRole');
      const { default: dictionary } = await instance.load(`i18n/locales/${locale}.json`);
      const target = { id: 'target', type: 'imageGeneration', title: '用户目标' };
      const cases = [
        [undefined, target, 'link.missingNode'],
        [target, target, 'link.self'],
        [{ id: 'source', type: 'imageGeneration' }, { id: 'target', type: 'group' }, 'link.targetInput'],
        [{ id: 'source', type: 'group' }, target, 'link.noOutput'],
        ...['textGeneration', 'imageGeneration', 'videoGeneration', 'audioGeneration'].map(type => [{ id: 'source', type, title: '用户源 {role}' }, target, null]),
        ...['text/plain', 'image/png', 'video/mp4', 'audio/wav'].map(resourceType => [{ id: 'source', type: 'resource', resourceType }, target, null]),
      ];
      const current = [];
      for (const [source, destination, key] of cases) {
        const project = { nodes: [source, destination].filter(Boolean), edges: [] };
        const before = structuredClone(project);
        const result = validateAgentInputRole(project, source, destination);
        assert.equal(result.valid, !key);
        if (key) assert.equal(result.error, dictionary[key]);
        current.push({ valid: result.valid, role: result.role });
        assert.deepEqual(project, before);
      }
      const aspect = { VIEWPORT_ASPECT_RATIO_OPTIONS: [{ label: locale === 'en-US' ? 'Auto' : '自动', value: 'auto' }, { label: '16:9', value: '16:9' }], getViewportAspectRatioValue: (v) => v === 'auto' ? null : v === '16:9' ? 16 / 9 : null };
      assert.equal(aspect.VIEWPORT_ASPECT_RATIO_OPTIONS[0].label, locale === 'en-US' ? 'Auto' : '自动');
      assert.equal(aspect.getViewportAspectRatioValue('auto'), null);
      assert.equal(aspect.getViewportAspectRatioValue('16:9'), 16 / 9);
      facts.push({ roles: current, ratios: aspect.VIEWPORT_ASPECT_RATIO_OPTIONS.map(({ label, ...option }) => option) });
    } finally { await instance.dispose(); }
  }
  assert.deepEqual(facts[0], facts[1]);
});

test('画布批次局部失败提示随语言变化，成功动作与真实回执不受影响', async () => {
  const outcomes = [];
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]), withWindow: true });
    try {
      const { store } = await instance.load('store/projectStore');
      const { createProject } = await instance.load('store/projectNormalization');
      store.project = createProject('用户工程 {value0}');
      const { getAgentProjectIdentity } = await instance.load('services/agentProjectIdentity');
      const executor = await instance.load('services/agent/agentCanvasExecutor');
      const identity = getAgentProjectIdentity();
      const scope = { projectKey: identity.projectKey, projectInstanceId: identity.instanceId, projectGeneration: identity.generation };
      const empty = await executor.executeAgentActions({ ...scope, actions: [] });
      assert.equal(empty.error, locale === 'en-US' ? 'No canvas actions can be executed' : '没有可执行的画布动作');
      store.project.nodes.push({ id: 'existing', type: 'resource', title: '用户素材 {value1}', x: 0, y: 0 });
      const result = await executor.executeAgentActions({ ...scope, title: '用户操作', actions: [
        { type: 'move_node', nodeId: 'existing', x: 200, y: 150 },
        { type: 'move_node', nodeId: 'missing', x: 100, y: 100 },
      ] });
      assert.equal(result.success, true);
      assert.equal(result.partial, true);
      assert.equal(result.error, locale === 'en-US'
        ? 'Canvas operations skipped: 1. Operations applied: 1.' : '1 个画布操作已跳过，其余 1 个已应用');
      assert.ok(result.actionResults[1].error.includes(locale === 'en-US' ? 'missing or no longer valid' : '不存在或已失效'));
      assert.equal(store.project.nodes[0].title, '用户素材 {value1}');
      outcomes.push({ applied: result.appliedCount, skipped: result.skippedCount, x: store.project.nodes[0].x, y: store.project.nodes[0].y });
    } finally { await instance.dispose(); }
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test('动作参数校验双语一致，字段与用户参数原样进入错误提示', async () => {
  const outcomes = [];
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const { validateAgentActionShape } = await instance.load('services/agent/agentActionValidator');
      const { validateAgentActionContract } = await instance.load('services/agentActionContract');
      const { t } = await instance.load('i18n/index');
      const cases = [
        [null, 'object', {}], [{}, 'typeRequired', {}],
        [{ type: '用户动作 {value0}' }, 'unknown', { value0: '用户动作 {value0}' }],
        [{ type: 'set_artifact_type', nodeId: 'node', artifactType: 'invalid' }, 'artifactType', { value0: 'invalid' }],
        [{ type: 'set_artifact_type' }, 'artifactFields', {}],
        [{ type: 'create_gen_node', nodeType: 'custom' }, 'nodeType', { value0: 'custom' }],
        [{ type: 'create_gen_node', nodeType: 'imageGeneration', config: [] }, 'createConfig', {}],
        [{ type: 'create_gen_node', nodeType: 'imageGeneration' }, 'createPrompt', {}],
        [{ type: 'create_gen_node', nodeType: 'imageGeneration', prompt: '保留正文', config: { prompt: '旧正文' } }, 'createTopLevel', {}],
        [{ type: 'place_asset_on_canvas' }, 'assetFields', {}],
        [{ type: 'update_gen_config', config: [] }, 'updateConfig', {}],
        [{ type: 'update_gen_config', config: { model: '旧模型' } }, 'updateTopLevel', {}],
        [{ type: 'connect_nodes' }, 'connectionFields', { value0: 'connect_nodes' }],
        [{ type: 'delete_edge' }, 'deleteEdge', {}],
        [{ type: 'toggle_edge' }, 'toggleEdge', {}],
        [{ type: 'toggle_edge', edgeId: 'edge', enabled: 1 }, 'enabled', {}],
        [{ type: 'move_node', nodeId: 'node' }, 'position', {}],
      ];
      for (const [action, key, params] of cases) {
        const before = structuredClone(action);
        const result = validateAgentActionShape(action);
        assert.equal(result.valid, false);
        assert.equal(result.error, t(`agent.validation.${key}`, params));
        assert.deepEqual(action, before);
      }
      assert.deepEqual(validateAgentActionShape({ type: 'move_node', nodeId: '用户节点', x: 0, y: 0 }), { valid: true });
      assert.equal(validateAgentActionContract({ type: '用户动作 {value0}' }).error,
        t('agent.validation.unknown', { value0: '用户动作 {value0}' }));
      outcomes.push(cases.map(([action]) => validateAgentActionShape(action).valid));
    } finally { await instance.dispose(); }
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test('生成节点契约与项目排队隔离的错误消息在中英文下保持一致', async () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const { generationNodeConfig } = await instance.load('domain/graph/GenerationNodeContract');
      assert.throws(() => generationNodeConfig({ prompt: '用户正文', model: '模型' }), { message: locale === 'en-US'
        ? 'Generation node config must not contain prompt/model; use top-level fields'
        : '生成节点 config 不得包含 prompt/model，请使用节点顶层字段' });
      const { createAgentProjectQueue, AgentProjectChangedError } = await instance.load('services/agentProjectQueue');
      const { t } = await instance.load('i18n/index');
      let key = 'old-project';
      const queue = createAgentProjectQueue(() => key);
      let executed = false;
      const pending = queue.enqueue(() => { executed = true; });
      key = 'new-project';
      await assert.rejects(pending, error => error instanceof AgentProjectChangedError
        && error.projectKey === 'old-project' && error.message === t('graph.validation.queueProject'));
      assert.equal(executed, false);
      assert.equal(await queue.enqueue(() => 'new-project-result'), 'new-project-result');
    } finally { await instance.dispose(); }
  }
});

test('水印加载和导出失败按语言显示，成功导出的图片数据保持原样', async () => {
  const saved = Object.fromEntries(['Image', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const locale of ['zh-CN', 'en-US']) {
      const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
      try {
        let imageFails = true;
        globalThis.Image = class {
          naturalWidth = 320; naturalHeight = 240;
          set src(value) { this.source = value; queueMicrotask(() => imageFails ? this.onerror() : this.onload()); }
        };
        const { renderWatermarkedBlob, defaultWatermarkSettings } = await instance.load('utils/watermarkRender');
        const settings = { ...defaultWatermarkSettings(), text: '' };
        await assert.rejects(renderWatermarkedBlob('/用户图片 {name}.png', settings), { message: locale === 'en-US'
          ? 'Failed to load the watermark source image' : '水印底图加载失败' });
        imageFails = false;
        let output = null;
        let drawing;
        globalThis.document = { createElement: type => {
          assert.equal(type, 'canvas');
          const canvas = { getContext: () => ({ drawImage: (image, x, y, w, h) => { drawing = { source: image.source, x, y, w, h }; } }),
            toBlob: (callback, mime) => { assert.equal(mime, 'image/png'); callback(output); } };
          return canvas;
        } };
        await assert.rejects(renderWatermarkedBlob('/用户图片 {name}.png', settings), { message: locale === 'en-US'
          ? 'Failed to export the watermarked image' : '水印结果导出失败' });
        output = new Blob(['image-bytes'], { type: 'image/png' });
        assert.equal(await renderWatermarkedBlob('/用户图片 {name}.png', settings), output);
        assert.deepEqual(drawing, { source: '/用户图片 {name}.png', x: 0, y: 0, w: 320, h: 240 });
      } finally { await instance.dispose(); }
    }
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('未知产品会话在两种语言下均拒绝执行，错误不泄露绑定内容', async () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const { executeProductRequest } = await instance.load('services/harnessProductTools');
      await assert.rejects(executeProductRequest({ requestId: 'test', binding: { sessionId: 'untrusted-session' }, toolName: 'project_save', input: {} }), {
        message: locale === 'en-US' ? 'Unknown product session binding' : '未知的产品会话绑定，请重新连接 Agent',
      });
      const executor = await instance.load('services/agent/agentCanvasExecutor');
      assert.deepEqual(await executor.executeAgentGetBatch({ batchId: 'missing' }), {
        success: false, error: locale === 'en-US' ? 'Batch not found' : '批次不存在',
      });
      assert.deepEqual(await executor.executeAgentGetEvaluation({ evaluationId: 'missing' }), {
        success: false, error: locale === 'en-US' ? 'Evaluation not found' : '评估记录不存在',
      });
    } finally { await instance.dispose(); }
  }
});

test('技能分配角色和厂商图标名称随语言变化，执行身份、技能归属与图标资源保持一致', async () => {
  const snapshots = [];
  const labels = {
    'zh-CN': { agents: ['画布 Agent', '剪辑 Agent', '3D 导演台 Agent', '文本 Agent'], icons: ['火山引擎', '豆包', '通义千问', '智谱 AI', '自定义'] },
    'en-US': { agents: ['Canvas Agent', 'Editing Agent', '3D Director Agent', 'Text Agent'], icons: ['Volcengine', 'Doubao', 'Qwen', 'Zhipu AI', 'Custom'] },
  };
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const definitions = await instance.load('agent/agents/definitions');
      const assignments = await instance.load('agent/core/skillAssignments');
      const icons = await instance.load('domain/provider/ProviderBrandIcons');
      assert.deepEqual(assignments.configurableSkillAgents.map(agent => agent.label), labels[locale].agents);
      assert.deepEqual(definitions.AGENT_IDS.map(id => definitions.agentTitle(id)), labels[locale].agents);
      const chosenIcons = ['volcengine', 'doubao', 'qwen', 'zhipu', 'custom'].map(id => icons.PROVIDER_ICON_OPTIONS.find(icon => icon.id === id));
      assert.deepEqual(chosenIcons.map(icon => icon.label), labels[locale].icons);
      assert.deepEqual(assignments.skillAgentLabels('user-skill', ['editor-primary']), [labels[locale].agents[1]]);
      assert.deepEqual(assignments.skillAgentLabels('user-skill', ['text-primary']), [labels[locale].agents[3]]);
      assert.deepEqual(assignments.skillAgentLabels('user-skill'), [labels[locale].agents[0]]);
      const unknownId = 'unregistered-{id}';
      assert.throws(() => definitions.agentDefinition(unknownId), {
        message: locale === 'en-US'
          ? `Unknown Agent: ${unknownId}. Declare the Agent in agents/definitions.ts first.`
          : `未知的 Agent：${unknownId}。Agent 必须先在 agents/definitions.ts 中声明`,
      });
      assert.equal(definitions.agentTitle(unknownId), '');
      snapshots.push({
        agents: definitions.AGENT_DEFINITIONS.map(({ title, ...identity }) => identity),
        assignments: assignments.configurableSkillAgents.map(agent => agent.id),
        icons: icons.PROVIDER_ICON_OPTIONS.map(({ label, ...resource }) => resource),
      });
    } finally { await instance.dispose(); }
  }
  assert.deepEqual(snapshots[1], snapshots[0]);
});

test('内置 Skill 用途说明完整双语展示，用户修改、技能正文与导出数据保持原值', async () => {
  const snapshots = [];
  for (const locale of ['zh-CN', 'en-US']) {
    const instance = await createRendererEnv({ storage: new Map([['shotloom:locale', locale]]) });
    try {
      const { builtInSkills, skillDisplayDescription, skillDisplayCategory, withBuiltInSkills, withoutBuiltInSkills } = await instance.load('services/builtInSkills');
      const { default: zh } = await instance.load('i18n/locales/zh-CN.json');
      const { default: en } = await instance.load('i18n/locales/en-US.json');
      assert.ok(builtInSkills.length > 0);
      for (const skill of builtInSkills) {
        const before = JSON.stringify(skill);
        const key = `skill.description.${skill.id}`;
        assert.equal(zh[key], skill.description, key);
        assert.ok(en[key]?.trim(), key);
        assert.doesNotMatch(en[key], /\p{Script=Han}/u, key);
        assert.equal(skillDisplayDescription(skill), locale === 'en-US' ? en[key] : skill.description);
        assert.equal(skillDisplayDescription({ ...skill, description: '用户的说明 {id} $&' }), '用户的说明 {id} $&');
        assert.equal(skillDisplayDescription({ ...skill, builtIn: false }), skill.description);
        const category = skillDisplayCategory(skill);
        assert.ok(category.trim());
        if (locale === 'en-US') assert.doesNotMatch(category, /\p{Script=Han}/u, skill.category);
        assert.equal(skillDisplayCategory({ ...skill, builtIn: false }), skill.category);
        assert.equal(skillDisplayCategory({ ...skill, category: '自定义分类 {id}' }), '自定义分类 {id}');
        assert.equal(JSON.stringify(skill), before);
      }
      const { t } = await instance.load('i18n/index');
      assert.equal(t('skill.summary.one', { count: 1, enabled: 0 }), locale === 'en-US' ? '1 skill · 0 enabled' : '1 个技能 · 0 个已启用');
      assert.equal(t('skill.summary.other', { count: 76, enabled: 17 }), locale === 'en-US' ? '76 skills · 17 enabled' : '76 个技能 · 17 个已启用');
      assert.equal(skillDisplayCategory({ id: 'custom', builtIn: true, category: '自定义分类' }), '自定义分类');
      assert.equal(skillDisplayDescription({ id: 'custom', builtIn: true, description: '自定义用途' }), '自定义用途');
      const customized = { ...builtInSkills[0], description: '用户修改的用途', instructions: '# 用户正文 {name}' };
      const catalog = withBuiltInSkills({ skills: [customized] });
      const saved = withoutBuiltInSkills(catalog);
      assert.equal(saved.skills.find(skill => skill.id === customized.id).description, customized.description);
      assert.equal(saved.skills.find(skill => skill.id === customized.id).instructions, customized.instructions);
      snapshots.push({ builtInSkills, saved });
    } finally { await instance.dispose(); }
  }
  assert.deepEqual(snapshots[1], snapshots[0]);
});
