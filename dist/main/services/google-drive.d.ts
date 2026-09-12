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
export declare const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export declare const DRIVE_BACKUP_FOLDER_NAME = "FloCafe Backups";
export type BackupFrequency = 'daily' | 'weekly';
export type GoogleDriveStatus = {
    configured: boolean;
    secure_storage_available: boolean;
    connected: boolean;
    account_email: string | null;
    frequency: BackupFrequency;
    retention_count: number;
    last_backup_at: string | null;
    last_backup_status: 'success' | 'error' | null;
    last_backup_filename: string | null;
    last_error: string | null;
};
export declare function isGoogleDriveConfigured(): boolean;
/**
 * Pure retention math, split out from applyRetention() so it's unit
 * testable without a real Drive client: given the app-folder's files
 * (oldest-first) and how many to keep, returns the ids to delete.
 */
export declare function computeFilesToDelete(files: {
    id: string;
    createdTime: string;
}[], retentionCount: number): string[];
/**
 * Pure scheduling check, split out for unit testing: is a new Drive backup
 * due given the last successful backup time and the configured frequency?
 */
export declare function isBackupDue(lastBackupAtIso: string | null, frequency: BackupFrequency, nowMs?: number): boolean;
declare class GoogleDriveService {
    private scheduleTimer;
    private backingUp;
    private backupPromise;
    private backupAbortController;
    private stopping;
    private stopPromise;
    private stopSettled;
    private terminalCleanup;
    private activeDriveOperations;
    private shutdownController;
    /** Arms the hourly schedule check. Never makes a network call by itself — see module doc comment. */
    start(): void;
    stop(): Promise<void>;
    private trackDriveOperation;
    private cancelActiveDriveOperations;
    private maybeRunScheduled;
    getStatus(): GoogleDriveStatus;
    updatePreferences(input: {
        frequency?: string;
        retention_count?: number | string;
    }): GoogleDriveStatus;
    /**
     * Explicit opt-in entry point: user clicked "Connect" in Settings. Opens
     * the consent screen in the system browser and waits for the loopback
     * redirect. Throws with a user-facing message if this build has no
     * client credentials configured, or secure storage isn't available.
     */
    connect(signal?: AbortSignal): Promise<GoogleDriveStatus>;
    private connectInternal;
    /** Revokes the token with Google (not just local state) and deletes the encrypted blob. */
    disconnect(): Promise<GoogleDriveStatus>;
    /** Manual "Back up to Drive now" action, and the scheduled path. Reuses createBackup() — no second export path. */
    backupNow(signal?: AbortSignal): Promise<GoogleDriveStatus>;
    private runBackup;
    private getAuthorizedClient;
    private fetchAccountEmail;
    private ensureAppFolder;
    private applyRetention;
    private retentionFromSettings;
    private throwIfStopping;
    private runLoopbackFlow;
    private readTokens;
    private writeTokens;
    private deleteTokens;
    private readSettings;
    private upsertSettings;
}
export declare const googleDrive: GoogleDriveService;
export {};
//# sourceMappingURL=google-drive.d.ts.map