// Both Android bridge implementations must pass the same document check.
export function isSessionSource(messageUrl: string, documentUrl: string, origin: string): boolean {
  try {
    const document = new URL(documentUrl);
    const source = new URL(messageUrl);
    return document.origin === origin && document.pathname === '/native'
      && source.origin === origin && (source.pathname === '/native' || source.pathname === '/');
  } catch { return false; }
}
