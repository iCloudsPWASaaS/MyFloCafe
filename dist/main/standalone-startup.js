"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startStandaloneServers = startStandaloneServers;
function throwIfShutdownRequested(isShutdownRequested) {
    if (isShutdownRequested()) {
        const error = new Error('Standalone server startup cancelled during shutdown');
        error.code = 'ERR_SHUTDOWN_ABORTED';
        throw error;
    }
}
async function startStandaloneServers({ initializeDatabase, prepare, startServer, startKdsServer, startServerApp, isShutdownRequested, }) {
    throwIfShutdownRequested(isShutdownRequested);
    await initializeDatabase();
    throwIfShutdownRequested(isShutdownRequested);
    await prepare?.();
    throwIfShutdownRequested(isShutdownRequested);
    await startServer();
    throwIfShutdownRequested(isShutdownRequested);
    await startKdsServer();
    throwIfShutdownRequested(isShutdownRequested);
    await startServerApp?.();
    throwIfShutdownRequested(isShutdownRequested);
}
//# sourceMappingURL=standalone-startup.js.map