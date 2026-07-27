function definedEntries(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function compactMode(mode = {}) {
  return definedEntries({
    id: mode.id,
    label: mode.label,
    inputFormat: mode.inputFormat,
    inputConstraints: mode.inputConstraints,
    outputConstraints: mode.outputConstraints,
    imageValueFormat: mode.imageValueFormat,
    referenceImageFormat: mode.referenceImageFormat,
    capabilities: mode.capabilities,
    params: (Array.isArray(mode.params) ? mode.params : [])
      .filter((param) => param?.key !== 'prompt' && param?.key !== 'model'),
  });
}

function compactModel(model = {}) {
  return definedEntries({
    id: model.id,
    name: model.name,
    provider: model.provider,
    defaultMode: model.defaultMode,
    modes: (Array.isArray(model.modes) ? model.modes : []).map(compactMode),
  });
}

export function compactAgentModelCatalog(types = []) {
  const compactTypes = (Array.isArray(types) ? types : [])
    .map((entry) => definedEntries({
      type: entry?.type,
      label: entry?.label,
      defaultModel: entry?.defaultModel,
      models: (Array.isArray(entry?.models) ? entry.models : []).map(compactModel),
    }))
    .filter((entry) => entry.models.length > 0);

  return {
    types: compactTypes,
    // Keep the legacy flat index for model lookup without duplicating mode schemas.
    models: compactTypes.flatMap((entry) => entry.models.map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      type: entry.type,
      defaultMode: model.defaultMode,
    }))),
  };
}

