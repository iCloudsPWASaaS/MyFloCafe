/**
 * Checks whether a URL is permitted to open in a new local Electron window.
 * Allows local server origins (localhost, loopback, configured local IP) as well
 * as blank windows (`about:blank`, `""`) used for web printing popups.
 */
export declare function isAllowedLocalWindowUrl(rawUrl: string, port: number, localIp?: string): boolean;
export declare function isSafeExternalUrl(rawUrl: string): boolean;
//# sourceMappingURL=url-allowlist.d.ts.map