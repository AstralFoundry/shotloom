import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

// Scan compiled web payload only. Never put this script or its local denylist in the installer.
const root = path.resolve('dist');
const allowed =
    /^(?:index\.html|favicon\.svg|assets\/[A-Za-z0-9_-]+\.(?:js|css)|assets\/(?:three\.core|model-import\.worker|planner\.worker)-[A-Za-z0-9_-]+\.js|assets\/inter-latin-wght-normal-[A-Za-z0-9_-]+\.woff2)$/;
const rules = [
    ['absolute-windows-path', /[A-Za-z]:[\\/](?:[\w .-]+[\\/])/],
    ['user-home-path', /(?:\/Users\/|\/home\/|file:\/\/\/)[^\s"'<>]+/],
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    [
        'credential-token',
        /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})/,
    ],
    [
        'credential-assignment',
        /(?:api[_-]?key|api[_-]?secret|access[_-]?token|client[_-]?secret)\s*[=:]\s*["'][^"'\s]{16,}["']/i,
    ],
    ['embedded-authorization', /Bearer\s+[A-Za-z0-9_.-]{20,}/],
    ['development-hook', /__director|sourceMappingURL\s*=/],
];
const privateTerms = new Set(
    [os.homedir(), path.resolve('.'), process.env.USERNAME, path.basename(os.homedir())].filter(
        (s) => s && s.length >= 4,
    ),
);
// Optional local additions: actual names, internal URLs, project names, dialogue, credentials.
// This file is excluded from release payloads and never copied into the manifest.
try {
    const terms = JSON.parse(await fs.readFile('.audit/release-private-terms.json', 'utf8'));
    if (!Array.isArray(terms) || terms.some((t) => typeof t !== 'string' || !t.trim()))
        throw new Error('Invalid local privacy terms');
    terms.forEach((t) => privateTerms.add(t));
} catch (e) {
    if (e.code !== 'ENOENT') throw new Error('Local privacy terms must be a JSON string array');
}
// Collect private example project titles, reference filenames and named actors without printing them.
// Generic role labels are not private names. Only omit derived prefixes; full names and explicit denylist terms still apply.
const genericActorPrefixes = new Set(['人物', '演员', '角色', '群演']);
// These four labels are shipped in the public starter scene in src/model.ts, not user-authored names.
const publicStarterActors = new Set(['人物 A · 床边', '人物 B · 走向衣柜', '人物 C · 书桌', '人物 D · 进门']);
function actorTerms(entity) {
    if (publicStarterActors.has(entity.name)) return [];
    const prefix = entity.name?.split(/[ ·—]/)[0];
    return [entity.name, ...(genericActorPrefixes.has(prefix) ? [] : [prefix])];
}
async function exampleTerms(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch((e) => {
        if (e.code === 'ENOENT') return [];
        throw e;
    })) {
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await exampleTerms(file);
        else if (entry.name.endsWith('.director')) {
            const p = JSON.parse(await fs.readFile(file, 'utf8'));
            const scenes = p.version === 3 ? (p.scenes ?? []) : [];
            const states = p.version === 3 ? scenes.flatMap((s) => [s.state, s.origin?.state]).filter(Boolean) : [p];
            // 第一场 is the public default scene label in the project migrator; explicit local denylist entries still win.
            for (const term of [
                p.name,
                p.name?.split(/[ ·—]/)[0],
                ...scenes.flatMap((s) => [s.name, s.origin?.sceneName]).filter((name) => name !== '第一场'),
                ...states.flatMap((state) => [
                    ...(state.references ?? []).map((r) => r.name),
                    ...(state.entities ?? []).filter((e) => e.kind === 'actor').flatMap(actorTerms),
                    state.production?.fixedPrompt,
                    ...(state.production?.notes ?? []).flatMap((n) => [n.story, n.dialogue]),
                ]),
                ...scenes.flatMap((s) => (s.origin?.notes ?? []).flatMap((n) => [n.story, n.dialogue])),
            ])
                if (typeof term === 'string' && term.length >= 2) privateTerms.add(term);
        }
    }
}
await exampleTerms('examples');
const manifest = [],
    failures = [];
async function inspect(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name),
            relative = path.relative(root, file).replaceAll('\\', '/');
        if (entry.isSymbolicLink()) {
            failures.push({ file: relative, rule: 'symlink' });
            continue;
        }
        if (entry.isDirectory()) {
            if (relative !== 'assets') failures.push({ file: relative, rule: 'directory-not-allowed' });
            else await inspect(file);
            continue;
        }
        if (!entry.isFile() || !allowed.test(relative)) {
            failures.push({ file: relative, rule: 'file-not-allowed' });
            continue;
        }
        const bytes = await fs.readFile(file),
            content = bytes.toString('utf8');
        for (const [name, regex] of rules) if (regex.test(content)) failures.push({ file: relative, rule: name });
        if ([...privateTerms].some((term) => content.toLowerCase().includes(term.toLowerCase())))
            failures.push({ file: relative, rule: 'local-private-term' });
        manifest.push({
            file: relative,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
        });
    }
}
await inspect(root);
if (!manifest.some((f) => f.file === 'index.html') || !manifest.some((f) => f.file.endsWith('.js')))
    failures.push({ file: 'dist', rule: 'missing-web-entry' });
if (failures.length) {
    // Report rule and relative filename only, never the matching private value.
    console.error(JSON.stringify({ passed: false, failures }, null, 2));
    process.exitCode = 1;
} else {
    await fs.mkdir('.audit', { recursive: true });
    await fs.writeFile(
        '.audit/release-web-manifest.json',
        JSON.stringify({ scope: 'compiled-web-payload-only', passed: true, files: manifest }, null, 2),
    );
    console.log(`Privacy check passed: ${manifest.length} allowlisted web files.`);
}
