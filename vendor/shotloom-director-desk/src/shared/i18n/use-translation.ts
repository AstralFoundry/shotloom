import { useSyncExternalStore } from 'react';
import { getLanguage, onLanguageChange, t } from './locale.ts';

const subscribe = (listener: () => void) => {
    const off = onLanguageChange(listener);
    return () => {
        off();
    };
};

/** Current UI language; re-renders the caller when it changes. */
export function useLanguage() {
    return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

/**
 * Re-render the calling component when the UI language changes.
 * Returns the `t` helper so call sites read as `const t = useTranslation()`.
 */
export function useTranslation() {
    useLanguage();
    return t;
}
