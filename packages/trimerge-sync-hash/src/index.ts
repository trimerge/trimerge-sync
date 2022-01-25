import Jssha from 'jssha';

/**
 * Generates a SHA-256 Base64 URL hash (RFC 4648 §5)
 *
 * See: https://tools.ietf.org/html/rfc4648#section-5
 */
export function computeRef(
  baseRef: string | undefined,
  mergeRef: string | undefined,
  delta: any,
): string {
  const sha = new Jssha('SHA-256', 'TEXT', { encoding: 'UTF8' });
  sha.update(JSON.stringify([baseRef, mergeRef, delta]));
  // Convert to Base64 URL
  return sha
    .getHash('B64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
