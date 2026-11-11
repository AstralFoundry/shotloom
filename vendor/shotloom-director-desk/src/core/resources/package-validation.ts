import { unpackModelFiles, type ModelPackage } from './model-package.ts';
import { cloneModelPackage, modelPackageEvidence, rememberModelPackageEvidence } from './model-data.ts';
import type { ModelResource } from './project-resources.ts';

/** Compare immutable strings directly, without allocating another Base64-sized JSON string. */
export function sameModelPackage(a: ModelPackage, b: ModelPackage): boolean {
    if (
        !a ||
        !b ||
        a.version !== b.version ||
        a.format !== b.format ||
        a.entry !== b.entry ||
        !Array.isArray(a.files) ||
        !Array.isArray(b.files) ||
        a.files.length !== b.files.length
    )
        return false;
    // Preserve unknown serialized fields until the file schema explicitly rejects them.
    if (
        [a, b].some(
            (p) =>
                Object.keys(p).some((k) => !['version', 'format', 'entry', 'files'].includes(k)) ||
                p.files.some((f) => !f || Object.keys(f).some((k) => !['path', 'data'].includes(k))),
        )
    )
        return JSON.stringify(a) === JSON.stringify(b);
    return a.files.every((f, i) => f.path === b.files[i].path && f.data === b.files[i].data);
}

export function sameModelResources(a: readonly ModelResource[], b: readonly ModelResource[]): boolean {
    return (
        a === b ||
        (a.length === b.length &&
            a.every((resource, i) => {
                const { package: left, ...metadata } = resource,
                    { package: right, ...other } = b[i];
                return sameModelPackage(left, right) && JSON.stringify(metadata) === JSON.stringify(other);
            }))
    );
}

/** Compare project/document state without expanding immutable model payload strings. */
export function sameProjectData<T extends { resources?: readonly ModelResource[] }>(a: T, b: T): boolean {
    const { resources: left, ...state } = a,
        { resources: right, ...next } = b;
    if (left !== right && (!left || !right || !sameModelResources(left, right))) return false;
    return JSON.stringify(state) === JSON.stringify(next);
}

// Evidence lives as long as a validated package does. The bounded ID index is weak: large
// source strings are not pinned after a project/history is released. Compare record snapshots
// even on identity hits, so in-place edits cannot reuse stale validation.
const checked = new Map<string, WeakRef<ModelPackage>>();
export function assertResourcePackage(id: string, data: ModelPackage) {
    const previous = modelPackageEvidence(data) ?? checked.get(id)?.deref();
    let evidence = previous;
    if (!previous || !sameModelPackage(previous, data)) {
        unpackModelFiles(data);
        evidence = cloneModelPackage(data, false);
    }
    rememberModelPackageEvidence(data, evidence!);
    checked.delete(id);
    checked.set(id, new WeakRef(evidence!));
    if (checked.size > 128) checked.delete(checked.keys().next().value!);
}
