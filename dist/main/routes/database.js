"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const security_1 = require("../middleware/security");
const master_pin_1 = require("../middleware/master-pin");
const auth_1 = require("./auth");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const async_handler_1 = require("../middleware/async-handler");
const shutdown_1 = require("../shutdown");
const phone_1 = require("../lib/phone");
const role_permissions_1 = require("../../shared/role-permissions");
const router = (0, express_1.Router)();
// Settings keys stripped from export — these are secrets; exporting them would
// allow token forgery or cloud credential theft (vuln-0005).
const EXPORT_SETTINGS_REDACT = new Set([
    'jwt_secret',
    'cloud_api_key',
    'cloud_device_secret',
    'cloud_pos_hash',
    'mobile_pairing_code',
    'mobile_pairing_code_expires_at',
    // Bearer-like token used to poll a pending cloud account-deletion request
    // (see main/services/cloud-sync.ts) — same exposure risk as the cloud
    // credentials above.
    'cloud_deletion_status_token',
    // Legacy builds persisted arbitrary upstream errors here; keep exports
    // from carrying that text even before an upgraded database is reopened.
    'cloud_last_error',
]);
// User columns stripped from export — hashes must never leave the server.
const USER_REDACT_COLS = new Set(['password', 'pin', 'pin_hash']);
// Tables excluded entirely — cloud_sync_outbox may contain cloud auth payloads.
const EXPORT_EXCLUDE_TABLES = new Set(['cloud_sync_outbox', 'support_ticket_outbox', 'store_diagnostics_outbox', 'kds_pairing_tokens']);
// Parses an import file's schema_version exactly as the import handler does.
// A missing or malformed value collapses to -1 (and an omitted version to 0),
// which always counts as a mismatch against the live schema — and therefore as
// a destructive, delete-and-replace import that needs Master PIN confirmation.
function parseImportSchemaVersion(value) {
    const raw = String(value ?? '0');
    return /^(?:0|[1-9]\d*)$/.test(raw) ? Number(raw) : -1;
}
router.get('/export', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const result = (0, db_1.withTxn)(() => {
            const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_flo_meta'
      `).all();
            const exportData = {};
            const redactedFields = [];
            for (const { name: tableName } of tables) {
                if (!(0, db_1.isSafeIdentifier)(tableName)) {
                    console.warn(`[DB Export] Skipping unsafe table name: ${tableName}`);
                    continue;
                }
                if (EXPORT_EXCLUDE_TABLES.has(tableName)) {
                    redactedFields.push(`table:${tableName}`);
                    continue;
                }
                const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
                if (tableName === 'settings') {
                    exportData[tableName] = rows.map((row) => {
                        if (EXPORT_SETTINGS_REDACT.has(row.key)) {
                            redactedFields.push(`settings.${row.key}`);
                            return { ...row, value: '[REDACTED]' };
                        }
                        return row;
                    });
                }
                else if (tableName === 'users') {
                    exportData[tableName] = rows.map((row) => {
                        const sanitized = { ...row };
                        for (const col of USER_REDACT_COLS) {
                            if (col in sanitized) {
                                delete sanitized[col];
                                if (!redactedFields.includes(`users.${col}`))
                                    redactedFields.push(`users.${col}`);
                            }
                        }
                        return sanitized;
                    });
                }
                else {
                    exportData[tableName] = rows;
                }
            }
            return { exportData, redactedFields };
        });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `flo-export-${timestamp}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json({
            version: 1,
            app: 'FloDesktop',
            exported_at: new Date().toISOString(),
            schema_version: String((0, db_1.getCurrentSchemaVersion)()),
            redacted_fields: result.redactedFields,
            data: result.exportData,
        });
    }
    catch (error) {
        console.error('[DB Export] Error:', error);
        res.status(500).json({ error: 'Export failed' });
    }
});
router.post('/import', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res, next) => {
    // A schema-mismatch import reaches the same delete-and-replace path as an
    // explicit overwrite (the `overwrite || hasVersionMismatch` branch below),
    // so it must require the same Master PIN confirmation. Gate on both
    // triggers so an owner cannot bypass the destructive-operation confirmation
    // by submitting a deliberately mismatched or malformed schema_version
    // (GHSA-xxv4-gm82-4639).
    const body = req.body;
    const overwrite = Boolean(body?.overwrite);
    const schemaVersionMismatch = body?.data && typeof body.data === 'object'
        ? parseImportSchemaVersion(body.data.schema_version) !== (0, db_1.getCurrentSchemaVersion)()
        : false;
    return (overwrite || schemaVersionMismatch) ? (0, master_pin_1.requireMasterPin)(req, res, next) : next();
}, (0, async_handler_1.asyncHandler)(async (req, res) => {
    return (0, db_1.withDatabaseMaintenanceLock)(async (signal) => {
        try {
            (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
            const { data, overwrite } = req.body;
            if (!data || !data.data || typeof data.data !== 'object') {
                return res.status(400).json({ error: 'Invalid import file format' });
            }
            const db = (0, db_1.getDatabase)();
            const preservedRevocations = db.prepare('SELECT token_hash, expires_at, revoked_at FROM revoked_tokens').all();
            const baselineForeignKeyViolations = (0, db_1.getForeignKeyViolationKeys)(db);
            const preservedUserSecurity = (0, db_1.captureUserSecurityState)(db);
            const preservedUserStations = (0, db_1.captureUserStationSecurityState)(db);
            const preservedStationSecurity = (0, db_1.captureKitchenStationSecurityState)(db);
            const preservedKdsEnabled = (0, db_1.captureKdsEnabledSetting)(db);
            const preservedProtectedSettings = (0, db_1.captureRestoreProtectedSettings)(db);
            const importData = data.data;
            const importSchemaVersion = parseImportSchemaVersion(data.schema_version);
            const hasVersionMismatch = importSchemaVersion !== (0, db_1.getCurrentSchemaVersion)();
            if (hasVersionMismatch) {
                console.log(`[DB Import] Version mismatch: import v${importSchemaVersion} vs current v${(0, db_1.getCurrentSchemaVersion)()}. Using data-only merge.`);
            }
            const requiredTables = ['settings', 'categories', 'products', 'users'];
            const importedTables = Object.keys(importData);
            const missingTables = requiredTables.filter(t => !importedTables.includes(t));
            if (missingTables.length > 0) {
                return res.status(400).json({
                    error: `Missing required tables: ${missingTables.join(', ')}`
                });
            }
            // Exported user rows intentionally omit password/pin hashes. Preserve
            // existing destination accounts, and create inactive placeholders for
            // redacted exported users so historical rows keep valid staff references.
            const importedUserRows = Array.isArray(importData.users) ? importData.users : [];
            const credentialedUserIds = new Set(importedUserRows
                .filter((row) => typeof row?.password === 'string' && row.password.length > 0)
                .map((row) => String(row.id)));
            const redactedUserIds = new Set(importedUserRows
                .filter((row) => row && typeof row === 'object' && row.id != null && !credentialedUserIds.has(String(row.id)))
                .map((row) => String(row.id)));
            const importProvidedUserIds = new Set([...credentialedUserIds, ...redactedUserIds]);
            const existingUserIds = new Set(db.prepare('SELECT id FROM users').all().map((row) => String(row.id)));
            const unresolvedUserIds = new Set();
            for (const [tableName, rows] of Object.entries(importData)) {
                if (tableName === 'users' || !Array.isArray(rows) || !(0, db_1.isSafeIdentifier)(tableName))
                    continue;
                const userReferenceColumns = db.prepare(`PRAGMA foreign_key_list(${tableName})`).all()
                    .filter((foreignKey) => foreignKey.table === 'users')
                    .map((foreignKey) => foreignKey.from);
                if (userReferenceColumns.length === 0)
                    continue;
                for (const row of rows) {
                    if (!row || typeof row !== 'object')
                        continue;
                    for (const column of userReferenceColumns) {
                        const value = row[column];
                        if (value != null && String(value) !== '') {
                            const userId = String(value);
                            if (!existingUserIds.has(userId) && !importProvidedUserIds.has(userId))
                                unresolvedUserIds.add(userId);
                        }
                    }
                }
            }
            const importedWhatsappActivator = importedTables.includes('settings') && Array.isArray(importData.settings)
                ? importData.settings.find((row) => row?.key === 'whatsapp_activated_by_user_id')?.value
                : null;
            if (importedWhatsappActivator && !existingUserIds.has(String(importedWhatsappActivator)) && !importProvidedUserIds.has(String(importedWhatsappActivator))) {
                unresolvedUserIds.add(String(importedWhatsappActivator));
            }
            if (unresolvedUserIds.size > 0) {
                return res.status(400).json({
                    error: 'Import contains rows linked to user accounts that are not present in this export or this install. Set up matching staff accounts first.',
                });
            }
            const { path: backupPath } = await (0, db_1.createBackupUnlocked)(undefined, signal);
            (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
            const previousForeignKeys = Number(db.pragma('foreign_keys', { simple: true })) === 1;
            db.pragma('foreign_keys = OFF');
            try {
                (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
                db.exec('BEGIN IMMEDIATE');
                try {
                    for (const tableName of importedTables) {
                        (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
                        if (EXPORT_EXCLUDE_TABLES.has(tableName))
                            continue;
                        // Validate table name to prevent SQL injection
                        if (!(0, db_1.isSafeIdentifier)(tableName)) {
                            console.warn(`[DB Import] Skipping unsafe table name: ${tableName}`);
                            continue;
                        }
                        const rows = importData[tableName];
                        if (!rows || !Array.isArray(rows))
                            continue;
                        if (rows.length === 0) {
                            if (overwrite || hasVersionMismatch) {
                                if (tableName === 'settings') {
                                    const protectedKeys = Array.from(EXPORT_SETTINGS_REDACT);
                                    const placeholders = protectedKeys.map(() => '?').join(', ');
                                    db.prepare(`DELETE FROM settings WHERE key NOT IN (${placeholders})`).run(...protectedKeys);
                                }
                                else {
                                    db.exec(`DELETE FROM ${tableName}`);
                                }
                            }
                            continue;
                        }
                        const currentCols = getTableColumns(db, tableName);
                        // Validate and filter column names to prevent SQL injection
                        const importCols = Object.keys(rows[0]).filter(db_1.isSafeIdentifier);
                        // A normal export intentionally omits password/pin hashes. It must not
                        // attempt to recreate users with a NULL required password.
                        if (tableName === 'users' && !importCols.includes('password'))
                            continue;
                        const commonCols = hasVersionMismatch
                            ? importCols.filter(c => currentCols.includes(c) && (0, db_1.isSafeIdentifier)(c))
                            : importCols;
                        if (commonCols.length === 0)
                            continue;
                        if (overwrite || hasVersionMismatch) {
                            if (tableName === 'settings') {
                                const protectedKeys = Array.from(EXPORT_SETTINGS_REDACT);
                                const placeholders = protectedKeys.map(() => '?').join(', ');
                                db.prepare(`DELETE FROM settings WHERE key NOT IN (${placeholders})`).run(...protectedKeys);
                            }
                            else {
                                db.exec(`DELETE FROM ${tableName}`);
                            }
                        }
                        const colList = commonCols.join(', ');
                        const placeholders = commonCols.map(() => '?').join(', ');
                        const insertStmt = db.prepare(`INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})`);
                        const tenantCountryRow = db.prepare("SELECT value FROM settings WHERE key = 'country'").get();
                        const tenantCountry = tenantCountryRow?.value || 'IN';
                        for (const row of rows) {
                            (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
                            // Exported secret fields are deliberately redacted. Never import the
                            // marker itself as a real credential (which would make it known).
                            if (tableName === 'settings' &&
                                EXPORT_SETTINGS_REDACT.has(String(row.key)) &&
                                row.value === '[REDACTED]')
                                continue;
                            if (tableName === 'customers' && row.phone) {
                                const parsed = (0, phone_1.parsePhoneE164)(String(row.phone), tenantCountry);
                                if (parsed) {
                                    row.phone = parsed.e164;
                                    if (commonCols.includes('country_code')) {
                                        row.country_code = parsed.countryCode;
                                    }
                                }
                            }
                            insertStmt.run(...commonCols.map(col => row[col]));
                        }
                        console.log(`[DB Import] ${tableName}: ${rows.length} rows (${commonCols.length} columns)`);
                    }
                    const placeholderUsersCreated = restoreRedactedUserPlaceholders(db, importedUserRows, existingUserIds);
                    if (placeholderUsersCreated > 0) {
                        console.log(`[DB Import] Created ${placeholderUsersCreated} inactive placeholder user(s) for redacted exported accounts`);
                    }
                    (0, db_1.mergeUserSecurityState)(db, preservedUserSecurity);
                    (0, db_1.mergeUserStationSecurityState)(db, preservedUserStations, preservedUserSecurity.map((row) => row.id), preservedStationSecurity);
                    (0, db_1.mergeKdsEnabledSetting)(db, preservedKdsEnabled);
                    (0, db_1.mergeRestoreProtectedSettings)(db, preservedProtectedSettings);
                    db.prepare('DELETE FROM kds_pairing_tokens').run();
                    const mergeRevocation = db.prepare(`
        INSERT INTO revoked_tokens (token_hash, expires_at, revoked_at)
        VALUES (?, ?, ?)
        ON CONFLICT(token_hash) DO UPDATE SET
          expires_at = MAX(revoked_tokens.expires_at, excluded.expires_at),
          revoked_at = MIN(revoked_tokens.revoked_at, excluded.revoked_at)
      `);
                    for (const revocation of preservedRevocations) {
                        mergeRevocation.run(revocation.token_hash, revocation.expires_at, revocation.revoked_at);
                    }
                    const newForeignKeyViolations = [...(0, db_1.getForeignKeyViolationKeys)(db)]
                        .filter((key) => !baselineForeignKeyViolations.has(key));
                    if (newForeignKeyViolations.length > 0) {
                        throw new Error(`Import would introduce ${newForeignKeyViolations.length} new foreign-key violation(s)`);
                    }
                    (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
                    db.exec('COMMIT');
                    try {
                        (0, security_1.clearUserAuthCache)();
                        (0, security_1.clearInMemoryRevokedTokens)();
                        (0, auth_1.clearJWTSecretCache)();
                    }
                    catch (cacheError) {
                        // The import is already committed above. A failure to clear the
                        // in-memory auth/revocation caches must not be reported as a failed
                        // import — that would encourage an operator to retry an already-
                        // committed import. Log it and still report success.
                        console.error('[DB Import] Post-commit cache cleanup failed:', cacheError);
                    }
                    res.json({
                        success: true,
                        message: hasVersionMismatch
                            ? 'Data imported with schema compatibility (some fields may be missing)'
                            : 'Database imported successfully',
                        backup: backupPath,
                        schemaVersionMismatch: hasVersionMismatch,
                        importedSchemaVersion: importSchemaVersion,
                        currentSchemaVersion: (0, db_1.getCurrentSchemaVersion)(),
                        placeholderUsersCreated,
                    });
                }
                catch (err) {
                    try {
                        db.exec('ROLLBACK');
                    }
                    catch { }
                    throw err;
                }
            }
            finally {
                db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
            }
        }
        catch (error) {
            console.error('[DB Import] Error:', error);
            res.status(500).json({ error: 'Import failed' });
        }
    }, (0, shutdown_1.getHttpRequestSignal)(req));
}));
function restoreRedactedUserPlaceholders(db, importedUserRows, existingUserIds) {
    if (importedUserRows.length === 0)
        return 0;
    const currentCols = getTableColumns(db, 'users');
    const insertableCols = [
        'id',
        'name',
        'email',
        'password',
        'role',
        'category_ids',
        'is_active',
        'terms_accepted_at',
        'tokens_valid_after',
        'station_assignments_configured',
        'created_at',
        'updated_at',
    ].filter((column) => currentCols.includes(column));
    if (!insertableCols.includes('id') || !insertableCols.includes('password'))
        return 0;
    const colList = insertableCols.join(', ');
    const placeholders = insertableCols.map(() => '?').join(', ');
    const insertStmt = db.prepare(`INSERT OR IGNORE INTO users (${colList}) VALUES (${placeholders})`);
    let created = 0;
    for (const row of importedUserRows) {
        if (!row || typeof row !== 'object')
            continue;
        if (typeof row.password === 'string' && row.password.length > 0)
            continue;
        const id = row.id == null ? '' : String(row.id);
        if (!id || existingUserIds.has(id))
            continue;
        const timestamp = typeof row.updated_at === 'string' && row.updated_at
            ? row.updated_at
            : new Date().toISOString();
        const roleValue = String(row.role);
        const role = (0, role_permissions_1.isRole)(roleValue) ? roleValue : 'cashier';
        const values = {
            id,
            name: typeof row.name === 'string' && row.name.trim() ? row.name : `Imported staff ${id}`,
            email: null,
            password: `disabled-redacted-import-${id}`,
            role,
            category_ids: typeof row.category_ids === 'string' ? row.category_ids : null,
            is_active: 0,
            terms_accepted_at: null,
            tokens_valid_after: null,
            station_assignments_configured: 0,
            created_at: typeof row.created_at === 'string' && row.created_at ? row.created_at : timestamp,
            updated_at: timestamp,
        };
        const info = insertStmt.run(...insertableCols.map((column) => values[column] ?? null));
        if (info.changes > 0) {
            existingUserIds.add(id);
            created += 1;
        }
    }
    return created;
}
function getTableColumns(db, tableName) {
    if (!(0, db_1.isSafeIdentifier)(tableName)) {
        console.warn(`[DB Columns] Unsafe table name rejected: ${tableName}`);
        return [];
    }
    try {
        const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
        return columns.map(col => col.name);
    }
    catch {
        return [];
    }
}
router.post('/backup', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const { path: backupPath, schemaVersion } = await (0, db_1.createBackup)(undefined, (0, shutdown_1.getHttpRequestSignal)(req));
        res.json({
            success: true,
            path: backupPath,
            filename: path.basename(backupPath),
            schemaVersion
        });
    }
    catch (error) {
        console.error('[DB Backup] Error:', error);
        res.status(500).json({ error: 'Backup failed' });
    }
}));
router.get('/download', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    let tempDir = null;
    try {
        const dbPath = (0, db_1.getDbPath)();
        tempDir = fs.mkdtempSync(path.join(path.dirname(dbPath), '.flo-download-'));
        const snapshotPath = path.join(tempDir, 'flo-database.db');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `flo-database-${timestamp}.db`;
        // Download a clean checkpointed backup rather than streaming the live WAL
        // file. The temporary snapshot is independent of later restore/reset work.
        await (0, db_1.createBackup)(snapshotPath, (0, shutdown_1.getHttpRequestSignal)(req));
        const signal = (0, shutdown_1.getHttpRequestSignal)(req);
        const download = new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => {
                try {
                    res.destroy();
                }
                catch (error) {
                    settle(error);
                    return;
                }
            };
            const settle = (error) => {
                if (settled)
                    return;
                settled = true;
                signal?.removeEventListener('abort', onAbort);
                if (error)
                    reject(error);
                else
                    resolve();
            };
            res.once('finish', () => settle());
            res.once('close', () => settle());
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) {
                onAbort();
                return;
            }
            try {
                res.download(snapshotPath, filename, (error) => settle(error));
            }
            catch (error) {
                settle(error);
            }
        });
        void (0, shutdown_1.trackHttpRequestWork)(req, download)
            .finally(() => {
            try {
                if (tempDir)
                    fs.rmSync(tempDir, { recursive: true, force: true });
            }
            catch { }
        })
            .catch((error) => {
            console.error('[DB Download] Stream error:', error.message);
        });
    }
    catch (error) {
        if (tempDir) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
            catch { }
        }
        console.error('[DB Download] Error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
}));
router.get('/tables', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_flo_meta'
      ORDER BY name
    `).all();
        const tableInfo = tables
            .filter(({ name: tableName }) => (0, db_1.isSafeIdentifier)(tableName))
            .map(({ name: tableName }) => {
            const count = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
            return { name: tableName, rows: count.count };
        });
        res.json({ tables: tableInfo });
    }
    catch (error) {
        console.error('[DB Tables] Error:', error);
        res.status(500).json({ error: 'Could not fetch database tables' });
    }
});
exports.databaseRoutes = router;
//# sourceMappingURL=database.js.map