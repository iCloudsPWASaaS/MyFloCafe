"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHUTDOWN_TIMEOUT_MS = void 0;
exports.createShutdownCancellationError = createShutdownCancellationError;
exports.installHttpShutdownTracking = installHttpShutdownTracking;
exports.getHttpRequestSignal = getHttpRequestSignal;
exports.trackHttpRequestWork = trackHttpRequestWork;
exports.isShutdownTimeout = isShutdownTimeout;
exports.closeHttpServer = closeHttpServer;
exports.waitForHttpShutdownWork = waitForHttpShutdownWork;
exports.cancelHttpShutdownWork = cancelHttpShutdownWork;
exports.closeWebSocketServer = closeWebSocketServer;
exports.closeServerResources = closeServerResources;
exports.runShutdownSteps = runShutdownSteps;
exports.createShutdownCoordinator = createShutdownCoordinator;
exports.createShutdownEntrypoints = createShutdownEntrypoints;
exports.createExitCodeAwareShutdown = createExitCodeAwareShutdown;
const ws_1 = require("ws");
/**
 * A shutdown operation is allowed to drain normally, but a broken resource
 * must not hold the process forever. The timeout is deliberately long enough
 * for ordinary requests while still providing an observable emergency bound.
 */
exports.SHUTDOWN_TIMEOUT_MS = 10_000;
function createShutdownCancellationError(label) {
    const error = new Error(`${label} startup cancelled during shutdown`);
    error.code = 'ERR_SHUTDOWN_ABORTED';
    return error;
}
const httpServerStates = new WeakMap();
const trackedHttpServerStates = new Set();
const httpRequestStates = new WeakMap();
const shuttingDownHttpServers = new Set();
function installHttpShutdownTracking(server) {
    const existing = httpServerStates.get(server);
    if (existing)
        return existing;
    const state = { requests: new Set(), closed: false };
    httpServerStates.set(server, state);
    trackedHttpServerStates.add(state);
    server.prependListener('request', (request, response) => {
        const requestState = { controller: new AbortController(), work: new Set(), released: false, owner: state };
        state.requests.add(requestState);
        httpRequestStates.set(request, requestState);
        const release = () => {
            requestState.released = true;
            if (requestState.work.size === 0)
                state.requests.delete(requestState);
        };
        response.once('finish', release);
        response.once('close', release);
    });
    return state;
}
function getHttpRequestSignal(request) {
    return httpRequestStates.get(request)?.controller.signal;
}
function trackHttpRequestWork(request, operation) {
    const requestState = httpRequestStates.get(request);
    if (!requestState)
        return operation;
    requestState.work.add(operation);
    void operation.finally(() => {
        requestState.work.delete(operation);
        if (requestState.released && requestState.work.size === 0) {
            requestState.owner.requests.delete(requestState);
            if (requestState.owner.requests.size === 0) {
                shuttingDownHttpServers.delete(requestState.owner);
                if (requestState.owner.closed)
                    trackedHttpServerStates.delete(requestState.owner);
            }
        }
    }).catch(() => { });
    return operation;
}
async function waitForHttpRequestWork(state) {
    while (true) {
        const work = [...state.requests].flatMap((request) => [...request.work]);
        if (work.length === 0)
            return;
        await Promise.allSettled(work);
    }
}
function abortHttpRequests(state) {
    for (const request of state.requests)
        request.controller.abort();
}
function isAlreadyClosedError(error) {
    const code = error?.code;
    return code === 'ERR_SERVER_NOT_RUNNING' || code === 'ERR_SOCKET_CLOSED';
}
function createTimeoutError(label, timeoutMs) {
    const error = new Error(`${label} shutdown timed out after ${timeoutMs}ms`);
    error.code = 'ERR_SHUTDOWN_TIMEOUT';
    return error;
}
function isShutdownTimeout(error) {
    if (error?.code === 'ERR_SHUTDOWN_TIMEOUT')
        return true;
    return error instanceof AggregateError && error.errors.some((nested) => isShutdownTimeout(nested));
}
async function withShutdownTimeout(operation, label, forceClose, timeoutMs = exports.SHUTDOWN_TIMEOUT_MS) {
    let timeout;
    const timeoutPromise = new Promise((_resolve, reject) => {
        timeout = setTimeout(() => {
            const timeoutError = createTimeoutError(label, timeoutMs);
            try {
                forceClose();
            }
            catch (error) {
                reject(new AggregateError([timeoutError, error], `${label} forced shutdown failed`));
                return;
            }
            reject(timeoutError);
        }, timeoutMs);
    });
    try {
        return await Promise.race([operation, timeoutPromise]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
/** Stop accepting HTTP connections and wait for active requests to finish. */
async function closeHttpServer(server, label, timeoutMs = exports.SHUTDOWN_TIMEOUT_MS) {
    const closableServer = server;
    const requestState = installHttpShutdownTracking(server);
    shuttingDownHttpServers.add(requestState);
    const closeListenerPromise = new Promise((resolve, reject) => {
        try {
            closableServer.close((error) => {
                if (error && !isAlreadyClosedError(error)) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
            // Node closes idle keep-alive sockets as part of close() on modern
            // runtimes. Call the explicit compatibility hook as well so older
            // supported runtimes do not hold shutdown open on idle clients.
            closableServer.closeIdleConnections?.();
        }
        catch (error) {
            if (isAlreadyClosedError(error))
                resolve();
            else
                reject(error);
        }
    });
    const closePromise = Promise.all([closeListenerPromise, waitForHttpRequestWork(requestState)]).then(() => undefined);
    try {
        await withShutdownTimeout(closePromise, label, () => {
            abortHttpRequests(requestState);
            closableServer.closeAllConnections?.();
        }, timeoutMs);
    }
    catch (error) {
        if (error.code !== 'ERR_SHUTDOWN_TIMEOUT')
            throw error;
        try {
            await withShutdownTimeout(waitForHttpRequestWork(requestState), `${label} handler`, () => {
                abortHttpRequests(requestState);
                closableServer.closeAllConnections?.();
            }, timeoutMs);
        }
        catch (drainError) {
            throw new AggregateError([error, drainError], `${label} shutdown failed`);
        }
        throw error;
    }
    finally {
        requestState.closed = true;
        if (requestState.requests.size === 0)
            shuttingDownHttpServers.delete(requestState);
        if (requestState.requests.size === 0)
            trackedHttpServerStates.delete(requestState);
    }
}
async function waitForHttpShutdownWork(timeoutMs = exports.SHUTDOWN_TIMEOUT_MS) {
    const states = [...shuttingDownHttpServers];
    try {
        await withShutdownTimeout(Promise.all(states.map((state) => waitForHttpRequestWork(state))).then(() => undefined), 'HTTP handler cleanup', () => states.forEach(abortHttpRequests), timeoutMs);
    }
    finally {
        for (const state of states) {
            if (state.requests.size === 0)
                shuttingDownHttpServers.delete(state);
        }
    }
}
function cancelHttpShutdownWork() {
    for (const state of trackedHttpServerStates)
        abortHttpRequests(state);
}
function terminateWebSocketClients(wss) {
    for (const client of wss.clients) {
        try {
            client.terminate();
        }
        catch {
            // closeWebSocketServer reports the server-level failure. A client that
            // cannot be terminated cannot be allowed to keep the process alive.
        }
    }
}
function drainWebSocketClients(wss, onError) {
    const clients = [...wss.clients];
    return Promise.all(clients.map((client) => new Promise((resolve) => {
        if (client.readyState === ws_1.WebSocket.CLOSED) {
            resolve();
            return;
        }
        let settled = false;
        const onClientError = (error) => {
            onError(error);
        };
        const finish = () => {
            if (settled)
                return;
            settled = true;
            client.off('close', finish);
            client.off('error', onClientError);
            resolve();
        };
        client.once('close', finish);
        client.once('error', onClientError);
        try {
            if (client.readyState === ws_1.WebSocket.OPEN)
                client.close(1001, 'Server shutting down');
            else
                client.terminate();
        }
        catch (error) {
            onError(error);
            finish();
        }
    }))).then(() => undefined);
}
/** Close WebSocket clients/server and wait for the ws close callback. */
function closeWebSocketServer(wss, label, timeoutMs = exports.SHUTDOWN_TIMEOUT_MS) {
    let clientCloseError;
    const clientsPromise = drainWebSocketClients(wss, (error) => {
        clientCloseError ??= error;
    });
    const serverPromise = new Promise((resolve, reject) => {
        try {
            wss.close((error) => {
                if (error && !isAlreadyClosedError(error)) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        }
        catch (error) {
            if (isAlreadyClosedError(error)) {
                resolve();
            }
            else {
                reject(error);
            }
        }
    });
    const closePromise = Promise.all([serverPromise, clientsPromise]).then(() => {
        if (clientCloseError)
            throw clientCloseError;
    });
    return withShutdownTimeout(closePromise, label, () => terminateWebSocketClients(wss), timeoutMs);
}
/** Close WebSocket resources and listener, waiting for each to settle. */
async function closeServerResources(server, wss, label, timeoutMs = exports.SHUTDOWN_TIMEOUT_MS) {
    const errors = [];
    const closePromises = [];
    if (server) {
        try {
            closePromises.push(closeHttpServer(server, `${label} HTTP`, timeoutMs));
        }
        catch (error) {
            errors.push(error);
        }
    }
    if (wss) {
        try {
            closePromises.push(closeWebSocketServer(wss, `${label} WebSocket`, timeoutMs));
        }
        catch (error) {
            errors.push(error);
        }
    }
    const results = await Promise.allSettled(closePromises);
    for (const result of results) {
        if (result.status === 'rejected')
            errors.push(result.reason);
    }
    if (errors.length > 0) {
        throw new AggregateError(errors, `${label} shutdown failed`);
    }
}
/** Run cleanup steps in order until a fatal timeout boundary is reached. */
async function runShutdownSteps(steps, options = {}) {
    const errors = [];
    let databaseBlocked = false;
    for (const step of steps) {
        if (step.databaseClose && databaseBlocked)
            continue;
        try {
            const stepPromise = Promise.resolve().then(() => step.run());
            await withShutdownTimeout(stepPromise, step.name, () => { }, exports.SHUTDOWN_TIMEOUT_MS);
        }
        catch (error) {
            errors.push(error);
            console.error(`[Shutdown] ${step.name} failed:`, error);
            if (step.blocksDatabase)
                databaseBlocked = true;
            if (isShutdownTimeout(error)) {
                options.onFatalTimeout?.(error);
                throw error;
            }
        }
    }
    if (errors.length > 0) {
        throw new AggregateError(errors, 'Shutdown failed');
    }
}
/**
 * Create an idempotent shutdown operation. Concurrent callers share the same
 * promise, so signal, tray, and Electron quit paths cannot race cleanup.
 */
function createShutdownCoordinator(getSteps, options = {}) {
    let shutdownPromise = null;
    return () => {
        if (!shutdownPromise) {
            shutdownPromise = runShutdownSteps(getSteps(), options);
        }
        return shutdownPromise;
    };
}
function createShutdownEntrypoints({ app, process, cleanup, setQuitting, onShutdownRequested = () => { }, destroyWindow, isInstallingUpdate = () => false, reportFailure = () => { }, getSignalExitCode = () => 0, getQuitExitCode = () => 0, }) {
    let cleanupPromise = null;
    let cleanupFinished = false;
    let quitAfterCleanupRequested = false;
    let shutdownRequested = false;
    let signalExitRequested = false;
    const shutdownController = new AbortController();
    const beginShutdown = () => {
        if (!shutdownRequested) {
            shutdownRequested = true;
            onShutdownRequested();
            shutdownController.abort();
        }
        cancelHttpShutdownWork();
    };
    const requestShutdown = () => {
        beginShutdown();
        setQuitting();
    };
    const runCleanup = () => {
        if (!cleanupPromise) {
            beginShutdown();
            cleanupPromise = Promise.resolve().then(cleanup);
            cleanupPromise.then(() => { cleanupFinished = true; }, () => { cleanupFinished = true; });
        }
        return cleanupPromise;
    };
    const quitAfterCleanup = () => {
        if (quitAfterCleanupRequested)
            return;
        quitAfterCleanupRequested = true;
        requestShutdown();
        void runCleanup().then(() => {
            const exitCode = getQuitExitCode();
            destroyWindow();
            if (isInstallingUpdate())
                return;
            if (exitCode === 0)
                app.quit();
            else
                app.exit(exitCode);
        }, (error) => {
            reportFailure('quit', error);
            if (!isInstallingUpdate()) {
                app.exit(1);
            }
        });
    };
    app.on('before-quit', () => {
        requestShutdown();
    });
    app.on('will-quit', (event) => {
        if (cleanupFinished) {
            destroyWindow();
            return;
        }
        event.preventDefault();
        quitAfterCleanup();
    });
    const exitAfterCleanup = () => {
        if (signalExitRequested) {
            void runCleanup();
            return;
        }
        signalExitRequested = true;
        requestShutdown();
        void runCleanup().then(() => {
            if (isInstallingUpdate())
                return;
            process.exit(getSignalExitCode());
        }, (error) => {
            reportFailure('signal', error);
            if (!isInstallingUpdate()) {
                process.exit(1);
            }
        });
    };
    process.on('SIGTERM', exitAfterCleanup);
    process.on('SIGINT', exitAfterCleanup);
    return { runCleanup, isShutdownRequested: () => shutdownRequested, shutdownSignal: shutdownController.signal };
}
function createExitCodeAwareShutdown(cleanup, options = {}) {
    let shutdownPromise = null;
    let requestedExitCode = 0;
    return (exitCode = 0) => {
        requestedExitCode = Math.max(requestedExitCode, exitCode);
        if (!shutdownPromise) {
            options.onShutdownRequested?.();
            cancelHttpShutdownWork();
            shutdownPromise = (async () => {
                try {
                    const cleanupExitCode = await cleanup();
                    return Math.max(cleanupExitCode, requestedExitCode);
                }
                catch (error) {
                    if (isShutdownTimeout(error))
                        options.onFatalTimeout?.(error);
                    throw error;
                }
            })();
        }
        return shutdownPromise;
    };
}
//# sourceMappingURL=shutdown.js.map