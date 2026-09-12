"use strict";
/**
 * Optional Google Drive integration for automated, off-device DB backups (#129).
 *
 * Follows the same explicit-opt-in shape as cloud-sync.ts: nothing in this
 * module ever talks to Google until the owner clicks "Connect" in
 * Settings > Integrations > Google Drive. Until then `start()` only arms a
 * timer that no-ops (readTokens() returns null) — no network call, no
 * background request.
 *
 * OAuth: standard "installed app" loopback flow (Google's recommended
 * pattern for desktop apps) — open the consent screen in the system browser
 * via shell.openExternal and catch the redirect on a local HTTP server bound
 * to a random port, rather than embedding a webview. Scope is restricted to
 * `drive.file` (least privilege — the app only ever sees files it created).
 *
 * Tokens are OS-encrypted via Electron's safeStorage (same pattern as
 * master-pin.ts) and stored in their own file — never in the SQLite DB.
 *
 * Backups reuse `createBackup()` from db.ts unmodified — no second export
 * path that could skip the redaction already applied to /api/db/export.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleDrive = exports.DRIVE_BACKUP_FOLDER_NAME = exports.DRIVE_FILE_SCOPE = void 0;
exports.isGoogleDriveConfigured = isGoogleDriveConfigured;
exports.computeFilesToDelete = computeFilesToDelete;
exports.isBackupDue = isBackupDue;
const electron_1 = require("electron");
const url_allowlist_1 = require("../security/url-allowlist");
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const electron_log_1 = __importDefault(require("electron-log"));
const drive_1 = require("@googleapis/drive");
const db_1 = require("../db");
const shutdown_1 = require("../shutdown");
exports.DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
exports.DRIVE_BACKUP_FOLDER_NAME = 'FloCafe Backups';
const DEFAULT_RETENTION = 10;
const MIN_RETENTION = 1;
const MAX_RETENTION = 100;
const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 60_000; // hourly, same cadence as telemetry's daily-ping check
const LOOPBACK_TIMEOUT_MS = 5 * 60_000;
const DRIVE_REQUEST_TIMEOUT_MS = 10_000;
function requestSignal(signal, timeoutMs) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}
function createDriveShutdownError(label, timedOut = false) {
    const error = new Error(`${label} ${timedOut ? 'timed out' : 'cancelled'} during shutdown`);
    error.code = timedOut ? 'ERR_SHUTDOWN_TIMEOUT' : 'ERR_SHUTDOWN_ABORTED';
    return error;
}
function isExpectedShutdownCancellation(error) {
    if (error instanceof AggregateError) {
        return error.errors.length > 0 && error.errors.every((nested) => isExpectedShutdownCancellation(nested));
    }
    const candidate = error;
    return candidate?.code === 'ERR_SHUTDOWN_ABORTED'
        || candidate?.code === 'ABORT_ERR'
        || candidate?.name === 'AbortError';
}
function cancelDriveOperation(operation) {
    const cancellable = operation;
    try {
        if (typeof cancellable.cancel === 'function')
            cancellable.cancel();
        else if (typeof cancellable.abort === 'function')
            cancellable.abort();
    }
    catch { }
}
function waitForDriveOperation(operationFactory, signal, timeoutMs, label, trackOperation, joinOnCancellation = () => false) {
    if (signal?.aborted)
        return Promise.reject(createDriveShutdownError(label));
    const operationController = new AbortController();
    const operationSignal = signal ? AbortSignal.any([signal, operationController.signal]) : operationController.signal;
    let operation;
    try {
        operation = operationFactory(operationSignal);
    }
    catch (error) {
        return Promise.reject(error);
    }
    trackOperation?.(operation);
    let timeout;
    let cancellationTimeout;
    let onAbort;
    let operationSettled = false;
    let cancellationStarted = false;
    void operation.then(() => { operationSettled = true; }, () => { operationSettled = true; });
    void operation.catch(() => { });
    const cancellation = new Promise((_resolve, reject) => {
        const rejectAfterOperation = (error) => {
            if (cancellationStarted || operationSettled)
                return;
            cancellationStarted = true;
            operationController.abort();
            cancelDriveOperation(operation);
            if (!joinOnCancellation()) {
                reject(error);
                return;
            }
            const settleCancellation = () => {
                if (cancellationTimeout)
                    clearTimeout(cancellationTimeout);
                reject(error);
            };
            cancellationTimeout = setTimeout(settleCancellation, timeoutMs);
            void operation.then(settleCancellation, settleCancellation);
        };
        const abort = () => rejectAfterOperation(createDriveShutdownError(label));
        onAbort = abort;
        if (signal?.aborted) {
            abort();
            return;
        }
        if (signal)
            signal.addEventListener('abort', abort, { once: true });
        timeout = setTimeout(() => {
            rejectAfterOperation(createDriveShutdownError(label, true));
        }, timeoutMs);
    });
    return Promise.race([operation, cancellation]).finally(() => {
        if (timeout)
            clearTimeout(timeout);
        if (cancellationTimeout)
            clearTimeout(cancellationTimeout);
        if (signal && onAbort)
            signal.removeEventListener('abort', onAbort);
    });
}
function getTokenFilePath() {
    return path.join(electron_1.app.getPath('userData'), 'google-drive-token.enc');
}
/** Reads GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET — set at build/run time by whoever ships this build. See docs/google-drive-setup.md. */
function getClientCredentials() {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret)
        return null;
    return { clientId, clientSecret };
}
function isGoogleDriveConfigured() {
    return getClientCredentials() !== null;
}
function isSecureStorageAvailable() {
    try {
        return electron_1.safeStorage.isEncryptionAvailable();
    }
    catch {
        return false;
    }
}
/**
 * Pure retention math, split out from applyRetention() so it's unit
 * testable without a real Drive client: given the app-folder's files
 * (oldest-first) and how many to keep, returns the ids to delete.
 */
function computeFilesToDelete(files, retentionCount) {
    const sorted = [...files].sort((a, b) => a.createdTime.localeCompare(b.createdTime));
    if (sorted.length <= retentionCount)
        return [];
    return sorted.slice(0, sorted.length - retentionCount).map((f) => f.id);
}
/**
 * Pure scheduling check, split out for unit testing: is a new Drive backup
 * due given the last successful backup time and the configured frequency?
 */
function isBackupDue(lastBackupAtIso, frequency, nowMs = Date.now()) {
    if (!lastBackupAtIso)
        return true;
    const last = new Date(lastBackupAtIso).getTime();
    if (Number.isNaN(last))
        return true;
    const intervalMs = frequency === 'weekly' ? WEEK_MS : DAY_MS;
    return nowMs - last >= intervalMs;
}
class GoogleDriveService {
    scheduleTimer = null;
    backingUp = false;
    backupPromise = null;
    backupAbortController = null;
    stopping = false;
    stopPromise = null;
    stopSettled = true;
    terminalCleanup = false;
    activeDriveOperations = new Set();
    shutdownController = new AbortController();
    /** Arms the hourly schedule check. Never makes a network call by itself — see module doc comment. */
    start() {
        if (this.terminalCleanup || !this.stopSettled)
            return;
        if (this.scheduleTimer) {
            clearInterval(this.scheduleTimer);
            this.scheduleTimer = null;
        }
        this.stopping = false;
        this.stopPromise = null;
        this.shutdownController = new AbortController();
        this.scheduleTimer = setInterval(() => void this.maybeRunScheduled(), SCHEDULE_CHECK_INTERVAL_MS);
    }
    stop() {
        if (this.stopPromise)
            return this.stopPromise;
        this.stopping = true;
        this.stopSettled = false;
        this.shutdownController.abort();
        this.backupAbortController?.abort();
        if (this.scheduleTimer) {
            clearInterval(this.scheduleTimer);
            this.scheduleTimer = null;
        }
        if (!this.backupPromise && this.activeDriveOperations.size === 0) {
            this.stopSettled = true;
            this.stopPromise = Promise.resolve();
            return this.stopPromise;
        }
        const waitForWork = async () => {
            const errors = [];
            while (this.backupPromise || this.activeDriveOperations.size > 0) {
                const work = [...this.activeDriveOperations];
                if (this.backupPromise)
                    work.push(this.backupPromise);
                const results = await Promise.allSettled(work);
                for (const result of results) {
                    if (result.status === 'rejected')
                        errors.push(result.reason);
                }
            }
            if (errors.length > 0)
                throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'Google Drive work failed');
        };
        const backup = waitForWork();
        void backup.catch(() => { });
        this.stopPromise = new Promise((resolve, reject) => {
            let settled = false;
            const timeout = setTimeout(() => {
                this.terminalCleanup = true;
                this.backupAbortController?.abort();
                this.cancelActiveDriveOperations();
                settled = true;
                clearTimeout(timeout);
                const timeoutError = new Error(`Google Drive shutdown timed out after ${shutdown_1.SHUTDOWN_TIMEOUT_MS}ms`);
                timeoutError.code = 'ERR_SHUTDOWN_TIMEOUT';
                reject(timeoutError);
            }, shutdown_1.SHUTDOWN_TIMEOUT_MS);
            backup.then(() => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                this.stopSettled = true;
                resolve();
            }, (error) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                this.stopSettled = true;
                if (this.stopping && isExpectedShutdownCancellation(error))
                    resolve();
                else
                    reject(error);
            });
        });
        return this.stopPromise;
    }
    trackDriveOperation(operation) {
        this.activeDriveOperations.add(operation);
        void operation.finally(() => {
            this.activeDriveOperations.delete(operation);
            if (this.terminalCleanup && !this.backupPromise && this.activeDriveOperations.size === 0)
                this.stopSettled = true;
        }).catch(() => { });
    }
    cancelActiveDriveOperations() {
        for (const operation of this.activeDriveOperations)
            cancelDriveOperation(operation);
    }
    async maybeRunScheduled() {
        if (this.stopping)
            return;
        const tokens = this.readTokens();
        if (!tokens)
            return; // never connected, or disconnected — stay silent
        const settings = this.readSettings();
        const frequency = settings.google_drive_frequency === 'weekly' ? 'weekly' : 'daily';
        if (!isBackupDue(settings.google_drive_last_backup_at || null, frequency))
            return;
        try {
            await this.backupNow();
        }
        catch (err) {
            electron_log_1.default.warn('[GoogleDrive] scheduled backup failed', err.message);
        }
    }
    getStatus() {
        const settings = this.readSettings();
        const tokens = this.readTokens();
        return {
            configured: isGoogleDriveConfigured(),
            secure_storage_available: isSecureStorageAvailable(),
            connected: Boolean(tokens),
            account_email: settings.google_drive_account_email || null,
            frequency: settings.google_drive_frequency === 'weekly' ? 'weekly' : 'daily',
            retention_count: this.retentionFromSettings(settings),
            last_backup_at: settings.google_drive_last_backup_at || null,
            last_backup_status: settings.google_drive_last_backup_status || null,
            last_backup_filename: settings.google_drive_last_backup_filename || null,
            last_error: settings.google_drive_last_error || null,
        };
    }
    updatePreferences(input) {
        const updates = {};
        if (input.frequency !== undefined) {
            if (input.frequency !== 'daily' && input.frequency !== 'weekly') {
                throw new Error('frequency must be "daily" or "weekly"');
            }
            updates.google_drive_frequency = input.frequency;
        }
        if (input.retention_count !== undefined) {
            const n = Number(input.retention_count);
            if (!Number.isInteger(n) || n < MIN_RETENTION || n > MAX_RETENTION) {
                throw new Error(`retention_count must be an integer between ${MIN_RETENTION} and ${MAX_RETENTION}`);
            }
            updates.google_drive_retention_count = String(n);
        }
        this.upsertSettings(updates);
        return this.getStatus();
    }
    /**
     * Explicit opt-in entry point: user clicked "Connect" in Settings. Opens
     * the consent screen in the system browser and waits for the loopback
     * redirect. Throws with a user-facing message if this build has no
     * client credentials configured, or secure storage isn't available.
     */
    async connect(signal) {
        if (this.stopping)
            throw new Error('Google Drive is stopping');
        const operationSignal = signal
            ? AbortSignal.any([signal, this.shutdownController.signal])
            : this.shutdownController.signal;
        const operation = this.connectInternal(operationSignal);
        this.trackDriveOperation(operation);
        return operation;
    }
    async connectInternal(signal) {
        const creds = getClientCredentials();
        if (!creds) {
            throw new Error('Google Drive integration is not configured for this build');
        }
        if (!isSecureStorageAvailable()) {
            throw new Error('Secure storage is not available on this device — cannot safely store the Google Drive connection');
        }
        const { code, redirectUri } = await this.runLoopbackFlow(creds, signal);
        this.throwIfStopping(signal);
        const client = new drive_1.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
        const { tokens } = await waitForDriveOperation(() => client.getToken(code), signal, DRIVE_REQUEST_TIMEOUT_MS, 'Google Drive token exchange', (operation) => this.trackDriveOperation(operation), () => this.stopping);
        this.throwIfStopping(signal);
        if (!tokens.refresh_token) {
            // Google only issues a refresh_token on first consent (or with prompt=consent,
            // which we always pass) — without it we can't run unattended scheduled backups.
            throw new Error('Google did not return a refresh token. Revoke FloCafe access at myaccount.google.com/permissions and try connecting again.');
        }
        this.writeTokens(tokens);
        client.setCredentials(tokens);
        let email = null;
        try {
            email = await this.fetchAccountEmail(client, signal);
        }
        catch (err) {
            if (this.stopping || signal.aborted)
                throw err;
            electron_log_1.default.warn('[GoogleDrive] could not fetch account email', err.message);
        }
        let folderId = null;
        try {
            const driveClient = (0, drive_1.drive)({ version: 'v3', auth: client });
            folderId = await this.ensureAppFolder(driveClient, signal);
        }
        catch (err) {
            if (this.stopping || signal.aborted)
                throw err;
            electron_log_1.default.warn('[GoogleDrive] could not prepare app folder', err.message);
        }
        this.throwIfStopping(signal);
        this.upsertSettings({
            google_drive_account_email: email || '',
            google_drive_folder_id: folderId || '',
            google_drive_last_error: '',
        });
        return this.getStatus();
    }
    /** Revokes the token with Google (not just local state) and deletes the encrypted blob. */
    async disconnect() {
        const tokens = this.readTokens();
        if (tokens) {
            const tokenToRevoke = tokens.refresh_token || tokens.access_token;
            if (tokenToRevoke) {
                try {
                    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        signal: AbortSignal.timeout(8_000),
                    });
                }
                catch (err) {
                    // Local disconnect must still proceed even if Google's revoke endpoint
                    // is unreachable — the encrypted token is deleted below regardless.
                    electron_log_1.default.warn('[GoogleDrive] revoke request failed (disconnecting locally anyway)', err.message);
                }
            }
        }
        this.deleteTokens();
        this.upsertSettings({
            google_drive_account_email: '',
            google_drive_folder_id: '',
            google_drive_last_backup_at: '',
            google_drive_last_backup_status: '',
            google_drive_last_backup_filename: '',
            google_drive_last_error: '',
        });
        return this.getStatus();
    }
    /** Manual "Back up to Drive now" action, and the scheduled path. Reuses createBackup() — no second export path. */
    async backupNow(signal) {
        if (this.stopping)
            throw new Error('Google Drive is stopping');
        if (this.backingUp)
            return this.getStatus();
        this.backingUp = true;
        const abortController = new AbortController();
        this.backupAbortController = abortController;
        const operationSignal = signal ? AbortSignal.any([signal, abortController.signal]) : abortController.signal;
        const operation = this.runBackup(operationSignal);
        this.backupPromise = operation;
        try {
            return await operation;
        }
        finally {
            this.backingUp = false;
            this.backupPromise = null;
            if (this.backupAbortController === abortController)
                this.backupAbortController = null;
            if (this.terminalCleanup && this.activeDriveOperations.size === 0)
                this.stopSettled = true;
        }
    }
    async runBackup(signal) {
        try {
            const client = await this.getAuthorizedClient(signal);
            this.throwIfStopping(signal);
            const driveClient = (0, drive_1.drive)({ version: 'v3', auth: client });
            const folderId = await this.ensureAppFolder(driveClient, signal);
            this.throwIfStopping(signal);
            const { path: backupPath } = await waitForDriveOperation((operationSignal) => (0, db_1.createBackup)(undefined, operationSignal), signal, shutdown_1.SHUTDOWN_TIMEOUT_MS, 'Google Drive local backup', (operation) => this.trackDriveOperation(operation), () => this.stopping);
            const fileName = path.basename(backupPath);
            this.throwIfStopping(signal);
            await driveClient.files.create({
                requestBody: { name: fileName, parents: [folderId] },
                media: { mimeType: 'application/x-sqlite3', body: fs.createReadStream(backupPath) },
                fields: 'id',
            }, { signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS), timeout: DRIVE_REQUEST_TIMEOUT_MS });
            this.throwIfStopping(signal);
            await this.applyRetention(driveClient, folderId, signal);
            this.throwIfStopping(signal);
            this.upsertSettings({
                google_drive_folder_id: folderId,
                google_drive_last_backup_at: new Date().toISOString(),
                google_drive_last_backup_status: 'success',
                google_drive_last_backup_filename: fileName,
                google_drive_last_error: '',
            });
            return this.getStatus();
        }
        catch (err) {
            if (this.stopping)
                throw err;
            const message = err.message;
            this.upsertSettings({
                google_drive_last_backup_status: 'error',
                google_drive_last_error: message,
            });
            throw err;
        }
    }
    // ── Drive helpers ──────────────────────────────────────────────────────
    async getAuthorizedClient(signal) {
        if (signal?.aborted)
            throw createDriveShutdownError('Google Drive operation');
        const creds = getClientCredentials();
        if (!creds)
            throw new Error('Google Drive integration is not configured for this build');
        const tokens = this.readTokens();
        if (!tokens)
            throw new Error('Google Drive is not connected');
        const client = new drive_1.auth.OAuth2(creds.clientId, creds.clientSecret);
        client.setCredentials(tokens);
        // google-auth-library refreshes the access token transparently using the
        // refresh_token when it's expired; persist whatever it hands back so the
        // next scheduled run doesn't have to refresh again.
        client.on('tokens', (refreshed) => {
            if (this.stopping || this.terminalCleanup || signal?.aborted)
                return;
            const merged = { ...this.readTokens(), ...refreshed };
            this.writeTokens(merged);
        });
        return client;
    }
    async fetchAccountEmail(client, signal) {
        const accessToken = (await waitForDriveOperation(() => client.getAccessToken(), signal, DRIVE_REQUEST_TIMEOUT_MS, 'Google Drive access token refresh', (operation) => this.trackDriveOperation(operation), () => this.stopping)).token;
        if (!accessToken)
            return null;
        const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: requestSignal(signal, 8_000),
        });
        this.throwIfStopping(signal);
        if (!res.ok)
            return null;
        const data = (await res.json().catch(() => ({})));
        this.throwIfStopping(signal);
        return data.email || null;
    }
    async ensureAppFolder(driveClient, signal) {
        this.throwIfStopping(signal);
        const existingId = this.readSettings().google_drive_folder_id;
        if (existingId) {
            // Confirm it still exists / is still visible to this scope before reusing it.
            try {
                const res = await driveClient.files.get({ fileId: existingId, fields: 'id, trashed' }, { signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS), timeout: DRIVE_REQUEST_TIMEOUT_MS });
                this.throwIfStopping(signal);
                if (res.data.id && !res.data.trashed)
                    return res.data.id;
            }
            catch {
                // fall through and re-resolve / recreate below
            }
            this.throwIfStopping(signal);
        }
        const found = await driveClient.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and name='${exports.DRIVE_BACKUP_FOLDER_NAME}' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1,
        }, { signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS), timeout: DRIVE_REQUEST_TIMEOUT_MS });
        this.throwIfStopping(signal);
        const existing = found.data.files?.[0]?.id;
        if (existing)
            return existing;
        const created = await driveClient.files.create({
            requestBody: { name: exports.DRIVE_BACKUP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
            fields: 'id',
        }, { signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS), timeout: DRIVE_REQUEST_TIMEOUT_MS });
        this.throwIfStopping(signal);
        if (!created.data.id)
            throw new Error('Google Drive did not return a folder id');
        return created.data.id;
    }
    async applyRetention(driveClient, folderId, signal) {
        this.throwIfStopping(signal);
        const retention = this.retentionFromSettings(this.readSettings());
        const files = [];
        let pageToken;
        do {
            const res = await driveClient.files.list({
                q: `'${folderId}' in parents and trashed=false`,
                fields: 'nextPageToken, files(id, name, createdTime)',
                orderBy: 'createdTime',
                pageSize: 1000,
                pageToken,
                spaces: 'drive',
            }, { signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS), timeout: DRIVE_REQUEST_TIMEOUT_MS });
            this.throwIfStopping(signal);
            files.push(...(res.data.files || [])
                .filter((f) => Boolean(f.id && f.createdTime))
                .map((f) => ({ id: f.id, createdTime: f.createdTime })));
            pageToken = res.data.nextPageToken || undefined;
        } while (pageToken);
        const toDelete = computeFilesToDelete(files, retention);
        // Keep a small bounded concurrency window: retention can involve many
        // files, but serial deletion needlessly prolongs backup completion.
        for (let i = 0; i < toDelete.length; i += 5) {
            await Promise.all(toDelete.slice(i, i + 5).map(async (id) => {
                try {
                    this.throwIfStopping(signal);
                    await driveClient.files.delete({ fileId: id }, { signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS), timeout: DRIVE_REQUEST_TIMEOUT_MS });
                }
                catch (err) {
                    if (this.stopping || signal.aborted)
                        throw err;
                    electron_log_1.default.warn('[GoogleDrive] retention delete failed', id, err.message);
                }
            }));
        }
    }
    retentionFromSettings(settings) {
        const parsed = parseInt(settings.google_drive_retention_count || '', 10);
        if (Number.isInteger(parsed) && parsed >= MIN_RETENTION && parsed <= MAX_RETENTION)
            return parsed;
        return DEFAULT_RETENTION;
    }
    throwIfStopping(signal) {
        if (signal?.aborted || this.stopping || this.terminalCleanup) {
            throw createDriveShutdownError('Google Drive operation');
        }
    }
    // ── Loopback OAuth flow ────────────────────────────────────────────────
    runLoopbackFlow(creds, signal) {
        return new Promise((resolve, reject) => {
            const state = crypto.randomBytes(16).toString('hex');
            let settled = false;
            let redirectUri = '';
            let abort = () => { };
            const finish = (fn) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                signal?.removeEventListener('abort', abort);
                try {
                    server.close();
                }
                catch { /* already closing */ }
                fn();
            };
            abort = () => finish(() => reject(createDriveShutdownError('Google Drive connection')));
            const server = http.createServer((req, res) => {
                let reqUrl;
                try {
                    reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
                }
                catch {
                    res.writeHead(400).end();
                    return;
                }
                if (reqUrl.pathname !== '/oauth2callback') {
                    res.writeHead(404).end();
                    return;
                }
                const error = reqUrl.searchParams.get('error');
                const code = reqUrl.searchParams.get('code');
                const returnedState = reqUrl.searchParams.get('state');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(error || !code || returnedState !== state
                    ? '<html><body>Google Drive connection failed. You can close this window and try again in Flo Cafe.</body></html>'
                    : '<html><body>Google Drive connected. You can close this window and return to Flo Cafe.</body></html>');
                if (error)
                    return finish(() => reject(new Error(`Google authorization failed: ${error}`)));
                if (!code || returnedState !== state)
                    return finish(() => reject(new Error('Invalid Google OAuth callback')));
                finish(() => resolve({ code, redirectUri }));
            });
            const timeout = setTimeout(() => {
                finish(() => reject(new Error('Timed out waiting for Google authorization')));
            }, LOOPBACK_TIMEOUT_MS);
            if (signal?.aborted) {
                abort();
                return;
            }
            signal?.addEventListener('abort', abort, { once: true });
            server.on('error', (err) => finish(() => reject(err)));
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                const port = typeof address === 'object' && address ? address.port : 0;
                redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
                const authClient = new drive_1.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
                const authUrl = authClient.generateAuthUrl({
                    access_type: 'offline',
                    prompt: 'consent',
                    scope: [exports.DRIVE_FILE_SCOPE],
                    state,
                });
                if (!(0, url_allowlist_1.isSafeExternalUrl)(authUrl)) {
                    return finish(() => reject(new Error('Generated OAuth URL uses an unsafe protocol')));
                }
                electron_1.shell.openExternal(authUrl).catch((err) => finish(() => reject(err)));
            });
        });
    }
    // ── Encrypted token storage (safeStorage, same pattern as master-pin.ts) ─
    readTokens() {
        try {
            const filePath = getTokenFilePath();
            if (!fs.existsSync(filePath))
                return null;
            const encrypted = fs.readFileSync(filePath);
            const decrypted = electron_1.safeStorage.decryptString(encrypted);
            const tokens = JSON.parse(decrypted);
            if (!tokens || (!tokens.access_token && !tokens.refresh_token))
                return null;
            return tokens;
        }
        catch {
            return null;
        }
    }
    writeTokens(tokens) {
        const encrypted = electron_1.safeStorage.encryptString(JSON.stringify(tokens));
        fs.writeFileSync(getTokenFilePath(), encrypted, { mode: 0o600 });
    }
    deleteTokens() {
        try {
            const filePath = getTokenFilePath();
            if (fs.existsSync(filePath))
                fs.unlinkSync(filePath);
        }
        catch (err) {
            electron_log_1.default.warn('[GoogleDrive] failed to delete stored token', err.message);
        }
    }
    // ── Settings (non-secret prefs only — tokens never touch the DB) ────────
    readSettings() {
        const db = (0, db_1.getDatabase)();
        const rows = db.prepare('SELECT key, value FROM settings').all();
        const s = {};
        for (const row of rows)
            s[row.key] = row.value;
        return s;
    }
    upsertSettings(entries) {
        if (Object.keys(entries).length === 0)
            return;
        const db = (0, db_1.getDatabase)();
        const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
        for (const [key, value] of Object.entries(entries)) {
            if (value !== undefined)
                stmt.run(key, value, (0, db_1.now)());
        }
    }
}
exports.googleDrive = new GoogleDriveService();
//# sourceMappingURL=google-drive.js.map