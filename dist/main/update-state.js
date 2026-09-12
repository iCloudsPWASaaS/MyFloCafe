"use strict";
/**
 * Update-state model for the app self-updater (#467, child of epic #463).
 *
 * This module is intentionally pure (no Electron imports) so the state
 * machine can be unit-tested exhaustively. `main/index.ts` owns the single
 * `StoredUpdateStatus` instance and persists/broadcasts every transition
 * through it.
 *
 * Invariants enforced here:
 *  - An error is NEVER classified as `up-to-date`. The historical substring
 *    mask ("404" / "Cannot find latest" / "ENOENT" => up to date) hid real
 *    check failures from users; those now map to honest failure states.
 *  - One-shot startup states (`store-managed`, `linux-managed`, `dev-mode`)
 *    live in the same stored state as runtime states, so a renderer reload
 *    recovers them via `get-update-status` instead of racing a push event.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPDATE_STATES = void 0;
exports.isDevelopmentOrUnpackedArtifact = isDevelopmentOrUnpackedArtifact;
exports.isMissingUpdateConfigError = isMissingUpdateConfigError;
exports.classifyUpdateError = classifyUpdateError;
exports.initialUpdateState = initialUpdateState;
exports.isOneShotUpdateState = isOneShotUpdateState;
exports.oneShotUpdateState = oneShotUpdateState;
exports.missingUpdateConfigState = missingUpdateConfigState;
exports.isInstallReady = isInstallReady;
exports.isUpdateCheckInFlight = isUpdateCheckInFlight;
exports.toIpcUpdateStatus = toIpcUpdateStatus;
/** Every state the updater can be in. Do not add states beyond this list without an approved issue. */
exports.UPDATE_STATES = [
    'not-checked-yet',
    'checking',
    'up-to-date',
    'available',
    'downloading',
    'ready-to-install',
    'check-failed',
    'offline',
    'store-managed',
    'linux-managed',
    'dev-mode',
];
function isDevelopmentOrUnpackedArtifact(artifact) {
    return artifact.defaultApp || !artifact.packaged || artifact.unpackedMarker;
}
/**
 * Node/network error codes that mean "we could not reach the update server".
 * electron-updater surfaces underlying HTTP/DNS failures with these codes.
 */
const NETWORK_ERROR_CODES = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ERR_NAME_NOT_RESOLVED',
    'ERR_TIMED_OUT',
    'ERR_ADDRESS_UNREACHABLE',
    'ERR_PROXY_CONNECTION_FAILED',
]);
const NETWORK_ERROR_CODE_PATTERN = /^(?:ERR_NETWORK_|ERR_INTERNET_|ERR_CONNECTION_)/;
/** electron-updater-specific code for a missing/unreachable latest.yml channel manifest. */
const CHANNEL_FILE_NOT_FOUND = 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND';
const MISSING_UPDATE_CONFIG_PATTERN = /(?:\bENOENT\b|no such file|file not found|cannot find).*app-update\.yml|app-update\.yml.*(?:\bENOENT\b|no such file|file not found)/i;
function errorCode(err) {
    if (typeof err === 'object' && err !== null && 'code' in err) {
        const code = err.code;
        if (typeof code === 'string')
            return code;
    }
    return undefined;
}
function errorMessage(err) {
    if (err instanceof Error && err.message)
        return err.message;
    if (typeof err === 'object' && err !== null && 'message' in err) {
        const message = err.message;
        if (typeof message === 'string' && message)
            return message;
    }
    return String(err);
}
function isMissingUpdateConfigError(err) {
    return errorCode(err) === 'ENOENT';
}
/**
 * Classify an electron-updater error into an honest user-facing state.
 *
 * Network errors are classified before phase-specific failures, and download
 * failures are classified before check-time manifest failures.
 */
function classifyUpdateError(err, phase = 'check') {
    const detail = errorMessage(err);
    const code = errorCode(err);
    // Network class: DNS/routing/timeouts mean offline, not a broken build.
    if ((code !== undefined && (NETWORK_ERROR_CODES.has(code) || NETWORK_ERROR_CODE_PATTERN.test(code))) ||
        /ENOTFOUND|ERR_NETWORK_[A-Z_]+|ERR_INTERNET_[A-Z_]+|ERR_CONNECTION_[A-Z_]+|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|ERR_PROXY_CONNECTION_FAILED|getaddrinfo|network.*(unreachable|timeout)|socket hang up/i.test(detail)) {
        return { state: 'offline', reason: 'unknown', detail };
    }
    if (phase === 'download') {
        return { state: 'check-failed', reason: 'download-failed', detail };
    }
    // Manifest-missing class: no channel file (latest.yml) or no release
    // artifacts published for this channel yet.
    if (code === CHANNEL_FILE_NOT_FOUND ||
        code === 'ENOENT' ||
        /\b404\b|Cannot find latest/i.test(detail) ||
        MISSING_UPDATE_CONFIG_PATTERN.test(detail)) {
        return { state: 'check-failed', reason: 'manifest-missing', detail };
    }
    return { state: 'check-failed', reason: 'unknown', detail };
}
/** Initial stored state before any check has ever run. */
function initialUpdateState() {
    return { status: 'not-checked-yet' };
}
const ONE_SHOT_STATES = ['store-managed', 'linux-managed', 'dev-mode'];
function isOneShotUpdateState(state) {
    return ONE_SHOT_STATES.includes(state);
}
/**
 * Build the stored state for a one-shot startup detection (store build,
 * Linux package-manager install, dev/unpacked build). These states persist
 * until something explicitly replaces them and must survive renderer
 * reloads, which is why they go through the same store as runtime states.
 */
function oneShotUpdateState(state) {
    return { status: state };
}
function missingUpdateConfigState(isDevelopmentArtifact, detail) {
    return isDevelopmentArtifact
        ? oneShotUpdateState('dev-mode')
        : { status: 'check-failed', reason: 'manifest-missing', error: detail };
}
function isInstallReady(stored, stagedUpdateReady) {
    return stagedUpdateReady || stored.status === 'ready-to-install';
}
function isUpdateCheckInFlight(stored, phase) {
    return stored.status === 'checking' || phase === 'download';
}
/**
 * Derive the IPC response from the stored state. The renderer recovers the
 * real persisted state (including one-shot states and failures) on every
 * load instead of waiting for the next push event.
 */
function toIpcUpdateStatus(stored, currentVersion) {
    return {
        status: stored.status,
        ...(stored.version !== undefined ? { version: stored.version } : {}),
        ...(stored.percent !== undefined ? { percent: stored.percent } : {}),
        ...(stored.reason !== undefined ? { reason: stored.reason } : {}),
        ...(stored.error !== undefined ? { error: stored.error } : {}),
        info: { version: currentVersion },
    };
}
//# sourceMappingURL=update-state.js.map