export interface BackendPorts {
    server: number;
    kds: number;
    serverApp: number;
}
/**
 * Confirms all three owned HTTP services actually answer, rather than trusting
 * isServerRunning()/isKdsServerRunning()/isServerAppRunning() alone — those only
 * check a non-null module reference, not real liveness (none of the servers
 * attach an 'error' listener, so a died-but-not-nulled server would still
 * report "running").
 */
export declare function probeBackendHealth(ports: BackendPorts, timeoutMs?: number): Promise<boolean>;
//# sourceMappingURL=backend-health.d.ts.map