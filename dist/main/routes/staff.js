"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffRoutes = void 0;
/**
 * /api/staff  — alias for /api/users, kept for frontend compatibility.
 * All user records live in the `users` table.
 * Roles: owner | manager | cashier | server | chef
 * The chef role is used by KDS displays.
 */
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const security_1 = require("../middleware/security");
const auth_1 = require("./auth");
const role_permissions_1 = require("../../shared/role-permissions");
const router = (0, express_1.Router)();
const VALID_ROLES = role_permissions_1.ROLE_KEYS;
const STAFF_SELECT_FIELDS = 'id, name, email, role, (pin_hash IS NOT NULL) AS has_pin, is_active, created_at, updated_at';
function canModifyTargetStaff(requesterRole, targetRole) {
    if (requesterRole === 'owner')
        return true;
    if (requesterRole === 'manager')
        return !(0, role_permissions_1.hasRole)(targetRole, role_permissions_1.ROLE_ACCESS.ownerManager);
    return false;
}
function isOperationalRole(role) {
    return (0, role_permissions_1.hasRole)(role, role_permissions_1.OPERATIONAL_ROLES);
}
function hasNonEmptyPin(pin) {
    return pin !== undefined && pin !== null && String(pin).length > 0;
}
function isValidPin(pin) {
    return /^\d{4,6}$/.test(String(pin));
}
function normalizeStaffEmail(email) {
    return String(email || '').trim().toLowerCase();
}
// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        let query = `SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE 1=1`;
        const params = [];
        if (req.query.role) {
            if (typeof req.query.role !== 'string' || !VALID_ROLES.includes(req.query.role)) {
                return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
            }
            query += ' AND role = ?';
            params.push(req.query.role);
        }
        if (req.query.active === 'true') {
            query += ' AND is_active = 1';
        }
        if (req.query.active === 'false') {
            query += ' AND is_active = 0';
        }
        query += ' ORDER BY role, name';
        const staff = db.prepare(query).all(...params);
        res.json({ staff });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ── Get one ───────────────────────────────────────────────────────────────────
router.get('/:id', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const member = db.prepare(`SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE id = ?`).get(req.params.id);
        if (!member) {
            return res.status(404).json({ error: 'Staff member not found' });
        }
        const performance = db.prepare(`
      SELECT COUNT(*) as orders_served, COALESCE(SUM(total), 0) as total_sales
      FROM orders
      WHERE user_id = ? AND date(created_at) = date('now')
    `).get(req.params.id);
        res.json({ staff: { ...member, performance } });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (0, security_1.authRateLimit)(), (req, res) => {
    try {
        const { name, email, password, role, pin } = req.body;
        const normalizedEmail = normalizeStaffEmail(email);
        if (!name || !normalizedEmail || !password || !role) {
            return res.status(400).json({ error: 'name, email, password, and role are required' });
        }
        if (!(0, auth_1.isValidEmail)(normalizedEmail)) {
            return res.status(400).json({ error: 'Enter a valid email address' });
        }
        if (!(0, security_1.validatePassword)(password)) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number.' });
        }
        if (!VALID_ROLES.includes(role)) {
            return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
        }
        const requesterRole = req.user.role;
        if (requesterRole === 'manager' && !isOperationalRole(role)) {
            return res.status(403).json({ error: `Managers can only create operational staff accounts (${role_permissions_1.OPERATIONAL_ROLES.join(', ')})` });
        }
        if (isOperationalRole(role) && hasNonEmptyPin(pin)) {
            return res.status(400).json({ error: 'PINs are only permitted for owner and manager roles' });
        }
        if (hasNonEmptyPin(pin) && !isValidPin(pin)) {
            return res.status(400).json({ error: 'PIN must be between 4 and 6 numeric digits' });
        }
        const db = (0, db_1.getDatabase)();
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
        if (existing) {
            return res.status(400).json({ error: 'Email already in use' });
        }
        const id = (0, node_crypto_1.randomUUID)();
        const hashedPassword = bcryptjs_1.default.hashSync(password, 10);
        const hashedPin = hasNonEmptyPin(pin) ? bcryptjs_1.default.hashSync(String(pin), 10) : null;
        db.prepare(`
      INSERT INTO users (id, name, email, password, role, pin_hash, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, name, normalizedEmail, hashedPassword, role, hashedPin, (0, db_1.now)(), (0, db_1.now)());
        const member = db.prepare(`SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE id = ?`).get(id);
        res.status(201).json({ staff: member });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ── Update ────────────────────────────────────────────────────────────────────
router.put('/:id', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (0, security_1.authRateLimit)(), (req, res) => {
    try {
        const { name, email, password, role, pin, is_active } = req.body;
        const emailProvided = email !== undefined;
        const normalizedEmail = emailProvided ? normalizeStaffEmail(email) : undefined;
        const db = (0, db_1.getDatabase)();
        if (is_active !== undefined) {
            return res.status(400).json({ error: 'Use /deactivate or /reactivate endpoints to change account status' });
        }
        const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!member) {
            return res.status(404).json({ error: 'Staff member not found' });
        }
        const requesterRole = req.user.role;
        if (!canModifyTargetStaff(requesterRole, member.role)) {
            return res.status(403).json({ error: 'Managers cannot modify owner or manager accounts' });
        }
        if (role !== undefined) {
            if (!VALID_ROLES.includes(role)) {
                return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
            }
            if (role !== member.role && requesterRole !== 'owner') {
                return res.status(403).json({ error: 'Only owners can change roles' });
            }
        }
        const targetRole = role ?? member.role;
        if (isOperationalRole(targetRole) && hasNonEmptyPin(pin)) {
            return res.status(400).json({ error: 'PINs are only permitted for owner and manager roles' });
        }
        if (hasNonEmptyPin(pin) && !isValidPin(pin)) {
            return res.status(400).json({ error: 'PIN must be between 4 and 6 numeric digits' });
        }
        if (emailProvided && !normalizedEmail) {
            return res.status(400).json({ error: 'email is required' });
        }
        if (normalizedEmail && !(0, auth_1.isValidEmail)(normalizedEmail)) {
            return res.status(400).json({ error: 'Enter a valid email address' });
        }
        if (normalizedEmail && normalizedEmail !== member.email) {
            const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, req.params.id);
            if (existing) {
                return res.status(400).json({ error: 'Email already in use' });
            }
        }
        if (password && !(0, security_1.validatePassword)(password)) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number.' });
        }
        const hashedPassword = password ? bcryptjs_1.default.hashSync(password, 10) : member.password;
        const hashedPin = isOperationalRole(targetRole)
            ? null
            : pin !== undefined
                ? (hasNonEmptyPin(pin) ? bcryptjs_1.default.hashSync(String(pin), 10) : null)
                : member.pin_hash;
        // Revoke this user's outstanding sessions only when a credential actually
        // changed (not on a bare name/email/role edit) — matches auth.ts's
        // password/change and recover-password (#173).
        const credentialsChanged = hashedPassword !== member.password || hashedPin !== member.pin_hash;
        const tokensValidAfter = credentialsChanged ? (0, db_1.now)() : member.tokens_valid_after;
        const demotesActiveOwner = member.role === 'owner' && member.is_active === 1 && targetRole !== 'owner';
        const result = db.prepare(`
      UPDATE users SET
        name       = COALESCE(?, name),
        email      = COALESCE(?, email),
        password   = ?,
        role       = COALESCE(?, role),
        pin_hash   = ?,
        tokens_valid_after = ?,
        updated_at = ?
      WHERE id = ?
        AND (
          ? = 0
          OR (SELECT COUNT(*) FROM users WHERE role = 'owner' AND is_active = 1) > 1
        )
    `).run(name || null, normalizedEmail || null, hashedPassword, role || null, hashedPin, tokensValidAfter, (0, db_1.now)(), req.params.id, demotesActiveOwner ? 1 : 0);
        if (result.changes === 0) {
            return res.status(400).json({ error: 'Cannot change the role of the last active owner. Create or promote another active owner first.' });
        }
        (0, security_1.invalidateUserAuthCache)(req.params.id);
        const updated = db.prepare(`SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE id = ?`).get(req.params.id);
        res.json({ staff: updated });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ── Activate / Deactivate ─────────────────────────────────────────────────────
// Staff are never hard-deleted — orders.user_id and print_logs.user_id reference
// them, and losing the row would orphan historical order/print records.
// Deactivating is the only removal path.
router.post('/:id/deactivate', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!member)
            return res.status(404).json({ error: 'Staff member not found' });
        if (member.is_active === 0)
            return res.status(400).json({ error: 'Already deactivated' });
        if (!canModifyTargetStaff(req.user.role, member.role)) {
            return res.status(403).json({ error: 'Managers cannot deactivate or reactivate owner or manager accounts' });
        }
        const changedAt = (0, db_1.now)();
        const result = db.prepare(`
      UPDATE users SET is_active = 0, tokens_valid_after = ?, updated_at = ?
      WHERE id = ? AND is_active = 1
        AND (role != 'owner' OR (SELECT COUNT(*) FROM users WHERE role = 'owner' AND is_active = 1) > 1)
    `).run(changedAt, changedAt, req.params.id);
        if (result.changes === 0) {
            return res.status(400).json({ error: 'Cannot deactivate the last owner account' });
        }
        (0, security_1.invalidateUserAuthCache)(req.params.id);
        const updated = db.prepare(`SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE id = ?`).get(req.params.id);
        res.json({ staff: updated });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post('/:id/reactivate', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!member)
            return res.status(404).json({ error: 'Staff member not found' });
        if (member.is_active === 1)
            return res.status(400).json({ error: 'Already active' });
        if (!canModifyTargetStaff(req.user.role, member.role)) {
            return res.status(403).json({ error: 'Managers cannot deactivate or reactivate owner or manager accounts' });
        }
        db.prepare('UPDATE users SET is_active = 1, updated_at = ? WHERE id = ?').run((0, db_1.now)(), req.params.id);
        (0, security_1.invalidateUserAuthCache)(req.params.id);
        const updated = db.prepare(`SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE id = ?`).get(req.params.id);
        res.json({ staff: updated });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.staffRoutes = router;
//# sourceMappingURL=staff.js.map