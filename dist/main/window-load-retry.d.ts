export declare const TRANSIENT_LOAD_ERRORS: readonly [-102, -105, -106, -118];
export declare const MAX_LOAD_RETRIES = 10;
export declare const BASE_RETRY_DELAY_MS = 250;
export declare const MAX_RETRY_DELAY_MS = 2000;
export declare const BACKOFF_FACTOR = 1.5;
export declare function calculateRetryDelay(attempt: number, baseDelayMs?: number, maxDelayMs?: number, factor?: number): number;
export declare function isTransientLoadError(errorCode: number): boolean;
export interface WindowLoadRetryLogger {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}
export interface WindowLoadRetryOptions {
    maxRetries?: number;
    transientErrors?: readonly number[];
    getRetryDelay?: (attempt: number) => number;
    log?: WindowLoadRetryLogger;
    onRetryExhausted?: (details: WindowLoadRetryExhaustedDetails) => void;
}
export interface WindowLoadRetryExhaustedDetails {
    errorCode: number;
    errorDescription: string;
    validatedURL?: string;
    retries: number;
}
import type { BrowserWindow } from 'electron';
export interface RetryableWebContentsLike {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
}
export interface RetryableWindowLike {
    isDestroyed: () => boolean;
    loadURL: (url: string) => Promise<void> | void;
    webContents: RetryableWebContentsLike;
}
export type RetryableWindow = BrowserWindow | RetryableWindowLike;
export interface WindowLoadRetryController {
    getRetries: () => number;
    getPendingTimer: () => NodeJS.Timeout | null;
    cancel: () => void;
    reset: () => void;
}
/**
 * Attaches main-frame auto-retry listeners to a window's webContents to recover from
 * transient connection errors (e.g. ERR_CONNECTION_REFUSED (-102), ERR_NAME_NOT_RESOLVED
 * (-105), ERR_INTERNET_DISCONNECTED (-106), ERR_CONNECTION_TIMED_OUT (-118)) during fast
 * restarts or updater relaunches before the embedded server finishes socket binding.
 * Once the bounded retry budget is exhausted, the caller receives a terminal callback.
 */
export declare function setupWindowLoadRetry(window: RetryableWindow, getTargetUrl: () => string, options?: WindowLoadRetryOptions): WindowLoadRetryController;
//# sourceMappingURL=window-load-retry.d.ts.map