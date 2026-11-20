import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'

export const imageLimits = { maxImageBytes: 20 * 1024 * 1024, maxImagesPerMessage: 8, maxMessageImageBytes: 32 * 1024 * 1024,
  maxImagePixels: 64000000, maxImageDimension: 16384, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] }
const digest = data => `sha256:${createHash('sha256').update(data).digest('hex')}`
const safeName = name => String(name || 'attachment.bin').split(/[\\/]/).at(-1).slice(0, 256) || 'attachment.bin'
const file = id => {
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('AGENT_ATTACHMENT_INVALID')
  return `/dsh/state/attachments/${id.slice(7)}`
}

async function normalized(input, target = { width: 2048, height: 2048, maxBytes: 2 * 1024 * 1024 }) {
  if (!imageLimits.mediaTypes.includes(input.mediaType) || input.data.length > imageLimits.maxImageBytes) throw new Error('AGENT_ATTACHMENT_LIMIT')
  const b = input.data
  const detected = b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 ? 'image/png'
    : b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'image/jpeg'
    : String.fromCharCode(...b.subarray(0, 3)) === 'GIF' ? 'image/gif'
    : String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP' ? 'image/webp' : null
  if (detected !== input.mediaType) throw new Error('AGENT_ATTACHMENT_INVALID')
  const bitmap = await createImageBitmap(new Blob([input.data], { type: input.mediaType }))
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > imageLimits.maxImagePixels
      || Math.max(bitmap.width, bitmap.height) > imageLimits.maxImageDimension) throw new Error('AGENT_ATTACHMENT_LIMIT')
    const ratio = Math.min(1, target.width / bitmap.width, target.height / bitmap.height)
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * ratio)), Math.max(1, Math.round(bitmap.height * ratio)))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    let best
    for (const quality of [0.85, 0.75, 0.6]) {
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality })
      const data = new Uint8Array(await blob.arrayBuffer())
      if (!best || data.length < best.data.length) best = { data, mediaType: blob.type, width: canvas.width, height: canvas.height, bytes: data.length }
      if (data.length <= target.maxBytes) break
    }
    if (best.data.length > target.maxBytes) throw new Error('AGENT_ATTACHMENT_LIMIT')
    return best
  } finally { bitmap.close() }
}

export class BrowserAttachments extends AttachmentStore {
  imageLimits = imageLimits
  async validateImage(input) { await normalized(input) }
  async saveImage(input) {
    const output = await normalized(input)
    const ref = { attachmentId: digest(output.data), mediaType: output.mediaType, bytes: output.bytes, width: output.width, height: output.height,
      ...(input.name ? { name: input.name.split(/[\\/]/).at(-1).slice(0, 256) } : {}) }
    await mkdir('/dsh/state/attachments', { recursive: true })
    await writeFile(file(ref.attachmentId), output.data)
    await writeFile(file(ref.attachmentId) + '.json', JSON.stringify(ref))
    await globalThis.canvasBrowserHost.barrier()
    return ref
  }
  async readImage(ref) {
    const data = new Uint8Array(await readFile(file(ref.attachmentId)))
    if (digest(data) !== ref.attachmentId || data.length !== ref.bytes) throw new Error('AGENT_ATTACHMENT_CORRUPT')
    return { ref, data }
  }
  async readImageRequest(ref, target) {
    const { data } = await this.readImage(ref)
    const output = await normalized({ data, mediaType: ref.mediaType }, target)
    return { ...output, attachment: ref, variantId: digest(output.data), depth: 'uchar', space: 'srgb', hasAlpha: true }
  }
  async saveFile(input) {
    const data = input.data, attachmentId = digest(data)
    const ref = { attachmentId, bytes: data.length, name: safeName(input.name) }
    await mkdir('/dsh/state/attachments', { recursive: true })
    await writeFile(file(attachmentId), data)
    await globalThis.canvasBrowserHost.barrier()
    return ref
  }
  async saveFileStream(input) {
    const root = `/dsh/state/attachments/upload-${randomUUID()}`
    await mkdir(root, { recursive: true })
    const hash = createHash('sha256'), chunks = []
    let bytes = 0
    for await (const chunk of input.data) {
      input.signal?.throwIfAborted()
      for (let offset = 0; offset < chunk.length; offset += 65536) {
        const data = chunk.subarray(offset, offset + 65536)
        const path = `${root}/${chunks.length}`
        await writeFile(path, data); hash.update(data); bytes += data.length; chunks.push(path)
        await globalThis.canvasBrowserHost.barrier()
      }
    }
    const attachmentId = `sha256:${hash.digest('hex')}`
    const ref = { attachmentId, bytes, name: safeName(input.name) }
    await writeFile(file(attachmentId) + '.file.json', JSON.stringify({ ref, chunks }))
    await globalThis.canvasBrowserHost.barrier()
    return ref
  }
  fileHostPath(ref) { return `/attachments/${ref.attachmentId}/${safeName(ref.name)}` }
  async *readFileStream(ref, signal) {
    let manifest
    try { manifest = JSON.parse(await readFile(file(ref.attachmentId) + '.file.json', 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const hash = createHash('sha256'); let bytes = 0
    for (const path of manifest?.chunks ?? [file(ref.attachmentId)]) {
      signal?.throwIfAborted()
      const data = new Uint8Array(await readFile(path)); hash.update(data); bytes += data.length; yield data
    }
    if (`sha256:${hash.digest('hex')}` !== ref.attachmentId || bytes !== ref.bytes) throw new Error('AGENT_ATTACHMENT_CORRUPT')
  }
}
export default BrowserAttachments;
