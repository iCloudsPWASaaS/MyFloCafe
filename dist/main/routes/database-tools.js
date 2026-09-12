"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseToolsRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const security_1 = require("../middleware/security");
const master_pin_1 = require("../middleware/master-pin");
const async_handler_1 = require("../middleware/async-handler");
const schema_health_1 = require("../services/schema-health");
const master_pin_2 = require("../services/master-pin");
const auth_1 = require("./auth");
const shutdown_1 = require("../shutdown");
const role_permissions_1 = require("../../shared/role-permissions");
const router = (0, express_1.Router)();
// Read-only / additive-only — not master-PIN gated, only owner-gated.
router.get('/health-check', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (_req, res) => {
    try {
        res.json((0, schema_health_1.runHealthCheck)());
    }
    catch (error) {
        console.error('[DB Tools] health-check error:', error);
        res.status(500).json({ error: 'Health check failed' });
    }
});
router.post('/apply-safe-fixes', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    try {
        const body = (req.body && typeof req.body === 'object' ? req.body : {});
        const { findingIds } = body;
        if (findingIds !== undefined && (!Array.isArray(findingIds) || findingIds.some((id) => typeof id !== 'string'))) {
            return res.status(400).json({ error: 'findingIds must be an array of finding id strings' });
        }
        res.json((0, schema_health_1.applySafeFixes)(findingIds));
    }
    catch (error) {
        console.error('[DB Tools] apply-safe-fixes error:', error);
        res.status(500).json({ error: 'Applying fixes failed' });
    }
});
// Read-only listing of the managed backups/ directory (#120). Not master-PIN
// gated — same read-only rationale as /health-check.
router.get('/backups', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (_req, res) => {
    try {
        res.json({ backups: (0, db_1.listBackups)() });
    }
    catch (error) {
        console.error('[DB Tools] list backups error:', error);
        res.status(500).json({ error: 'Listing backups failed' });
    }
});
// Deletes one backup from the managed backups/ directory (#120) — same
// master-PIN gate as creating one, since a backup is the safety net a
// restore/initialize depends on.
router.post('/backups/:fileName/delete', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), master_pin_1.requireMasterPin, (req, res) => {
    try {
        (0, db_1.deleteBackup)(req.params.fileName);
        res.json({ success: true });
    }
    catch (error) {
        console.error('[DB Tools] delete backup error:', error);
        if (error?.code === 'ERR_INVALID_BACKUP_NAME') {
            return res.status(400).json({ error: 'Invalid backup file name' });
        }
        if (error?.code === 'ERR_BACKUP_NOT_FOUND') {
            return res.status(404).json({ error: 'Backup not found' });
        }
        res.status(500).json({ error: 'Deleting backup failed' });
    }
});
router.get('/master-pin/status', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (_req, res) => {
    res.json({ available: (0, master_pin_2.isMasterPinAvailable)(), isSet: (0, master_pin_2.isMasterPinSet)(), schemaVersion: (0, db_1.getCurrentSchemaVersion)() });
});
router.post('/master-pin/reset', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    const { pin, confirm_pin } = req.body;
    const cleanPin = String(pin || '').trim();
    if (!/^\d{4}$/.test(cleanPin)) {
        return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }
    if (cleanPin !== confirm_pin) {
        return res.status(400).json({ error: 'PINs do not match' });
    }
    if (!(0, master_pin_2.isMasterPinAvailable)()) {
        return res.status(409).json({ error: 'Master PIN is not available on this device' });
    }
    try {
        (0, master_pin_2.resetMasterPin)(cleanPin);
        res.json({ success: true });
    }
    catch (error) {
        console.error('[DB Tools] set Master PIN error:', error);
        res.status(500).json({ error: 'Failed to set Master PIN' });
    }
});
const INITIALIZE_CONFIRM_PHRASE = 'INITIALIZE';
router.post('/initialize', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (req.body?.confirmation_phrase !== INITIALIZE_CONFIRM_PHRASE) {
        return res.status(400).json({ error: `Type "${INITIALIZE_CONFIRM_PHRASE}" to confirm` });
    }
    try {
        const { backupPath } = await (0, db_1.resetDatabaseWithBackup)((0, shutdown_1.getHttpRequestSignal)(req));
        (0, security_1.clearUserAuthCache)();
        (0, security_1.clearInMemoryRevokedTokens)();
        (0, auth_1.clearJWTSecretCache)();
        res.json({ success: true, backupPath });
    }
    catch (error) {
        console.error('[DB Tools] initialize error:', error);
        res.status(500).json({ error: 'Initialize failed' });
    }
}));
exports.databaseToolsRoutes = router;
//# sourceMappingURL=database-tools.js.map