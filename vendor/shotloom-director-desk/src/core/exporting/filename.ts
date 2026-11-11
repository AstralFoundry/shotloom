/** Cross-platform safe download filename, shared by export plans. */
export function safeFilename(name: string): string {
    const cleaned =
        name
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
            .slice(0, 100)
            .replace(/[. ]+$/g, '') || '未命名';
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? '_' + cleaned : cleaned;
}
