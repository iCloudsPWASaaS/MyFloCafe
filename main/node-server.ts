import { initDatabase, closeDatabase } from './db';
import { startServer, stopServer } from './server';
import { startKdsServer, stopKdsServer } from './kds-server';
import { startServerApp, stopServerApp } from './server-app';

async function main(): Promise<void> {
  console.log('[Flo Node] Initializing database...');
  initDatabase();

  console.log('[Flo Node] Starting main API...');
  await startServer();

  console.log('[Flo Node] Starting KDS...');
  await startKdsServer();

  console.log('[Flo Node] Starting Server App...');
  await startServerApp();

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

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Flo Node] ${signal} - shutting down...`);

  try {
    await stopServerApp();
  } catch (error) {
    console.error('[Flo Node] Server App shutdown error:', error);
  }

  try {
    await stopServer();
  } catch (error) {
    console.error('[Flo Node] Main server shutdown error:', error);
  }

  try {
    await stopKdsServer();
  } catch (error) {
    console.error('[Flo Node] KDS server shutdown error:', error);
  }

  try {
    closeDatabase();
  } catch (error) {
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
