/** Icons are local raster assets, never scripts, remote URLs or paths outside the package. */
export function pluginIconPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && /^[a-zA-Z0-9_/-]+\.(?:png|jpe?g|webp|gif)$/.test(value) && value.split('/').every(part => part && part !== '..');
}
export function pluginIconSource(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 96 * 1024) return undefined;
  return /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : undefined;
}
export function packagedPluginIcon(path: string, bytes: Uint8Array | undefined): string {
  if (!pluginIconPath(path) || !bytes || !bytes.length || bytes.length > 64 * 1024) throw new Error('Plugin icon must be an existing raster asset within 64 KiB');
  const extension = path.split('.').at(-1)!;
  const mime = extension === 'jpg' ? 'jpeg' : extension;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/${mime};base64,${btoa(binary)}`;
}
