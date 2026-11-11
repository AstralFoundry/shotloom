import type { ModelPackage } from './model-package.ts';

/** Portable identity: keep the existing serialized representation and SHA-256 algorithm. */
export async function modelPackageId(data: ModelPackage): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return 'model-' + [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
