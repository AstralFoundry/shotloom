import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";

import { resolveMediaUrl } from "@/host/files";

/**
 * Image with a host storage key.
 *
 * Renders the inline `src` when present; otherwise resolves the storage key through the
 * file host port. `fallback` fills the box while the address is unknown.
 */

export type CachedResourceImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
    storageKey?: string;
    src?: string;
    fallback?: ReactNode;
    /** Load immediately instead of waiting for the viewport; kept for API compatibility. */
    eager?: boolean;
};

const DIRECT = /^(?:data|blob|https?):/i;

export function CachedResourceImage({ storageKey, src = "", fallback = null, eager: _eager = false, alt = "", ...props }: CachedResourceImageProps) {
    const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);
    const direct = DIRECT.test(src) ? src : null;
    const key = storageKey || (src && !DIRECT.test(src) ? src : undefined);

    useEffect(() => {
        if (!key) return;
        let active = true;
        void resolveMediaUrl(key, src).then((url) => {
            if (active) setResolved(url ? { key, url } : null);
        });
        return () => {
            active = false;
        };
    }, [direct, key, src]);

    const source = resolved && resolved.key === key ? resolved.url : direct;
    if (!source) return <>{fallback}</>;
    return <img {...props} alt={alt} src={source} />;
}

export async function resolveCachedResourceUrl(storageKey: string, fallback = "") {
    return resolveMediaUrl(storageKey, fallback);
}
