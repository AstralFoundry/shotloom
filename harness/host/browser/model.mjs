import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const name = 'shotloom-browser-model';
export const inject = ['llm', 'attachments'];
export function apply(ctx, config) {
  class Relay extends LlmAdapter {
    async listModels(provider) { return config.providers[provider].models.map(model => ({ ...model, provider })); }
    async resolveModel(provider, id) {
      const model = config.providers[provider]?.models.find(model => model.id === id);
      if (!model) throw new Error('Model is unavailable');
      return { ...model, provider, inputModalities: model.input, ...(model.contextWindow ? { context: { contextWindow: model.contextWindow } } : {}), defaultMaxTokens: model.maxTokens,
        ...(model.reasoningEfforts ? { reasoning: { efforts: Object.keys(model.reasoningEfforts).map(id => ({ id, name: id })) } } : {}),
      };
    }
    async *stream(options) {
      const host = globalThis.shotloomBrowserHost;
      await host.beforeEffect();
      const images = [];
      const visit = async value => {
        if (!value || typeof value !== 'object') return;
        if (value.type === 'image' && value.attachment && !value.offloaded && !images.some(image => image.attachmentId === value.attachment.attachmentId)) {
          const stored = await ctx.attachments.readImage(value.attachment);
          images.push({ ...value.attachment, data: Buffer.from(stored.data).toString('base64') });
        }
        for (const child of Object.values(value)) {
          if (Array.isArray(child)) for (const item of child) await visit(item);
          else if (child && typeof child === 'object') await visit(child);
        }
      };
      await visit(options.messages);
      const { signal, ...request } = options;
      yield* host.model({ request, images, profile: config.providers[options.provider] }, signal);
    }
  }
  const providers = Object.keys(config.providers);
  if (providers.length) ctx.effect(() => ctx.llm.registerAdapter(providers, new Relay()));
}
