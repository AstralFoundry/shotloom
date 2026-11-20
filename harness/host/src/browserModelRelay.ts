import { Context } from '@deepseek-ai/cordis';
import Llm, { type GenerateOptions } from '@deepseek-ai/dsh-llm';
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai';
import Credentials from './productCredentials.js';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { AttachmentStore, ImageVariantId, type ImageAttachmentRef, type SaveImageAttachment } from '@deepseek-ai/dsh-attachment';
export type { GenerateOptions } from '@deepseek-ai/dsh-llm';

// 仅转换一次模型请求；不装配 Agent、会话、目标或持久化服务。
export async function createBrowserModelRelay(profile: PiAi.PiAiProviderProfile, apiKey: string, images: Array<Omit<ImageAttachmentRef, 'attachmentId'> & { attachmentId: string; data: string }>) {
  const ctx = new Context();
  class RequestAttachments extends AttachmentStore {
    imageLimits = { maxImageBytes: 20 * 1024 * 1024, maxImagesPerMessage: 8, maxMessageImageBytes: 32 * 1024 * 1024, maxImagePixels: 64000000, maxImageDimension: 16384, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as ('image/png' | 'image/jpeg' | 'image/webp' | 'image/gif')[] };
    async validateImage(_input: SaveImageAttachment): Promise<void> { throw new Error('Relay cannot save images'); }
    async saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> { throw new Error('Relay cannot save images'); }
    async readImage(ref: ImageAttachmentRef) {
      const image = images.find(row => row.attachmentId === ref.attachmentId);
      if (!image || ['mediaType', 'bytes', 'width', 'height'].some(key => image[key as keyof ImageAttachmentRef] !== ref[key as keyof ImageAttachmentRef])) throw new Error('Invalid model image reference');
      const data = Buffer.from(image.data, 'base64');
      if (data.length !== ref.bytes) throw new Error('Invalid model image bytes');
      return { ref, data };
    }
    override async readImageRequest(ref: ImageAttachmentRef) {
      const { data } = await this.readImage(ref);
      return { ...ref, data, attachment: ref, variantId: ImageVariantId(String(ref.attachmentId)), depth: 'uchar' as const, space: 'srgb' as const, hasAlpha: true };
    }
  }
  try {
    await ctx.plugin(Llm);
    await ctx.plugin(Credentials);
    await ctx.plugin(RequestAttachments);
    await ctx.credentials.set(credentialRef('SHOTLOOM_MODEL_RELAY'), apiKey);
    await ctx.plugin(PiAi, { providers: { shotloom: { ...profile, apiKeyEnv: 'SHOTLOOM_MODEL_RELAY' } } });
    return { stream: (options: GenerateOptions) => ctx.llm.stream({ ...options, provider: 'shotloom' }), dispose: () => ctx.fiber.dispose() };
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
