import { Request, Response, NextFunction } from 'express';
interface RateLimitOptions {
    windowMs?: number;
    max?: number;
    message?: string;
    skipSuccessfulRequests?: boolean;
    /** When false, private/LAN IPs are NOT exempt — use for auth endpoints. Default: true. */
    bypassPrivateIp?: boolean;
}
/**
 * Simple in-memory rate limiter for the local Express API.
 * Uses the canonicalized IP address as the key. Designed for a single-tenant
 * desktop app.
 */
export declare function rateLimit(options?: RateLimitOptions): (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
/**
 * Stricter rate limiter for authentication endpoints.
 * Private/LAN IPs are NOT exempt — LAN-based brute-force is a real threat
 * for a POS system. (vuln-0003)
 */
export declare function authRateLimit(options?: {
    max?: number;
}): (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
/**
 * Shared rate limiter for static/SPA file serving. Static assets are public
 * and cheap, but the SPA fallback performs a filesystem read per request, so a
 * generous limit bounds external clients without throttling LAN clients (KDS,
 * Server App, recovery) — mirroring the private-IP convenience of rateLimit().
 * Uses express-rate-limit (rather than the in-memory rateLimit above) so CodeQL
 * recognizes the route as rate-limited (js/missing-rate-limiting).
 */
export declare function staticRouteRateLimit(options?: {
    windowMs?: number;
    limit?: number;
}): import("express-rate-limit").RateLimitRequestHandler;
/**
 * Looks up (and caches) whether a JWT's subject is still an active user, their
 * current role, and the earliest `iat` a token for them may still carry.
 * requireAuth uses this to reject tokens for deactivated users, and tokens
 * issued before a password/PIN change (#173), instead of trusting the JWT's
 * signature/expiry alone.
 */
export declare function getUserAuthStatus(userId: string, options?: {
    fresh?: boolean;
}): {
    isActive: boolean;
    role: string;
    tokensValidAfter: string | null;
} | null;
/**
 * Forces the next requireAuth check for this user to re-read the DB instead
 * of serving a stale cache entry. Call after deactivate/reactivate/role changes,
 * or after bumping tokens_valid_after (password/PIN change, #173).
 */
export declare function invalidateUserAuthCache(userId: string): void;
export declare function clearUserAuthCache(): void;
/**
 * True if a JWT's `iat` (issued-at, seconds since epoch) predates the user's
 * `tokens_valid_after` — i.e. the credentials were changed after this token was
 * issued, so it must be rejected even though its signature and expiry are fine.
 * A stateless per-token blocklist (see revokeToken below) can't do this: it only
 * knows about the one token used to log out, not every other session a user may
 * have open on other devices at the time of a password/PIN change (#173).
 */
export declare function isTokenStale(iat: number | undefined, tokensValidAfter: string | null | undefined): boolean;
export declare function revokeToken(token: string, verifiedExpiresAtMs?: number): void;
export declare function isTokenRevoked(token: string): boolean;
export declare function clearInMemoryRevokedTokens(): void;
export declare function clearRevokedTokens(): void;
/**
 * Role-based authorization middleware.
 * Must be used after requireAuth.
 */
export declare function requireRole(...roles: readonly string[]): (req: Request, res: Response, next: () => void) => Response<any, Record<string, any>> | undefined;
/**
 * Gates authenticated KDS REST endpoints behind the `kds_enabled` setting
 * (issue #133). These are only reachable by an already-authenticated
 * kitchen-staff/manager/owner session, so a clear, explicit error is fine —
 * there's no LAN-probing concern here the way there is for the pairing
 * endpoints and WebSocket upgrade (see requireKdsEnabledOr404).
 */
export declare function requireKdsEnabled(req: Request, res: Response, next: () => void): Response<any, Record<string, any>> | undefined;
/**
 * Gates KDS pairing/discovery surface behind the `kds_enabled` setting,
 * returning 404 instead of 403 (issue #133). A stale or misconfigured KDS
 * device on the LAN should get no confirmation the feature even exists once
 * it's been turned off.
 */
export declare function requireKdsEnabledOr404(req: Request, res: Response, next: () => void): Response<any, Record<string, any>> | undefined;
/**
 * Checks if the given IP address is a private, local, or Tailscale IP.
 */
export declare function isAllowedPrivateIp(ip: string): boolean;
/**
 * Checks if an IP address is disallowed as an outbound fetch target for the
 * SSRF-guarded image proxy (vuln-0003): loopback, private ranges, link-local
 * (includes the 169.254.169.254 cloud metadata address), CGNAT, multicast,
 * and other reserved ranges. This is a broader blocklist than
 * isAllowedPrivateIp, which is a LAN-convenience allowlist for rate
 * limiting/CORS and intentionally does not cover link-local/metadata.
 * Best-effort — covers the realistic SSRF targets, not every obscure
 * IPv6 transition/compat range.
 */
export declare function isBlockedSsrfTarget(ip: string): boolean;
export declare const corsOptions: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void;
};
/**
 * Validates password complexity (vuln-0006).
 * Requires: >= 8 characters, at least 1 uppercase, 1 lowercase, 1 digit.
 */
export declare function validatePassword(password: string): boolean;
export {};
//# sourceMappingURL=security.d.ts.map