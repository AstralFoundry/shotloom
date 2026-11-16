import { createReadStream, createWriteStream, type ReadStream, type WriteStream } from 'node:fs';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import { ZipFile as ZipWriter } from 'yazl';
import { open as openZip, type ZipFile } from 'yauzl';

/** STORED archives with streaming IO and automatic ZIP64 support. */
export interface ZipCentralEntry { name: string; crc: number; size: number; offset: number }

export class StoredZipWriter {
  private readonly zip = new ZipWriter();
  private readonly completion: Promise<void>;
  private readonly sources = new Set<ReadStream>();
  private failure: Error | undefined;

  private constructor(private readonly output: WriteStream) {
    this.zip.on('error', (error: Error) => (this.zip.outputStream as Readable).destroy(error));
    this.completion = pipeline(this.zip.outputStream as Readable, output);
    void this.completion.catch((error: Error) => {
      this.failure = error;
      for (const source of this.sources) source.destroy(error);
    });
  }
  static async create(path: string): Promise<StoredZipWriter> {
    const writer = new StoredZipWriter(createWriteStream(path));
    await once(writer.output, 'open');
    return writer;
  }
  async addBuffer(name: string, data: Buffer): Promise<number> {
    if (this.failure) throw this.failure;
    this.zip.addBuffer(data, name, { compress: false });
    return data.length;
  }
  async addFile(name: string, sourcePath: string, size: number): Promise<number> {
    if (this.failure) throw this.failure;
    const source = createReadStream(sourcePath);
    this.sources.add(source);
    const consumed = finished(source);
    try {
      this.zip.addReadStream(source, name, { compress: false, size });
      // The caller may remove a temporary SQLite snapshot after this resolves.
      await consumed;
      if (this.failure) throw this.failure;
      return size;
    } finally {
      source.destroy();
      await consumed.catch(() => undefined);
      this.sources.delete(source);
    }
  }
  async close(options: { forceZip64Format?: boolean } = {}): Promise<void> {
    this.zip.end({ forceZip64Format: options.forceZip64Format ?? false, comment: '' });
    await this.completion;
  }
  async abort(): Promise<void> {
    for (const source of this.sources) source.destroy();
    (this.zip.outputStream as Readable).destroy();
    this.output.destroy();
    await this.completion.catch(() => undefined);
  }
}

export class StoredZipReader {
  private constructor(private readonly path: string, readonly entries: ZipCentralEntry[], private readonly dataOffsets: Map<string, number>) {}

  static async open(path: string, size: number): Promise<StoredZipReader> {
    const zip = await new Promise<ZipFile>((resolve, reject) => {
      openZip(path, { autoClose: false, lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
        (error, archive) => error ? reject(error) : resolve(archive!));
    });
    const entries: ZipCentralEntry[] = [];
    const offsets = new Map<string, number>();
    try {
      // Includes the package manifest. Bound metadata before walking an untrusted archive.
      if (zip.entryCount > 20_001) throw new Error('zip archive has too many entries');
      await new Promise<void>((resolve, reject) => {
        zip.on('error', reject);
        zip.on('end', resolve);
        zip.on('entry', async entry => {
          try {
            if (entry.compressionMethod !== 0 || entry.isEncrypted()) throw new Error(`unsupported zip encoding: ${entry.fileName}`);
            if (offsets.has(entry.fileName)) throw new Error(`duplicate zip entry: ${entry.fileName}`);
            const header = await zip.readLocalFileHeaderPromise(entry, { minimal: true });
            const start = header.fileDataStart;
            if (!Number.isSafeInteger(start + entry.uncompressedSize) || start + entry.uncompressedSize > size) throw new Error('zip entry extends beyond archive');
            offsets.set(entry.fileName, start);
            entries.push({ name: entry.fileName, crc: entry.crc32, size: entry.uncompressedSize, offset: entry.relativeOffsetOfLocalHeader });
            zip.readEntry();
          } catch (error) { reject(error); }
        });
        zip.readEntry();
      });
      return new StoredZipReader(path, entries, offsets);
    } finally { zip.close(); }
  }
  entry(name: string): ZipCentralEntry | undefined { return this.entries.find(entry => entry.name === name); }

  read(name: string): Readable {
    const entry = this.entry(name);
    const start = this.dataOffsets.get(name);
    if (!entry || start === undefined) throw new Error(`zip entry missing: ${name}`);
    const path = this.path;
    return Readable.from((async function* () {
      let size = 0;
      let crc = 0;
      if (entry.size > 0) {
        for await (const chunk of createReadStream(path, { start, end: start + entry.size - 1 })) {
          const buffer = chunk as Buffer;
          size += buffer.length;
          crc = crc32(buffer, crc);
          yield buffer;
        }
      }
      if (size !== entry.size || (crc >>> 0) !== entry.crc) throw new Error(`zip entry integrity check failed: ${name}`);
    })());
  }
  async readBuffer(name: string, maxBytes = 1024 * 1024): Promise<Buffer> {
    const entry = this.entry(name);
    if (!entry || entry.size > maxBytes) throw new Error(`zip entry missing or too large: ${name}`);
    const chunks: Buffer[] = [];
    for await (const chunk of this.read(name)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }
}
export { Readable };
