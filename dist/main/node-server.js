"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
const server_1 = require("./server");
const kds_server_1 = require("./kds-server");
const server_app_1 = require("./server-app");
async function main() {
    console.log('[Flo Node] Initializing database...');
    (0, db_1.initDatabase)();
    console.log('[Flo Node] Starting main API...');
    await (0, server_1.startServer)();
    console.log('[Flo Node] Starting KDS...');
    await (0, kds_server_1.startKdsServer)();
    console.log('[Flo Node] Starting Server App...');
    await (0, server_app_1.startServerApp)();
    console.log('');
    console.log('========================================');
    console.log(' FloCafe Node-only server is running');
    console.log('========================================');
    console.log(' Main API:    http://localhost:3001');
    console.log(' KDS:         http://localhost:3002');
    console.log(' Server App:  http://localhost:3003');
    console.log('');
    console.log(' Open: http://localhost:3003/server-standalone/');
    console.log('========================================');
}
async function shutdown(signal) {
    console.log(`\n[Flo Node] ${signal} - shutting down...`);
    try {
        await (0, server_app_1.stopServerApp)();
    }
    catch (error) {
        console.error('[Flo Node] Server App shutdown error:', error);
    }
    try {
        await (0, server_1.stopServer)();
    }
    catch (error) {
        console.error('[Flo Node] Main server shutdown error:', error);
    }
    try {
        await (0, kds_server_1.stopKdsServer)();
    }
    catch (error) {
        console.error('[Flo Node] KDS server shutdown error:', error);
    }
    try {
        (0, db_1.closeDatabase)();
    }
    catch (error) {
        console.error('[Flo Node] Database shutdown error:', error);
    }
    process.exit(0);
}
process.once('SIGINT', () => {
    void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
});
main().catch((error) => {
    console.error('[Flo Node] Fatal startup error:', error);
    process.exit(1);
});
//# sourceMappingURL=node-server.js.map