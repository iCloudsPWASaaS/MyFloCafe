import type * as http from 'node:http';
import { type WebSocketServer } from 'ws';
/**
 * A shutdown operation is allowed to drain normally, but a broken resource
 * must not hold the process forever. The timeout is deliberately long enough
 * for ordinary requests while still providing an observable emergency bound.
 */
export declare const SHUTDOWN_TIMEOUT_MS = 10000;
export declare function createShutdownCancellationError(label: string): Error & {
    code: string;
};
type HttpRequestState = {
    controller: AbortController;
    work: Set<Promise<unknown>>;
    released: boolean;
    owner: HttpServerState;
};
type HttpServerState = {
    requests: Set<HttpRequestState>;
    closed: boolean;
};
export declare function installHttpShutdownTracking(server: http.Server): HttpServerState;
export declare function getHttpRequestSignal(request: object): AbortSignal | undefined;
export declare function trackHttpRequestWork<T>(request: object, operation: Promise<T>): Promise<T>;
export type ShutdownStep = {
    name: string;
    run: () => void | Promise<void>;
    blocksDatabase?: boolean;
    databaseClose?: boolean;
};
export type ShutdownCoordinatorOptions = {
    onFatalTimeout?: (error: unknown) => void;
};
export declare function isShutdownTimeout(error: unknown): boolean;
/** Stop accepting HTTP connections and wait for active requests to finish. */
export declare function closeHttpServer(server: http.Server, label: string, timeoutMs?: number): Promise<void>;
export declare function waitForHttpShutdownWork(timeoutMs?: number): Promise<void>;
export declare function cancelHttpShutdownWork(): void;
/** Close WebSocket clients/server and wait for the ws close callback. */
export declare function closeWebSocketServer(wss: WebSocketServer, label: string, timeoutMs?: number): Promise<void>;
/** Close WebSocket resources and listener, waiting for each to settle. */
export declare function closeServerResources(server: http.Server | null, wss: WebSocketServer | null, label: string, timeoutMs?: number): Promise<void>;
/** Run cleanup steps in order until a fatal timeout boundary is reached. */
export declare function runShutdownSteps(steps: readonly ShutdownStep[], options?: ShutdownCoordinatorOptions): Promise<void>;
/**
 * Create an idempotent shutdown operation. Concurrent callers share the same
 * promise, so signal, tray, and Electron quit paths cannot race cleanup.
 */
export declare function createShutdownCoordinator(getSteps: () => readonly ShutdownStep[], options?: ShutdownCoordinatorOptions): () => Promise<void>;
export type ShutdownEvent = {
    preventDefault: () => void;
};
type ShutdownEventListener = (...args: never[]) => unknown;
type ShutdownAppEvent = 'before-quit' | 'will-quit';
type ShutdownProcessEvent = 'SIGINT' | 'SIGTERM' | 'uncaughtException' | 'unhandledRejection';
export type ShutdownEntrypointApp = {
    on: (event: ShutdownAppEvent, listener: ShutdownEventListener) => unknown;
    quit: () => void;
    exit: (code?: number) => void;
};
export type ShutdownEntrypointProcess = {
    on: (event: ShutdownProcessEvent, listener: ShutdownEventListener) => unknown;
    exit: (code?: number) => void;
};
export type ShutdownEntrypointOptions = {
    app: ShutdownEntrypointApp;
    process: ShutdownEntrypointProcess;
    cleanup: () => Promise<void>;
    setQuitting: () => void;
    onShutdownRequested?: () => void;
    destroyWindow: () => void;
    isInstallingUpdate?: () => boolean;
    reportFailure?: (context: 'quit' | 'signal', error: unknown) => void;
    getSignalExitCode?: () => number;
    getQuitExitCode?: () => number;
};
export declare function createShutdownEntrypoints({ app, process, cleanup, setQuitting, onShutdownRequested, destroyWindow, isInstallingUpdate, reportFailure, getSignalExitCode, getQuitExitCode, }: ShutdownEntrypointOptions): {
    runCleanup: () => Promise<void>;
    isShutdownRequested: () => boolean;
    shutdownSignal: AbortSignal;
};
export declare function createExitCodeAwareShutdown(cleanup: () => Promise<number>, options?: {
    onShutdownRequested?: () => void;
    onFatalTimeout?: (error: unknown) => void;
}): (exitCode?: number) => Promise<number>;
export {};
//# sourceMappingURL=shutdown.d.ts.map