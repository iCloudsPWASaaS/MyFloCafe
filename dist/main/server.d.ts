export declare function isServerRunning(): boolean;
export declare function getServerPort(): number;
/** Resolve a clean application route to its own Next.js static-export page. */
export declare function resolveStaticPage(frontendDir: string, reqPath: string): string;
export declare function startServer(): Promise<void>;
export declare function stopServer(): Promise<void>;
/** Returns the first valid non-loopback IPv4 address on the machine. */
export declare function getLocalIP(): string;
/** Returns all valid non-loopback IPv4 addresses on the machine. */
export declare function getAllLocalIPs(): string[];
//# sourceMappingURL=server.d.ts.map