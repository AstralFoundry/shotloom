import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'three/addons/libs/fflate.module.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const sources = JSON.parse(await fs.readFile(new URL('./test-asset-sources.json', import.meta.url), 'utf8'));
export const furnitureFiles = [
    'License.txt',
    ...['bedDouble', 'chair', 'table'].flatMap((name) => [
        `Models/OBJ format/${name}.obj`,
        `Models/OBJ format/${name}.mtl`,
        `Models/FBX format/${name}.fbx`,
        `Models/GLTF format/${name}.glb`,
    ]),
];
export const requiredFiles = [...sources.map((s) => s.file), ...furnitureFiles.map((f) => 'kenney-furniture/' + f)];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const defaultRoot = path.join(projectRoot, 'test-assets/external');

export async function missingTestAssets(root = defaultRoot) {
    const missing = [];
    for (const file of requiredFiles) {
        try {
            await fs.access(path.join(root, file));
        } catch {
            missing.push(file);
        }
    }
    return missing;
}
export async function checkTestAssets(root = defaultRoot) {
    const missing = await missingTestAssets(root);
    if (missing.length) {
        const listed = missing.slice(0, 8).join('\n  - ');
        const more = missing.length > 8 ? `\n  …另外 ${missing.length - 8} 个` : '';
        throw Error(`缺少 ${missing.length} 个测试素材文件，请先运行 npm run test:assets：\n  - ${listed}${more}`);
    }
}
export async function extractFurniture(bytes, root) {
    // Extract only fixed, known members; no archive-provided path can escape the destination.
    const needed = new Set(furnitureFiles),
        entries = unzipSync(bytes, { filter: (file) => needed.has(file.name) });
    for (const file of furnitureFiles) if (!entries[file]) throw Error('测试素材压缩包缺少文件：' + file);
    for (const file of furnitureFiles) {
        const target = path.join(root, 'kenney-furniture', file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, entries[file]);
    }
}
export async function prepareTestAssets(root = defaultRoot, fetcher = fetch) {
    for (const source of sources) {
        const target = path.join(root, source.file);
        let bytes = await fs.readFile(target).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (!bytes || digest(bytes) !== source.sha256) {
            // Slow upstreams (raw.githubusercontent) and hotlink-protected CDNs (kenney.nl) both
            // need per-source patience and headers; keep both in the pinned manifest.
            console.log(`下载测试素材：${source.file}`);
            const response = await fetcher(source.url, {
                headers: source.headers,
                signal: AbortSignal.timeout(source.timeoutMs ?? 300000),
            });
            if (!response.ok) throw Error(`测试素材下载失败：${source.file} (${response.status})`);
            bytes = Buffer.from(await response.arrayBuffer());
            if (digest(bytes) !== source.sha256) throw Error('测试素材校验失败：' + source.file);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, bytes);
        }
        if (source.file === 'kenney_furniture-kit.zip') await extractFurniture(bytes, root);
    }
    await checkTestAssets(root);
    await fs.writeFile(
        path.join(root, 'README.md'),
        `# Local test assets\n\nPinned sources and SHA-256: scripts/test-asset-sources.json. These files are not distributed with the app.\n\nKhronos models retain their LICENSE.md and metadata.json; Kenney furniture is CC0 (License.txt). Three.js FBX fixtures retain the upstream README and code LICENSE; no model redistribution grant is inferred.\n`,
    );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv[2] === 'prepare') {
            await prepareTestAssets();
            console.log('测试素材已准备并校验完成。');
        } else {
            await checkTestAssets();
            console.log('测试素材就绪。');
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
