import type { ModelPackage } from './model-package.ts';
import type { ModelResource } from './project-resources.ts';

const evidence = new WeakMap<ModelPackage, ModelPackage>();
export function modelPackageEvidence(value: ModelPackage) {
    return evidence.get(value);
}
export function rememberModelPackageEvidence(value: ModelPackage, snapshot: ModelPackage) {
    evidence.set(value, snapshot);
}

/** Isolate editable records, retaining immutable payload strings without serializing them. */
export function cloneModelPackage(value: ModelPackage, preserveEvidence = true): ModelPackage {
    if (!value || !Array.isArray(value.files)) return structuredClone(value);
    const { files, ...metadata } = value;
    const result = {
        ...structuredClone(metadata),
        files: files.map((file) => {
            if (!file || typeof file.data !== 'string') return structuredClone(file);
            const { data, ...fields } = file;
            return { ...structuredClone(fields), data };
        }),
    };
    // This is evidence, not a trusted flag: validation still compares every record to it.
    const snapshot = preserveEvidence ? evidence.get(value) : undefined;
    if (snapshot) evidence.set(result, snapshot);
    return result;
}

export function cloneModelResource(value: ModelResource): ModelResource {
    if (!value || typeof value !== 'object' || !('package' in value)) return structuredClone(value);
    const { package: source, ...metadata } = value;
    return { ...structuredClone(metadata), package: cloneModelPackage(source) };
}

/** Only project/document resource containers and standalone resources take the fast path. */
export function cloneProjectData<T>(value: T): T {
    if (Array.isArray(value)) {
        if (value.some((v) => v && typeof v === 'object' && 'package' in v)) return value.map(cloneModelResource) as T;
    } else if (value && typeof value === 'object') {
        if ('package' in value) return cloneModelResource(value as unknown as ModelResource) as T;
        const source = value as T & { resources?: ModelResource[]; media?: { data: string }[] };
        if (Array.isArray(source.resources) || Array.isArray(source.media)) {
            const { resources, media, ...rest } = source;
            return {
                ...structuredClone(rest),
                ...('resources' in source
                    ? {
                          resources: Array.isArray(resources)
                              ? resources.map(cloneModelResource)
                              : structuredClone(resources),
                      }
                    : {}),
                ...('media' in source
                    ? {
                          media: Array.isArray(media)
                              ? media.map((item) => {
                                    if (!item || typeof item.data !== 'string') return structuredClone(item);
                                    const { data, ...metadata } = item;
                                    return { ...structuredClone(metadata), data };
                                })
                              : structuredClone(media),
                      }
                    : {}),
            } as T;
        }
    }
    return structuredClone(value);
}
