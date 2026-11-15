export const cloudEnabled = import.meta.env.VITE_STORAGE_MODE !== 'local';
export const cloudOrigin = String(import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
