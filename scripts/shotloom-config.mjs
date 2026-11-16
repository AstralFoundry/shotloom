import { readFileSync } from 'node:fs';
import { defaultPluginConnections } from './provider-distribution.mjs';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const configPath = join(rootDir, 'shotloom.yml');

export function readShotloomConfig(path = configPath) {
  const document = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true });
  if (document.errors.length) {
    throw new Error(`${path}: ${document.errors.map(error => error.message).join('; ')}`);
  }
  const config = document.toJS();
  if (config?.version !== 1) throw new Error(`${path}: version must be 1`);
  const webHost = config?.development?.webHost;
  if (webHost !== '127.0.0.1' && webHost !== 'localhost') {
    throw new Error(`${path}: development.webHost must be 127.0.0.1 or localhost`);
  }
  const webPort = config?.development?.webPort;
  if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
    throw new Error(`${path}: development.webPort must be an integer from 1 to 65535`);
  }
  const openBrowser = config?.development?.openBrowser;
  const verbose = config?.development?.verbose;
  if (typeof openBrowser !== 'boolean' || typeof verbose !== 'boolean') {
    throw new Error(`${path}: development.openBrowser and development.verbose must be booleans`);
  }
  const window = config?.desktop?.mainWindow;
  if (typeof window?.title !== 'string' || !window.title.trim()) {
    throw new Error(`${path}: desktop.mainWindow.title must be a non-empty string`);
  }
  for (const field of ['width', 'height', 'minWidth', 'minHeight']) {
    if (!Number.isInteger(window[field]) || window[field] < 1) {
      throw new Error(`${path}: desktop.mainWindow.${field} must be a positive integer`);
    }
  }
  if (window.width < window.minWidth || window.height < window.minHeight) {
    throw new Error(`${path}: desktop.mainWindow size must be at least its minimum size`);
  }
  const defaults = config?.defaults;
  const modelTypes = { text: 'textGeneration', image: 'imageGeneration', video: 'videoGeneration' };
  const catalog = defaultPluginConnections().flatMap(connection => connection.models || []);
  const models = {};
  for (const [kind, type] of Object.entries(modelTypes)) {
    const id = defaults?.models?.[kind];
    if (!catalog.some(model => model.id === id && model.type === type && model.enabled !== false)) {
      throw new Error(`${path}: defaults.models.${kind} must name an enabled ${type} model in the catalog`);
    }
    models[kind] = id;
  }
  for (const field of ['autoSave']) {
    if (typeof defaults?.project?.[field] !== 'boolean') throw new Error(`${path}: defaults.project.${field} must be a boolean`);
  }
  for (const field of ['autoEval', 'autoLayout']) {
    if (typeof defaults?.agent?.[field] !== 'boolean') throw new Error(`${path}: defaults.agent.${field} must be a boolean`);
  }
  const layoutAlgorithm = defaults?.canvas?.layoutAlgorithm;
  if (layoutAlgorithm !== 'grid-aligned' && layoutAlgorithm !== 'elk-layered') {
    throw new Error(`${path}: defaults.canvas.layoutAlgorithm must be grid-aligned or elk-layered`);
  }
  const pollIntervalMs = defaults?.generation?.pollIntervalMs;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 500) {
    throw new Error(`${path}: defaults.generation.pollIntervalMs must be an integer of at least 500`);
  }
  const runtimeProtection = {};
  for (const field of ['healthIntervalMs', 'failureThreshold', 'failureWindowMs', 'circuitCooldownMs', 'stallWarningMs', 'hardCapMs']) {
    const value = defaults?.runtimeProtection?.[field];
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${path}: defaults.runtimeProtection.${field} must be a positive integer`);
    }
    runtimeProtection[field] = value;
  }
  return {
    development: { webHost, webPort, openBrowser, verbose },
    desktop: { mainWindow: {
      title: window.title,
      width: window.width, height: window.height,
      minWidth: window.minWidth, minHeight: window.minHeight,
    } },
    defaults: {
      models,
      project: { autoSave: defaults.project.autoSave },
      agent: { autoEval: defaults.agent.autoEval, autoLayout: defaults.agent.autoLayout },
      canvas: { layoutAlgorithm },
      generation: { pollIntervalMs },
      runtimeProtection,
    },
  };
}
