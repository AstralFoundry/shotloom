import { open, readFile, type FileHandle } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { crc32 } from 'node:zlib';
import { Readable } from 'node:stream';

/**
 * 只做 STORED（不压缩）的流式 ZIP 读写。项目包/资源包里都是 sqlite 与已压缩的媒体，
 * 再压一次既费 CPU 又可能让体积变大；Rust 侧同样使用 Stored。
 *
 * 写成流式而不是内存缓冲：一个项目包可能有几 GB 的视频素材，整包读进内存会直接
 * 把主进程打爆。读取也按条目返回流，导入时逐条落盘。
 */

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const VERSION = 20;

export interface ZipCentralEntry {
  name: string;
  crc: number;
  size: number;
  offset: number;
}

function localHeader(nameBytes: Buffer, crc: number, size: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_SIGNATURE, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes]);
}

function centralHeader(entry: ZipCentralEntry, nameBytes: Buffer): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, nameBytes]);
}

export class StoredZipWriter {
  private constructor(private readonly handle: FileHandle) {}

  private offset = 0;
  private readonly entries: ZipCentralEntry[] = [];

  static async create(path: string): Promise<StoredZipWriter> {
    return new StoredZipWriter(await open(path, 'w'));
  }

  private async write(buffer: Buffer): Promise<void> {
    await this.handle.write(buffer, 0, buffer.length, this.offset);
    this.offset += buffer.length;
  }

  /** 写入一段内存内容（清单、文本文件）。 */
  async addBuffer(name: string, data: Buffer): Promise<number> {
    const nameBytes = Buffer.from(name, 'utf8');
    const entry: ZipCentralEntry = { name, crc: crc32(data) >>> 0, size: data.length, offset: this.offset };
    await this.write(localHeader(nameBytes, entry.crc, entry.size));
    await this.write(data);
    this.entries.push(entry);
    return data.length;
  }

  /** 流式写入磁盘上的文件，边读边算 CRC，写完回填本地头。 */
  async addFile(name: string, sourcePath: string, size: number): Promise<number> {
    const nameBytes = Buffer.from(name, 'utf8');
    const headerOffset = this.offset;
    const entry: ZipCentralEntry = { name, crc: 0, size, offset: headerOffset };
    await this.write(localHeader(nameBytes, 0, 0));
    const dataOffset = this.offset;
    let crc = 0;
    let written = 0;
    for await (const chunk of createReadStream(sourcePath)) {
      const buffer = chunk as Buffer;
      crc = crc32(buffer, crc) >>> 0;
      await this.handle.write(buffer, 0, buffer.length, dataOffset + written);
      written += buffer.length;
    }
    if (written !== size) {
      throw new Error(`zip entry size changed while reading: ${name}`);
    }
    entry.crc = crc;
    entry.offset = headerOffset;
    const patch = Buffer.alloc(12);
    patch.writeUInt32LE(crc, 0);
    patch.writeUInt32LE(written, 4);
    patch.writeUInt32LE(written, 8);
    await this.handle.write(patch, 0, patch.length, headerOffset + 14);
    this.offset = dataOffset + written;
    this.entries.push(entry);
    return written;
  }

  async close(): Promise<void> {
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      await this.write(centralHeader(entry, Buffer.from(entry.name, 'utf8')));
    }
    const centralSize = this.offset - centralOffset;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralOffset, 16);
    eocd.writeUInt16LE(0, 20);
    await this.write(eocd);
    await this.handle.close();
  }

  async abort(): Promise<void> {
    await this.handle.close().catch(() => {});
  }
}

export class StoredZipReader {
  private constructor(
    private readonly path: string,
    readonly entries: ZipCentralEntry[],
    private readonly dataOffsets: Map<string, number>,
  ) {}

  static async open(path: string, size: number): Promise<StoredZipReader> {
    const tailSize = Math.min(size, 1024 * 1024);
    const handle = await open(path, 'r');
    try {
      const tail = Buffer.alloc(tailSize);
      await handle.read(tail, 0, tailSize, size - tailSize);
      let eocd = -1;
      for (let index = tail.length - 22; index >= 0; index -= 1) {
        if (tail.readUInt32LE(index) === EOCD_SIGNATURE) { eocd = index; break; }
      }
      if (eocd < 0) throw new Error('not a zip archive');
      const count = tail.readUInt16LE(eocd + 10);
      const centralSize = tail.readUInt32LE(eocd + 12);
      const centralOffset = tail.readUInt32LE(eocd + 16);
      if (count === 0) return new StoredZipReader(path, [], new Map());
      const central = Buffer.alloc(centralSize);
      await handle.read(central, 0, centralSize, centralOffset);
      const entries: ZipCentralEntry[] = [];
      const dataOffsets = new Map<string, number>();
      let cursor = 0;
      for (let index = 0; index < count; index += 1) {
        if (central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error('corrupt zip central directory');
        const method = central.readUInt16LE(cursor + 10);
        const crc = central.readUInt32LE(cursor + 16);
        const entrySize = central.readUInt32LE(cursor + 24);
        const nameLength = central.readUInt16LE(cursor + 28);
        const extraLength = central.readUInt16LE(cursor + 30);
        const commentLength = central.readUInt16LE(cursor + 32);
        const offset = central.readUInt32LE(cursor + 42);
        const name = central.toString('utf8', cursor + 46, cursor + 46 + nameLength);
        if (method !== 0) throw new Error(`unsupported zip compression for ${name}`);
        const local = Buffer.alloc(30);
        await handle.read(local, 0, 30, offset);
        if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error('corrupt zip local header');
        const localNameLength = local.readUInt16LE(26);
        const localExtraLength = local.readUInt16LE(28);
        dataOffsets.set(name, offset + 30 + localNameLength + localExtraLength);
        entries.push({ name, crc, size: entrySize, offset });
        cursor += 46 + nameLength + extraLength + commentLength;
      }
      return new StoredZipReader(path, entries, dataOffsets);
    } finally {
      await handle.close();
    }
  }

  entry(name: string): ZipCentralEntry | undefined {
    return this.entries.find(item => item.name === name);
  }

  /** 读取条目流；调用方负责消费或忽略。 */
  read(name: string): Readable {
    const entry = this.entry(name);
    if (!entry) throw new Error(`zip entry missing: ${name}`);
    const start = this.dataOffsets.get(name);
    if (start === undefined) throw new Error(`zip entry offset missing: ${name}`);
    return createReadStream(this.path, { start, end: start + entry.size - 1 });
  }

  async readBuffer(name: string): Promise<Buffer> {
    const entry = this.entry(name);
    if (!entry) throw new Error(`zip entry missing: ${name}`);
    const start = this.dataOffsets.get(name);
    if (start === undefined) throw new Error(`zip entry offset missing: ${name}`);
    return readFile(this.path).then(buffer => buffer.subarray(start, start + entry.size));
  }
}

export { Readable };
