import { readSource } from './sourceContract.mjs';
import { readDefaultPluginPackages, readPluginPackage, defaultPluginConnections } from '../../scripts/provider-distribution.mjs';
import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';

export function loadTestPluginPackages({ includeStarrouter = false } = {}) {
  return [...readDefaultPluginPackages(), ...(includeStarrouter ? [readPluginPackage('plugin-packages/vendor.starrouter')] : [])];
}
export function loadDefaultPluginSnapshot(options) {
  const packages = loadTestPluginPackages(options);
  return { plugins: packages.map(({ manifest, files }) => ({ manifest, enabled: true, digest: createHash('sha256').update(zipSync(files, { level: 6, mtime: new Date('2020-01-01T00:00:00Z') })).digest('hex'), source: `distribution:${manifest.id}@${manifest.version}`, trustedCode: !!manifest.runtime, installedAt: '', history: [] })), connections: defaultPluginConnections(packages), registryUrl: '' };
}
export function loadModelCatalog(options) {
  const packages = loadTestPluginPackages(options);
  const models = defaultPluginConnections(packages).flatMap(connection => connection.models.map(model => {
    const manifest = packages.find(item => item.manifest.id === (model.protocolPlugin || connection.pluginId)).manifest;
    return { ...model, provider: connection.id, modes: Object.entries(model.protocolModes).map(([id, operation]) => ({ ...manifest.protocols.find(item => item.id === operation).mode, ...model.modes?.find(mode => mode.id === id), protocolParams: manifest.protocols.find(item => item.id === operation).mode.params, id })) };
  }));
  return { providers: [...new Set(models.map(model => model.provider))], modelOrder: models.map(model => model.id), models };
}
/** Frozen migration evidence, never shipped as a runtime catalog. */
export function loadLegacyModelCatalog() {
  const manifest = JSON.parse(readSource('tests/fixtures/legacy-model-catalog/index.json'));
  const models = manifest.providers.flatMap(provider => JSON.parse(readSource(`tests/fixtures/legacy-model-catalog/providers/${provider}.json`)).models);
  return { ...manifest, models: manifest.modelOrder.map(id => models.find(model => model.id === id)) };
}
