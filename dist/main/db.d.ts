import Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
export declare function throwIfDatabaseMaintenanceAborted(signal?: AbortSignal): void;
/**
 * A maintenance operation (backup/import/restore/initialize) must not wait
 * forever for in-flight database requests to drain — a stuck request would
 * otherwise hold the maintenance lock indefinitely. Bound the drain and fail
 * the maintenance operation with an explicit, retryable error.
 */
export declare const MAINTENANCE_DRAIN_TIMEOUT_MS = 10000;
export declare function beginDatabaseShutdown(): void;
export declare function withDatabaseRequest<T>(operation: () => T | Promise<T>, signal?: AbortSignal): Promise<T>;
export declare function registerDatabaseMaintenanceStartListener(listener: () => void): () => void;
export declare function registerDatabaseMaintenanceEndListener(listener: () => void): () => void;
export declare function isDatabaseMaintenanceActive(): boolean;
export declare function databaseMaintenanceMiddleware(req: Request, res: Response, next: NextFunction): void;
export declare function withDatabaseMaintenanceLock<T>(operation: (signal: AbortSignal) => T | Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T>;
export declare function getSettingValue(key: string): string | null;
export declare function upsertSettings(entries: Record<string, string | undefined | null>): void;
export declare function getDbHealth(): {
    ok: boolean;
    error?: string;
};
export declare function getDbPath(): string;
export declare function initDatabase(recoverInterruptedReplacement?: boolean, allowDuringShutdown?: boolean): void;
export declare function ensureCloudIdentity(): {
    posHash: string;
    deviceSecret: string;
};
/** Locally-cached RevFlo pairing code (plaintext) — FloAdmin only ever returns it once. */
export declare function getCachedPairingCode(): {
    code: string;
    expiresAt: string;
} | null;
export declare function setCachedPairingCode(code: string, expiresAt: string): void;
/** Random UUID, generated once and persisted — never derived from store/device identity. */
export declare function ensureTelemetryAnonId(): string;
/**
 * Anonymous usage telemetry is on by default for new installs and is switched
 * off in Settings > Privacy. First-run setup discloses it rather than asking:
 * a pre-ticked consent box is not valid consent, so we do not present one.
 * Tier 2 store-attributed diagnostics is a separate, explicit opt-in and is
 * never bundled into this stream.
 */
export declare function isTelemetryEnabled(): boolean;
/**
 * Tier 2 store-attributed diagnostics, kept separate from anonymous telemetry.
 * New installs default to enabled; an owner can switch it off in Settings.
 */
export declare function isDiagnosticsConsentEnabled(): boolean;
/**
 * Kitchen Display System on/off switch (issue #133). Defaults to enabled
 * (missing/anything but the literal 'false') so pre-existing installs that
 * predate this setting keep their current always-on behavior.
 */
export declare function isKdsEnabled(): boolean;
/**
 * Server App on/off switch. Defaults to enabled for new and upgraded installs,
 * while still allowing owners to hide the tableside ordering surface entirely.
 */
export declare function isServerAppEnabled(): boolean;
/**
 * KOT ticket printing on/off switch (issue #133) — coarser than
 * `auto_print_kot` (which only gates *automatic* printing on order
 * placement). When this is off, no KOT print command may be sent,
 * automatic or manual. Defaults to enabled, same reasoning as isKdsEnabled.
 */
export declare function isKotPrintingEnabled(): boolean;
export declare function upsertTelemetryLastPing(): void;
/** Atomic multi-statement mutation. Use for anything touching >1 row or >1 table. */
export declare function withTxn<T>(fn: () => T): T;
/** Safely append an object to a JSON-array column. Creates the array if missing/invalid. */
export declare function appendJsonArray(table: string, idColumn: string, idValue: any, column: string, value: any): void;
export declare function getDatabase(): Database.Database;
export declare function waitForDatabaseRequests(timeoutMs?: number): Promise<void>;
export declare function closeDatabase(): void;
export declare function createBackupUnlocked(targetPath?: string, signal?: AbortSignal): Promise<{
    path: string;
    schemaVersion: number;
}>;
export declare function createBackup(targetPath?: string, signal?: AbortSignal): Promise<{
    path: string;
    schemaVersion: number;
}>;
/**
 * Creates the safety backup and resets the live database while holding the
 * same maintenance lock used by ordinary backups. On a failed wipe/reopen,
 * restore the safety backup before surfacing the error so callers never see a
 * false success or an intentionally closed database.
 */
export declare function resetDatabaseWithBackup(signal?: AbortSignal): Promise<{
    backupPath: string;
}>;
/**
 * Lists backups in the managed backups/ directory, newest first. Only
 * backups written by createBackup()/syncBackupBeforeMigration() live here —
 * a backup saved to a user-chosen custom path (via the Export Backup /
 * "choose location" flow) intentionally does not appear here, same as it
 * never has for the existing File > Export Backup menu action. See #120.
 */
export declare function listBackups(): {
    fileName: string;
    path: string;
    sizeBytes: number;
    createdAt: string;
    kind: 'manual' | 'auto';
    schemaVersion: number | null;
}[];
/**
 * Deletes one backup from the managed backups/ directory by file name.
 * fileName is validated against the exact naming scheme createBackup() uses
 * and resolved only inside backupDir, so a path-traversal fileName (e.g.
 * `../../flo.db`) can't escape the backups folder or delete the live DB.
 */
export declare function deleteBackup(fileName: string): void;
/**
 * Returns true when `candidatePath` resolves (symlinks followed) to a regular
 * file inside the managed backups/ directory that matches the naming scheme
 * used by createBackup()/listBackups(). Renderer-initiated restores (Backup
 * History, #120) must pass this boundary so a compromised renderer cannot
 * point the restore IPC at an arbitrary database file on disk.
 */
export declare function isManagedBackupFile(candidatePath: string): boolean;
export declare function getTables(dbInstance: Database.Database): string[];
export interface RestoreResult {
    success: boolean;
    mode: 'direct' | 'data_only' | 'full';
    backupSchemaVersion: number;
    currentSchemaVersion: number;
    tablesRestored: number;
    error?: string;
}
export type UserStationSecurityState = {
    user_id: string;
    station_id: string;
    is_active: number;
    category_ids: string | null;
};
export type KitchenStationSecurityState = {
    id: string;
    is_active: number;
    category_ids: string | null;
};
export declare function captureKitchenStationSecurityState(dbInstance: Database.Database): KitchenStationSecurityState[];
export type KdsEnabledSettingState = {
    present: boolean;
    value: string | null;
};
export type RestoreProtectedSettingState = {
    key: string;
    present: boolean;
    value: string | null;
};
export type RestoreOutboxState = {
    cloud: Record<string, unknown>[];
    support: Record<string, unknown>[];
    diagnostics: Record<string, unknown>[];
};
export declare function captureRestoreProtectedSettings(dbInstance: Database.Database): RestoreProtectedSettingState[];
export declare function mergeRestoreProtectedSettings(dbInstance: Database.Database, states: RestoreProtectedSettingState[]): void;
export declare function captureRestoreOutboxState(dbInstance: Database.Database): RestoreOutboxState;
export declare function mergeRestoreOutboxState(dbInstance: Database.Database, state: RestoreOutboxState): void;
export declare function captureKdsEnabledSetting(dbInstance: Database.Database): KdsEnabledSettingState;
export declare function mergeKdsEnabledSetting(dbInstance: Database.Database, state: KdsEnabledSettingState): void;
export declare function captureUserStationSecurityState(dbInstance: Database.Database): UserStationSecurityState[];
export declare function mergeUserStationSecurityState(dbInstance: Database.Database, rows: UserStationSecurityState[], userIds: string[], preservedStations?: KitchenStationSecurityState[]): void;
export type UserSecurityState = {
    id: string;
    name: string;
    email: string | null;
    password: string;
    pin: string | null;
    pin_hash: string | null;
    role: string;
    category_ids: string | null;
    is_active: number;
    tokens_valid_after: string | null;
    station_assignments_configured: number;
};
export declare function getUserKdsStationIds(dbInstance: Database.Database, userId: string): string[] | null;
export declare function getKdsStationCategoryIds(dbInstance: Database.Database, stationIds: string[]): string[] | null;
export type KdsStationRoutingScope = {
    tablelessCategoryIds: string[];
    categoryIdsByStation: Record<string, string[] | null>;
    hasUnrestrictedStation: boolean;
};
export declare function getKdsStationRoutingScope(dbInstance: Database.Database, stationIds: string[], userCategoryIds: string[]): KdsStationRoutingScope | null;
export declare function getKdsStationRoutingCategoryIds(dbInstance: Database.Database, stationIds: string[], userCategoryIds: string[]): string[] | null;
export declare function isKdsStationItemAllowed(stationIds: string[], stationCategoryIds: string[], orderStationId: string | null | undefined, itemCategoryId: string | null | undefined, orderStationCategoryIds?: string[] | null, hasUnrestrictedStation?: boolean): boolean;
export declare function hasUserKdsStationAssignments(dbInstance: Database.Database, userId: string): boolean | null;
export declare function captureUserSecurityState(dbInstance: Database.Database): UserSecurityState[];
export declare function mergeUserSecurityState(dbInstance: Database.Database, rows: UserSecurityState[]): void;
export declare function restoreBackup(backupPath: string, forceDirect?: boolean, signal?: AbortSignal): RestoreResult;
/** Return stable keys for existing FK violations so legacy dirty data can be preserved without accepting new damage. */
export declare function getForeignKeyViolationKeys(dbInstance: Database.Database): Set<string>;
/** Return true only if the string is a safe SQL identifier (letters, digits, underscore). */
export declare function isSafeIdentifier(name: string): boolean;
export declare function getSchemaVersionFromBackup(backupPath: string): number | null;
export declare function getCurrentSchemaVersion(): number;
/**
 * Builds a throwaway in-memory database by running the exact same
 * createSchema()+MIGRATIONS pipeline a real fresh install takes. This is the
 * "ideal" schema reference for the DB health check — deriving it from the
 * live migration pipeline (instead of hand-maintaining a second schema spec)
 * guarantees it can never drift from what main/db.ts actually produces.
 *
 * Temporarily swaps the module-level `db` binding since createSchema()/
 * runMigrations() operate on it directly. Safe because better-sqlite3 is
 * fully synchronous and Node is single-threaded — nothing else can observe
 * the swapped binding as long as this function doesn't yield to the event loop.
 * Caller owns the returned handle and must call .close() on it.
 */
export declare function buildIdealSchemaDb(): Database.Database;
export declare const MIGRATIONS: {
    version: number;
    name: string;
    up: () => void;
}[];
export declare class SchemaVersionMismatchError extends Error {
    readonly dbVersion: number;
    readonly appVersion: number;
    constructor(dbVersion: number, appVersion: number);
}
export declare function generateShortId(table: string, length?: number): string;
/** YYYYMMDD for "now" in the given IANA timezone (falls back to UTC if the zone is invalid). */
export declare function dateStampInTimezone(timezone: string): string;
export declare function generateOrderNumber(): string;
export declare function generateBillNumber(): string;
export declare function now(): string;
/**
 * Parse a DB timestamp into a Date. Columns are stored in UTC wall time in
 * `YYYY-MM-DD HH:MM:SS` (space) form — V8's legacy parser treats that form as
 * machine-LOCAL time, so `new Date(ts)` silently shifts by the host's offset
 * on machines outside UTC. ISO rows (`...T10:00:00.123Z`, pre-v40 data) parse
 * as UTC natively. Use this everywhere a stored timestamp is turned into a
 * Date (reports, receipts, KDS clocks, auth token staleness, telemetry).
 */
export declare function parseDbTimestamp(ts: string | null | undefined): Date;
/** "Today" as a `YYYY-MM-DD` string in UTC for non-tenant uses. */
export declare function utcTodayDate(): string;
/** Return the calendar date represented by an instant in an IANA timezone. */
export declare function localDateInTimezone(instant: Date, timezone: string): string;
/**
 * `[start, end)` half-open UTC ranges for one date in the tenant timezone.
 * The offset is resolved at each boundary so DST transitions retain their
 * actual local midnight rather than assuming every day is 24 hours.
 */
export declare function dayBoundsInTimezone(date: string, timezone: string): [string, string];
/**
 * `[start, end)` half-open UTC range strings for a UTC calendar date.
 * Bounds are emitted in the space form so string comparisons line up exactly
 * with stored rows (migration v40 normalized all rows to it).
 */
export declare function utcDayBounds(date: string): [string, string];
/** Verify a user PIN against the stored pin_hash. */
export declare function verifyPin(storedHash: string | null | undefined, inputPin: string | number): boolean;
export declare const KDS_VOIDED_ITEM_VISIBILITY_MS: number;
/**
 * Whether a voided order item should still appear on a KDS surface. Only
 * ever called for status='voided' rows; every other status is a normal
 * KDS-visibility decision the caller already makes. The synthetic negative
 * `void_adjustment` bill line this same void flow inserts (main/routes/index.ts)
 * is never a kitchen item and callers should exclude it before this check
 * even runs, not route it through here.
 */
export declare function isVoidedItemKdsVisible(voidedAt: string | null | undefined): boolean;
/** Remove customer/payment/order-financial fields from category-scoped KDS payloads. */
export declare function projectKdsOrder(order: any, restricted: boolean): any;
/** Keep category-scoped KDS lines limited to kitchen-operational fields. */
export declare function projectKdsItem(item: any, restricted: boolean): any;
/** Avoid exposing printer/network credentials in restricted KDS station metadata. */
export declare function projectKdsStation(station: any, restricted: boolean, userCategoryIds?: string[]): any;
/**
 * Snapshots an order item's selected addons into the normalized
 * order_item_addons table — the only place selected addons are stored (see
 * issue #125; order_items.addons was dropped in migration v28). Silently
 * skips entries missing a name.
 */
export declare function insertOrderItemAddons(dbInstance: Database.Database, orderItemId: number | bigint, addons: {
    id?: string;
    name?: string;
    price?: number;
    quantity?: number;
}[] | null | undefined, createdAt: string): void;
/** Parse JSON string fields on order_item rows returned from SQLite.
 *  Stored as JSON.stringify(value) — may be "null", "[...]", "{...}" etc.
 *  Returns actual JS value (array / object / null) so the frontend can map/iterate.
 *  addons is not handled here — see attachEffectiveAddons, which resolves it
 *  from the normalized order_item_addons table instead. */
export declare function parseItemJson(item: any): any;
/**
 * Resolves selected addons for a batch of order_items rows from the
 * normalized order_item_addons table — the sole source of truth (see issue
 * #125; order_items.addons was dropped in migration v28). Returns new
 * objects with `addons` set to an array (empty if the item has none); does
 * not mutate the input.
 */
export declare function attachEffectiveAddons<T extends {
    id: number;
}>(dbInstance: Database.Database, items: T[]): (T & {
    addons: {
        id: string | null;
        name: string;
        price: number;
        quantity: number;
    }[];
})[];
/** Parse JSON text columns on bill/order rows returned from SQLite. */
export declare function parseRowJson(row: any): any;
//# sourceMappingURL=db.d.ts.map