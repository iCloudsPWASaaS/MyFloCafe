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
/** Every state the updater can be in. Do not add states beyond this list without an approved issue. */
export declare const UPDATE_STATES: readonly ["not-checked-yet", "checking", "up-to-date", "available", "downloading", "ready-to-install", "check-failed", "offline", "store-managed", "linux-managed", "dev-mode"];
export type UpdateState = (typeof UPDATE_STATES)[number];
export interface RuntimeArtifactDescriptor {
    defaultApp: boolean;
    packaged: boolean;
    unpackedMarker: boolean;
}
export declare function isDevelopmentOrUnpackedArtifact(artifact: RuntimeArtifactDescriptor): boolean;
/** Why a check or download failed, when known. */
export type UpdateFailureReason = 'manifest-missing' | 'download-failed' | 'unknown';
/**
 * Which updater phase an error occurred in. electron-updater funnels both
 * check-time and download-time failures into its single `error` event, so
 * the caller tracks the current phase to disambiguate them.
 */
export type UpdateErrorPhase = 'check' | 'download';
export interface StoredUpdateStatus {
    status: UpdateState;
    /** Version of the available/downloaded update (not the running version). */
    version?: string;
    releaseDate?: string;
    releaseNotes?: unknown;
    percent?: number;
    reason?: UpdateFailureReason;
    /** Raw error detail; renderers show it only as a secondary details line. */
    error?: string;
}
export interface ClassifiedUpdateError {
    state: Extract<UpdateState, 'check-failed' | 'offline'>;
    reason: UpdateFailureReason;
    /** Human-readable raw error message for the details line / main.log. */
    detail: string;
}
export declare function isMissingUpdateConfigError(err: unknown): boolean;
/**
 * Classify an electron-updater error into an honest user-facing state.
 *
 * Network errors are classified before phase-specific failures, and download
 * failures are classified before check-time manifest failures.
 */
export declare function classifyUpdateError(err: unknown, phase?: UpdateErrorPhase): ClassifiedUpdateError;
/** Initial stored state before any check has ever run. */
export declare function initialUpdateState(): StoredUpdateStatus;
declare const ONE_SHOT_STATES: readonly ["store-managed", "linux-managed", "dev-mode"];
export type OneShotUpdateState = (typeof ONE_SHOT_STATES)[number];
export declare function isOneShotUpdateState(state: UpdateState): state is OneShotUpdateState;
/**
 * Build the stored state for a one-shot startup detection (store build,
 * Linux package-manager install, dev/unpacked build). These states persist
 * until something explicitly replaces them and must survive renderer
 * reloads, which is why they go through the same store as runtime states.
 */
export declare function oneShotUpdateState(state: OneShotUpdateState): StoredUpdateStatus;
export declare function missingUpdateConfigState(isDevelopmentArtifact: boolean, detail: string): StoredUpdateStatus;
export declare function isInstallReady(stored: StoredUpdateStatus, stagedUpdateReady: boolean): boolean;
export declare function isUpdateCheckInFlight(stored: StoredUpdateStatus, phase: UpdateErrorPhase): boolean;
/** Payload shape returned by the `get-update-status` IPC handler. */
export interface IpcUpdateStatusPayload {
    status: StoredUpdateStatus['status'];
    version?: string;
    percent?: number;
    reason?: UpdateFailureReason;
    error?: string;
    info: {
        version: string;
    };
}
/**
 * Derive the IPC response from the stored state. The renderer recovers the
 * real persisted state (including one-shot states and failures) on every
 * load instead of waiting for the next push event.
 */
export declare function toIpcUpdateStatus(stored: StoredUpdateStatus, currentVersion: string): IpcUpdateStatusPayload;
export {};
//# sourceMappingURL=update-state.d.ts.map