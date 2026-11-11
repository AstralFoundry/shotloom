import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';

export default {
    base: './',
    plugins: [react()],
    resolve: {
        alias: {
            // Single alias keeps layer boundaries readable: @/features/..., @/core/..., @/state/...
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    server: {
        watch: {
            // Build outputs and isolated test profiles are not application source.
            ignored: ['**/tmp/**', '**/.audit/**', '**/release/**', '**/.local/**'],
        },
    },
};
