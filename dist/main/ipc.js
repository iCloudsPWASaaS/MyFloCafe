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
exports.isTrustedSender = isTrustedSender;
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const node_crypto_1 = require("node:crypto");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const db_1 = require("./db");
const security_1 = require("./middleware/security");
const server_1 = require("./server");
const auth_1 = require("./routes/auth");
const kds_server_1 = require("./kds-server");
const master_pin_1 = require("./services/master-pin");
const schema_health_1 = require("./services/schema-health");
const whatsapp_1 = require("./services/whatsapp");
const window_options_1 = require("./window-options");
const window_readiness_1 = require("./window-readiness");
const title_bar_theme_1 = require("./title-bar-theme");
const refund_1 = require("./services/refund");
const countries_1 = require("./countries");
// Settings keys the renderer is allowed to write via IPC.
// Must stay in sync with routes/settings.ts ALLOWED_WILDCARD_KEYS.
// Sensitive keys (jwt_secret, cloud_api_key, cloud_*, tax_registration_number, etc.) are excluded.
const ALLOWED_IPC_KEYS = new Set([
    'business_name', 'timezone', 'currency', 'country',
    'state_code', 'business_address', 'business_phone',
    'billing_type', 'bill_show_name', 'bill_show_address',
    'bill_show_phone', 'bill_show_tax_id', 'bill_show_tax_breakdown',
    'bill_show_customer_name', 'bill_show_customer_phone', 'bill_show_table_number',
    'tax_scheme',
    'loyalty_enabled',
    'printer_method', 'paper_size', 'bill_template', 'bill_footer_message',
    'telemetry_enabled',
    'theme_mode',
]);
const SENSITIVE_SETTING_KEYS = new Set([
    'jwt_secret',
    'cloud_api_key',
    'cloud_device_secret',
    'cloud_deletion_status_token',
    'cloud_last_error',
]);
function maskSetting(key, value) {
    if (key === 'cloud_last_error')
        return value ? 'Cloud service request failed' : '';
    if (!SENSITIVE_SETTING_KEYS.has(key))
        return value;
    return value ? `****${value.slice(-4)}` : '';
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * The only window permitted to invoke privileged IPC is the main POS renderer,
 * which the embedded server serves from localhost/127.0.0.1. The KDS window is
 * LAN-served HTTP content and must not reach these handlers, so non-PIN-gated
 * handlers verify the sender's origin before doing anything.
 */
function isTrustedSender(event) {
    try {
        const url = event.sender?.getURL?.() ?? '';
        return url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:');
    }
    catch {
        return false;
    }
}
/**
 * The preload can run before Chromium has committed the localhost URL. In
 * that narrow interval origin is unavailable, so accept only the expected
 * POS BrowserWindow (and still require the current top-level frame below).
 * Every other pre-navigation sender fails closed; once a URL exists the
 * normal localhost origin check remains mandatory.
 */
function isEarlyMainWindowSender(event, getMainWindow) {
    if (!getMainWindow)
        return false;
    try {
        const url = event.sender?.getURL?.() ?? '';
        if (url !== '' && url !== 'about:blank')
            return false;
        const expectedWindow = getMainWindow();
        return Boolean(expectedWindow
            && !expectedWindow.isDestroyed()
            && electron_1.BrowserWindow.fromWebContents(event.sender) === expectedWindow);
    }
    catch {
        return false;
    }
}
function handle(channel, listener) {
    electron_1.ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedSender(event))
            return { error: 'Unauthorized sender' };
        return listener(event, ...args);
    });
}
function registerIpcHandlers(shutdownSignal, getMainWindow, showMainWindow = () => false, getCurrentEffectiveIsDark) {
    electron_1.ipcMain.on('window-document', (event, documentNonce) => {
        let currentFrame = null;
        try {
            currentFrame = event.sender.mainFrame;
        }
        catch {
            event.returnValue = { success: false, error: 'Invalid document registration' };
            return;
        }
        if (!(0, window_readiness_1.isCurrentRendererFrame)(event.senderFrame, currentFrame)) {
            event.returnValue = { success: false, error: 'Invalid document registration' };
            return;
        }
        if (!isTrustedSender(event) && !isEarlyMainWindowSender(event, getMainWindow)) {
            event.returnValue = { error: 'Unauthorized sender' };
            return;
        }
        event.returnValue = (0, window_readiness_1.registerRendererDocument)(documentNonce)
            ? { success: true }
            : { success: false, error: 'Invalid document nonce' };
    });
    // Database backup/restore
    electron_1.ipcMain.handle('backup-database', async (event, pin) => {
        const auth = (0, master_pin_1.authorizeMasterPin)(pin, 'ipc:backup');
        if (!auth.ok)
            return { success: false, error: auth.error };
        try {
            console.log('[IPC] backup-database: Starting...');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const result = await electron_1.dialog.showSaveDialog({
                defaultPath: path.join(electron_1.app.getPath('documents'), `flo-backup-${timestamp}.db`),
                filters: [{ name: 'SQLite Database', extensions: ['db'] }],
            });
            if (result.canceled || !result.filePath) {
                return { success: false, error: 'Cancelled' };
            }
            const { path: backupPath, schemaVersion } = await (0, db_1.createBackup)(result.filePath, shutdownSignal);
            console.log('[IPC] backup-database: Complete:', backupPath);
            return {
                success: true,
                path: backupPath,
                schemaVersion,
                message: `Backup saved (Schema v${schemaVersion})`
            };
        }
        catch (error) {
            console.error('[IPC] backup-database: Error:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });
    electron_1.ipcMain.handle('restore-backup', async (event, pin, presetBackupPath) => {
        const auth = (0, master_pin_1.authorizeMasterPin)(pin, 'ipc:restore');
        if (!auth.ok)
            return { success: false, error: auth.error };
        try {
            // A specific backup (e.g. picked from the Backup History list, #120)
            // skips the native file picker entirely.
            let backupPath = presetBackupPath;
            if (!backupPath) {
                const result = await electron_1.dialog.showOpenDialog({
                    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
                    properties: ['openFile'],
                });
                if (result.canceled || !result.filePaths.length) {
                    return { success: false, error: 'Cancelled' };
                }
                backupPath = result.filePaths[0];
            }
            else if (!fs.existsSync(backupPath)) {
                return { success: false, error: 'Backup file no longer exists' };
            }
            else if (!(0, db_1.isManagedBackupFile)(backupPath)) {
                return { success: false, error: 'Restore source must be a Flo-managed backup file' };
            }
            const backupVersion = (0, db_1.getSchemaVersionFromBackup)(backupPath);
            if (backupVersion === null) {
                return {
                    success: false,
                    error: 'Invalid backup file: missing schema version metadata. This backup may have been created with an older version of FloDesktop.'
                };
            }
            const versionMismatch = backupVersion !== (0, db_1.getCurrentSchemaVersion)();
            if (versionMismatch) {
                const confirmResult = await electron_1.dialog.showMessageBox({
                    type: 'warning',
                    buttons: ['Restore Anyway', 'Cancel'],
                    defaultId: 1,
                    title: 'Schema Version Mismatch',
                    message: `Backup was created with Schema v${backupVersion}`,
                    detail: `Current database uses Schema v${(0, db_1.getCurrentSchemaVersion)()}.\n\nRestoring will import data only (common fields) to preserve new database structure.\n\nDo you want to continue?`
                });
                if (confirmResult.response !== 0) {
                    return { success: false, error: 'Cancelled' };
                }
                const restoreResult = await (0, db_1.withDatabaseMaintenanceLock)((signal) => (0, db_1.restoreBackup)(backupPath, false, signal), shutdownSignal);
                (0, security_1.clearUserAuthCache)();
                (0, security_1.clearInMemoryRevokedTokens)();
                (0, auth_1.clearJWTSecretCache)();
                return {
                    success: restoreResult.success,
                    mode: restoreResult.mode,
                    backupVersion,
                    currentVersion: (0, db_1.getCurrentSchemaVersion)(),
                    tablesRestored: restoreResult.tablesRestored,
                    message: restoreResult.success
                        ? `Restored ${restoreResult.tablesRestored} tables (data-only mode due to version mismatch)`
                        : `Restore failed: ${restoreResult.error}`,
                    error: restoreResult.error
                };
            }
            const restoreResult = await (0, db_1.withDatabaseMaintenanceLock)((signal) => (0, db_1.restoreBackup)(backupPath, true, signal), shutdownSignal);
            (0, security_1.clearUserAuthCache)();
            (0, security_1.clearInMemoryRevokedTokens)();
            (0, auth_1.clearJWTSecretCache)();
            return {
                success: restoreResult.success,
                mode: restoreResult.mode,
                backupVersion,
                currentVersion: (0, db_1.getCurrentSchemaVersion)(),
                tablesRestored: restoreResult.tablesRestored,
                message: restoreResult.success ? 'Database restored successfully' : `Restore failed: ${restoreResult.error}`,
                error: restoreResult.error
            };
        }
        catch (error) {
            console.error('[IPC] restore-backup: Error:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });
    // DB health check / master PIN / initialize (menu + tray triggered)
    handle('db-health-check', async () => {
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                return (0, schema_health_1.runHealthCheck)();
            }
            catch (error) {
                return { error: getErrorMessage(error) };
            }
        });
    });
    handle('db-apply-safe-fixes', async (event, findingIds) => {
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                return (0, schema_health_1.applySafeFixes)(findingIds);
            }
            catch (error) {
                return { applied: [], skipped: [], errors: [{ id: 'all', error: getErrorMessage(error) }] };
            }
        });
    });
    handle('master-pin-status', async () => {
        return { available: (0, master_pin_1.isMasterPinAvailable)(), isSet: (0, master_pin_1.isMasterPinSet)() };
    });
    electron_1.ipcMain.handle('db-initialize', async (event, { pin, confirmationPhrase }) => {
        const auth = (0, master_pin_1.authorizeMasterPin)(pin, 'ipc:initialize');
        if (!auth.ok)
            return { success: false, error: auth.error };
        if (confirmationPhrase !== 'INITIALIZE') {
            return { success: false, error: 'Confirmation phrase does not match' };
        }
        try {
            const { backupPath } = await (0, db_1.resetDatabaseWithBackup)(shutdownSignal);
            (0, security_1.clearUserAuthCache)();
            (0, security_1.clearInMemoryRevokedTokens)();
            (0, auth_1.clearJWTSecretCache)();
            return { success: true, backupPath };
        }
        catch (error) {
            console.error('[IPC] db-initialize: Error:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });
    // Narrow window-control surface for the renderer title bar's HTML fallback
    // controls (only mounted when main reports 'html-fallback'). The trusted-
    // sender wrapper above already restricts this to the localhost-served POS
    // renderer; KDS/print popups carry no preload bridge. 'close' routes through
    // BrowserWindow.close() so it fires the same event as the native caption
    // button and honors close-to-tray behavior.
    handle('window-action', (event, action) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed())
            return { error: 'Window unavailable' };
        return (0, window_options_1.applyWindowControlAction)(win, action);
    });
    handle('get-window-state', (event) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed())
            return { isMaximized: false, isFullScreen: false };
        return {
            isMaximized: win.isMaximized(),
            isFullScreen: win.isFullScreen(),
        };
    });
    handle('window-ready', (event, payload) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed())
            return { error: 'Window unavailable' };
        let currentFrame = null;
        try {
            currentFrame = event.sender.mainFrame;
        }
        catch {
            return { success: false, error: 'Stale or invalid readiness report' };
        }
        if (!(0, window_readiness_1.isCurrentRendererFrame)(event.senderFrame, currentFrame)) {
            return { success: false, error: 'Stale or invalid readiness report' };
        }
        // Reports are bound to the readiness epoch of the document that sent them
        // (see main/window-readiness.ts). Stale or malformed reports are ignored:
        // a previous document must never mark the current one ready.
        const reported = payload;
        if (!(0, window_readiness_1.markWindowRendererReady)(reported?.epoch, reported?.documentNonce)) {
            return { success: false, error: 'Stale or invalid readiness report' };
        }
        showMainWindow(win);
        return { success: true };
    });
    // Settings
    handle('get-settings', async () => {
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                const db = (0, db_1.getDatabase)();
                const rows = db.prepare('SELECT key, value FROM settings').all();
                const settings = {};
                rows.forEach((row) => {
                    settings[row.key] = maskSetting(row.key, row.value);
                });
                return settings;
            }
            catch (error) {
                return { error: getErrorMessage(error) };
            }
        });
    });
    handle('set-setting', async (event, key, value) => {
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                if (typeof key !== 'string' || typeof value !== 'string' || value.length > 10_000) {
                    return { success: false, error: 'Invalid setting value' };
                }
                if (!ALLOWED_IPC_KEYS.has(key)) {
                    return { success: false, error: 'Setting not allowed via IPC' };
                }
                if (key === 'theme_mode' && !(0, title_bar_theme_1.isThemeMode)(value)) {
                    return { success: false, error: 'Invalid theme_mode value' };
                }
                const db = (0, db_1.getDatabase)();
                db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
                    .run(key, value, (0, db_1.now)());
                return { success: true };
            }
            catch (error) {
                return { success: false, error: getErrorMessage(error) };
            }
        });
    });
    // WhatsApp status snapshot for renderer polling on app focus
    handle('whatsapp-get-status', async () => (0, db_1.withDatabaseRequest)(async () => {
        try {
            return (0, whatsapp_1.getStatus)();
        }
        catch (err) {
            return { error: getErrorMessage(err) };
        }
    }));
    // Module-level reference to ensure single instance
    let activeKdsWindow = null;
    // KDS info
    handle('get-kds-info', async () => {
        const localIP = (0, server_1.getLocalIP)();
        const port = (0, kds_server_1.getKdsPort)();
        return {
            url: `http://${localIP}:${port}/kds`,
            wsUrl: `ws://${localIP}:${port}/kds`,
            localIP,
            port,
        };
    });
    // Window management
    handle('open-kds-window', async () => {
        if (activeKdsWindow && !activeKdsWindow.isDestroyed()) {
            activeKdsWindow.focus();
            return;
        }
        const port = (0, kds_server_1.getKdsPort)();
        const localIP = (0, server_1.getLocalIP)();
        const kdsOrigin = `http://${localIP}:${port}`;
        activeKdsWindow = (0, window_options_1.createKdsWindow)(electron_1.BrowserWindow);
        activeKdsWindow.on('closed', () => {
            activeKdsWindow = null;
        });
        // Confine the KDS window to its own origin and deny new windows so a
        // modified or unexpected document cannot navigate away and reach other
        // local services or content.
        activeKdsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        activeKdsWindow.webContents.on('will-navigate', (event, url) => {
            let allowed = false;
            try {
                allowed = new URL(url).origin === kdsOrigin;
            }
            catch {
                allowed = false;
            }
            if (!allowed)
                event.preventDefault();
        });
        // gh-513: KDS window has no preload and a LAN-IP origin — it learns the
        // current palette from the URL param (read by the root-layout FOUC
        // script), since it can't share the main window's localStorage mirror.
        const kdsUrl = (0, title_bar_theme_1.appendThemeQueryParam)(`${kdsOrigin}/kds`, getCurrentEffectiveIsDark ? getCurrentEffectiveIsDark() : false);
        activeKdsWindow.loadURL(kdsUrl);
    });
    handle('get-app-info', async () => {
        return {
            version: electron_1.app.getVersion(),
            name: electron_1.app.getName(),
            electron: process.versions.electron,
            node: process.versions.node,
            platform: process.platform,
        };
    });
    // Printers
    handle('get-printers', async () => {
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                const db = (0, db_1.getDatabase)();
                const printers = db.prepare('SELECT * FROM printers ORDER BY name').all();
                return printers;
            }
            catch (error) {
                return { error: getErrorMessage(error) };
            }
        });
    });
    handle('save-printer', async (event, printer) => {
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                // Validate printer name — reject names with shell metacharacters (command injection defense)
                const PRINTER_NAME_REGEX = /^[a-zA-Z0-9\s\-_.()]+$/;
                if (printer.name && !PRINTER_NAME_REGEX.test(printer.name)) {
                    return { success: false, error: 'Printer name contains invalid characters' };
                }
                const db = (0, db_1.getDatabase)();
                const port = printer.port === null ? null : (printer.port || 9100);
                if (printer.id) {
                    db.prepare(`
          UPDATE printers SET name = ?, connection_type = ?, ip_address = ?,
            port = ?, is_default = ?, updated_at = ?
          WHERE id = ?
        `).run(printer.name, printer.connection_type, printer.ip_address ?? null, port, printer.is_default ? 1 : 0, (0, db_1.now)(), printer.id);
                }
                else {
                    db.prepare(`
          INSERT INTO printers (id, name, connection_type, ip_address, port, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run((0, node_crypto_1.randomUUID)(), printer.name, printer.connection_type, printer.ip_address ?? null, port, printer.is_default ? 1 : 0, (0, db_1.now)(), (0, db_1.now)());
                }
                return { success: true };
            }
            catch (error) {
                return { success: false, error: getErrorMessage(error) };
            }
        });
    });
    // Reports
    handle('get-daily-summary', async () => {
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                const db = (0, db_1.getDatabase)();
                const today = new Date().toISOString().slice(0, 10);
                const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
                const bills = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM bills WHERE date(paid_at) = date(?)) as bill_count,
          COALESCE((SELECT SUM(paid_amount) FROM bills WHERE date(paid_at) = date(?)), 0)
          - COALESCE((SELECT SUM(CAST(amount_cents AS REAL)) / ? FROM refunds WHERE date(created_at) = date(?)), 0) as revenue
      `).get(today, today, minorFactor, today);
                const covers = db.prepare(`
        SELECT COALESCE(SUM(guest_count), 0) as covers FROM orders
        WHERE date(created_at) = date(?) AND status != 'cancelled'
      `).get(today);
                const pendingOrders = db.prepare(`
        SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'preparing')
      `).get();
                return {
                    date: today,
                    revenue: bills.revenue,
                    bill_count: bills.bill_count,
                    covers: covers.covers,
                    pending_orders: pendingOrders.count,
                };
            }
            catch (error) {
                return { error: getErrorMessage(error) };
            }
        });
    });
    console.log('[IPC] Handlers registered');
}
//# sourceMappingURL=ipc.js.map