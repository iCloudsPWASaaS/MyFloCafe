"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BACKOFF_FACTOR = exports.MAX_RETRY_DELAY_MS = exports.BASE_RETRY_DELAY_MS = exports.MAX_LOAD_RETRIES = exports.TRANSIENT_LOAD_ERRORS = void 0;
exports.calculateRetryDelay = calculateRetryDelay;
exports.isTransientLoadError = isTransientLoadError;
exports.setupWindowLoadRetry = setupWindowLoadRetry;
const main_1 = __importDefault(require("electron-log/main"));
exports.TRANSIENT_LOAD_ERRORS = [-102, -105, -106, -118];
exports.MAX_LOAD_RETRIES = 10;
exports.BASE_RETRY_DELAY_MS = 250;
exports.MAX_RETRY_DELAY_MS = 2000;
exports.BACKOFF_FACTOR = 1.5;
function calculateRetryDelay(attempt, baseDelayMs = exports.BASE_RETRY_DELAY_MS, maxDelayMs = exports.MAX_RETRY_DELAY_MS, factor = exports.BACKOFF_FACTOR) {
    return Math.min(baseDelayMs * Math.pow(factor, attempt), maxDelayMs);
}
function isTransientLoadError(errorCode) {
    return exports.TRANSIENT_LOAD_ERRORS.includes(errorCode);
}
/**
 * Attaches main-frame auto-retry listeners to a window's webContents to recover from
 * transient connection errors (e.g. ERR_CONNECTION_REFUSED (-102), ERR_NAME_NOT_RESOLVED
 * (-105), ERR_INTERNET_DISCONNECTED (-106), ERR_CONNECTION_TIMED_OUT (-118)) during fast
 * restarts or updater relaunches before the embedded server finishes socket binding.
 * Once the bounded retry budget is exhausted, the caller receives a terminal callback.
 */
function setupWindowLoadRetry(window, getTargetUrl, options) {
    let loadRetries = 0;
    let loadRetryTimer = null;
    let exhaustionReported = false;
    const maxRetries = options?.maxRetries ?? exports.MAX_LOAD_RETRIES;
    const transientErrors = options?.transientErrors ?? exports.TRANSIENT_LOAD_ERRORS;
    const getDelay = options?.getRetryDelay ?? calculateRetryDelay;
    const logger = options?.log ?? main_1.default;
    const handleFinishLoad = () => {
        loadRetries = 0;
        exhaustionReported = false;
        if (loadRetryTimer) {
            clearTimeout(loadRetryTimer);
            loadRetryTimer = null;
        }
    };
    const handleFailLoad = (_event, errorCode, errorDescription, validatedURL, isMainFrame = true) => {
        if (!isMainFrame)
            return;
        logger.error('[Window] Failed to load:', errorCode, errorDescription, validatedURL);
        console.error('[Window] Failed to load:', errorCode, errorDescription, validatedURL);
        // Auto-retry transient network errors (e.g. -102 ERR_CONNECTION_REFUSED when
        // Squirrel.Mac or OS relaunch fires before the embedded server finishes socket binding).
        if (transientErrors.includes(errorCode) && loadRetries < maxRetries) {
            loadRetries++;
            const delay = getDelay(loadRetries);
            logger.info(`[Window] Retrying loadURL in ${delay}ms (attempt ${loadRetries}/${maxRetries})...`);
            if (loadRetryTimer)
                clearTimeout(loadRetryTimer);
            loadRetryTimer = setTimeout(() => {
                loadRetryTimer = null;
                if (window && !window.isDestroyed()) {
                    window.loadURL(getTargetUrl());
                }
            }, delay);
        }
        else if (transientErrors.includes(errorCode) && !exhaustionReported) {
            exhaustionReported = true;
            if (loadRetryTimer) {
                clearTimeout(loadRetryTimer);
                loadRetryTimer = null;
            }
            logger.error(`[Window] Exhausted loadURL retries (${maxRetries}) for ${validatedURL || getTargetUrl()}`);
            options?.onRetryExhausted?.({
                errorCode,
                errorDescription,
                validatedURL,
                retries: loadRetries,
            });
        }
    };
    const webContents = window.webContents;
    webContents.on('did-finish-load', handleFinishLoad);
    webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        handleFailLoad(event, typeof errorCode === 'number' ? errorCode : 0, String(errorDescription), typeof validatedURL === 'string' ? validatedURL : undefined, typeof isMainFrame === 'boolean' ? isMainFrame : true);
    });
    return {
        getRetries: () => loadRetries,
        getPendingTimer: () => loadRetryTimer,
        cancel: () => {
            if (loadRetryTimer) {
                clearTimeout(loadRetryTimer);
                loadRetryTimer = null;
            }
        },
        reset: () => {
            loadRetries = 0;
            exhaustionReported = false;
            if (loadRetryTimer) {
                clearTimeout(loadRetryTimer);
                loadRetryTimer = null;
            }
        },
    };
}
//# sourceMappingURL=window-load-retry.js.map