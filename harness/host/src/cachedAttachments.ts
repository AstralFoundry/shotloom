import LocalAttachments from '@deepseek-ai/dsh-attachment-local';
import type { Config } from '@deepseek-ai/dsh-attachment-local';
import type { Context } from '@deepseek-ai/cordis';
import type { SaveImageAttachment, ImageAttachmentRef, FileAttachmentRef, SaveFileAttachment, SaveFileStreamAttachment } from '@deepseek-ai/dsh-attachment';

export interface AttachmentStorage {
  publish(path: string, signal?: AbortSignal): Promise<void>;
  restore(path: string, signal?: AbortSignal): Promise<void>;
}

/** Official byte validation and derivatives use a disposable cache; original objects are durable remotely. */
export class CachedAttachments extends LocalAttachments {
  constructor(ctx: Context, config: Config, private files: AttachmentStorage) { super(ctx, config); }
  override async saveImages(inputs: readonly SaveImageAttachment[]) {
    const refs = await super.saveImages(inputs);
    for (const ref of refs) await this.files.publish(this.imageHostPath(ref)!);
    return refs;
  }
  override async saveImage(input: SaveImageAttachment) {
    const ref = await super.saveImage(input);
    await this.files.publish(this.imageHostPath(ref)!);
    return ref;
  }
  override async readImage(ref: ImageAttachmentRef, signal?: AbortSignal) {
    await this.files.restore(this.imageHostPath(ref)!, signal);
    return super.readImage(ref, signal);
  }
  override async saveFile(input: SaveFileAttachment) {
    const ref = await super.saveFile(input);
    await this.files.publish(this.fileHostPath(ref)!);
    return ref;
  }
  override async saveFileStream(input: SaveFileStreamAttachment) {
    const ref = await super.saveFileStream(input);
    await this.files.publish(this.fileHostPath(ref)!, input.signal);
    return ref;
  }
  override async *readFileStream(ref: FileAttachmentRef, signal?: AbortSignal) {
    await this.files.restore(this.fileHostPath(ref)!, signal);
    yield* super.readFileStream(ref, signal);
  }
}
