/** localhost, 127.0.0.1 or *.localhost over http(s). Dependency-free (used by the service worker). */
export function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}
