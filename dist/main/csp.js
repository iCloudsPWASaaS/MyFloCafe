"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCspHeader = buildCspHeader;
/**
 * Matches a Host header value that is safe to embed in a CSP directive: a
 * plain hostname or IPv4 literal with an optional port, or a bracketed IPv6
 * literal with an optional port. Anything else — including a forged Host that
 * attempts to smuggle extra directives (e.g. `evil.com; script-src *`) — is
 * rejected so the policy falls back to `'self'` only.
 */
const SAFE_HOST = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$/;
/**
 * Builds a Content-Security-Policy header for a response.
 *
 * `connect-src` is derived from the request's Host header (issue #303) so a
 * companion device that loads the app via the host machine's LAN IP — e.g.
 * `http://10.0.0.37:3003` — is allowed to talk back to that same origin over
 * both HTTP and WebSocket, instead of only the hard-coded `localhost` hosts
 * the previous policy whitelisted. `'self'` is always present so same-origin
 * requests keep working regardless of how the Host header resolved.
 *
 * `'unsafe-inline'` remains required for Next.js RSC hydration scripts and
 * Tailwind-generated style tags, exactly as in the original main-server policy.
 *
 * The Google Maps JS API (Places autocomplete on the POS delivery address) is
 * loaded on demand from the official Google static asset domains. Its script
 * tags and fetches stay blocked unless the renderer actually requests them —
 * a frontend build that ships no `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` never loads
 * the API, so the offline-first invariant is preserved.
 */
const GOOGLE_MAPS_HOSTS = 'https://maps.googleapis.com https://maps.gstatic.com';
function buildCspHeader(req) {
    const host = req.get('Host');
    const connectSrc = host && SAFE_HOST.test(host)
        ? `'self' http://${host} ws://${host} wss://${host}`
        : "'self'";
    return [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline' ${GOOGLE_MAPS_HOSTS}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        `connect-src ${connectSrc} ${GOOGLE_MAPS_HOSTS}`,
        "frame-ancestors 'none'",
    ].join('; ');
}
//# sourceMappingURL=csp.js.map