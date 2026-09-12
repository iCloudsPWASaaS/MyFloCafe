"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeBackendHealth = probeBackendHealth;
/**
 * Confirms all three owned HTTP services actually answer, rather than trusting
 * isServerRunning()/isKdsServerRunning()/isServerAppRunning() alone — those only
 * check a non-null module reference, not real liveness (none of the servers
 * attach an 'error' listener, so a died-but-not-nulled server would still
 * report "running").
 */
async function probeBackendHealth(ports, timeoutMs = 1500) {
    const endpoints = [
        `http://127.0.0.1:${ports.server}/api/health`,
        `http://127.0.0.1:${ports.kds}/api/health`,
        `http://127.0.0.1:${ports.serverApp}/api/health`,
    ];
    try {
        const responses = await Promise.all(endpoints.map((url) => fetch(url, { signal: AbortSignal.timeout(timeoutMs) })));
        return responses.every((response) => response.ok);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=backend-health.js.map