"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.heldOrderRoutes = void 0;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const db_1 = require("../db");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const crypto_1 = require("crypto");
const orders_validation_1 = require("./orders-validation");
const router = (0, express_1.Router)();
const heldOrderReadRateLimit = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
const heldOrderWriteRateLimit = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const TABLE_STATUS_HELD = 'held';
const TABLE_STATUS_AVAILABLE = 'available';
const MAX_HELD_ORDER_ITEMS = 100;
const MAX_IDENTIFIER_LENGTH = 128;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isValidIdentifier(value) {
    return (typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_IDENTIFIER_LENGTH)
        || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
}
function validateHeldOrderItem(item, db) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0 || item.id.length > MAX_IDENTIFIER_LENGTH) {
        throw new Error('Each held-order item must have a valid id');
    }
    if (!isRecord(item.product) || !isValidIdentifier(item.product.id)) {
        throw new Error('Each held-order item must have a valid product');
    }
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error('Each held-order item must have a positive quantity');
    }
    if (!Number.isInteger(item.quantity)) {
        const product = db.prepare('SELECT name, sale_unit, allow_fractional_quantity, weight_precision FROM products WHERE id = ? AND deleted_at IS NULL').get(item.product.id);
        if (!product)
            throw new Error('Fractional held-order items must reference a catalog product');
        (0, orders_validation_1.validateProductQuantity)(product, item.quantity);
    }
    if (!Array.isArray(item.addons) || item.addons.some((addon) => !isRecord(addon) || !isValidIdentifier(addon.id))) {
        throw new Error('Held-order item addons must be an array of valid addons');
    }
    if (item.special_instructions !== undefined && typeof item.special_instructions !== 'string') {
        throw new Error('Item special instructions must be a string');
    }
    (0, orders_validation_1.validateItemNotes)(db, item.special_instructions);
}
function validateHeldOrderInput(body, db) {
    if (!isRecord(body)) {
        throw new Error('Request body must be an object');
    }
    const { tableId, items, customerId, guestCount, orderNotes } = body;
    if (typeof tableId !== 'string' || tableId.trim().length === 0 || tableId.length > MAX_IDENTIFIER_LENGTH) {
        throw new Error('tableId must be a non-empty string');
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_HELD_ORDER_ITEMS) {
        throw new Error(`items must contain between 1 and ${MAX_HELD_ORDER_ITEMS} items`);
    }
    items.forEach((item) => validateHeldOrderItem(item, db));
    if (customerId !== undefined && customerId !== null && !isValidIdentifier(customerId)) {
        throw new Error('customerId must be a valid identifier');
    }
    if (guestCount !== undefined && (!Number.isSafeInteger(guestCount) || guestCount <= 0)) {
        throw new Error('guestCount must be a positive integer');
    }
    if (orderNotes !== undefined && orderNotes !== null && typeof orderNotes !== 'string') {
        throw new Error('orderNotes must be a string');
    }
    (0, orders_validation_1.validateOrderNotes)(db, orderNotes);
    return {
        tableId,
        items,
        customerId: customerId ?? null,
        guestCount: guestCount ?? 1,
        orderNotes: orderNotes ?? '',
    };
}
function parseStoredHeldOrder(row) {
    try {
        const items = JSON.parse(row.items);
        if (!Array.isArray(items) || items.length === 0 || items.length > MAX_HELD_ORDER_ITEMS || items.some((item) => !isRecord(item))) {
            return null;
        }
        return {
            id: row.id,
            tableId: row.table_id,
            items,
            customerId: row.customer_id,
            guestCount: Number.isSafeInteger(row.guest_count) && row.guest_count > 0 ? row.guest_count : 1,
            orderNotes: row.order_notes || '',
            heldAt: row.created_at,
        };
    }
    catch {
        return null;
    }
}
router.get('/', heldOrderReadRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.sales), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const rows = db.prepare('SELECT * FROM held_orders ORDER BY updated_at DESC').all();
        const orders = [];
        let skippedCount = 0;
        for (const row of rows) {
            const order = parseStoredHeldOrder(row);
            if (order)
                orders.push(order);
            else {
                skippedCount++;
                console.warn(`[API] Skipping malformed held order ${row.id}`);
            }
        }
        res.json({ orders, skippedCount });
    }
    catch (error) {
        console.error("[API] Held orders fetch error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post('/', heldOrderWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.sales), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        let input;
        try {
            input = validateHeldOrderInput(req.body, db);
        }
        catch (error) {
            return res.status(400).json({ error: error.message });
        }
        const { tableId, items, customerId, guestCount, orderNotes } = input;
        let heldOrderId = '';
        (0, db_1.withTxn)(() => {
            const existing = db.prepare('SELECT id FROM held_orders WHERE table_id = ?').get(tableId);
            heldOrderId = `ho-${(0, crypto_1.randomUUID)().slice(0, 8)}`;
            if (existing) {
                db.prepare(`
          UPDATE held_orders
          SET id = ?, items = ?, customer_id = ?, guest_count = ?, order_notes = ?, updated_at = ?
          WHERE id = ?
        `).run(heldOrderId, JSON.stringify(items), customerId || null, guestCount || 1, orderNotes || '', (0, db_1.now)(), existing.id);
            }
            else {
                db.prepare(`
          INSERT INTO held_orders (id, table_id, items, customer_id, guest_count, order_notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(heldOrderId, tableId, JSON.stringify(items), customerId || null, guestCount || 1, orderNotes || '', (0, db_1.now)(), (0, db_1.now)());
            }
            db.prepare('UPDATE tables SET status = ?, updated_at = ? WHERE id = ?').run(TABLE_STATUS_HELD, (0, db_1.now)(), tableId);
        });
        // Returning the current row identity lets a client prove that its cached
        // snapshot is still the row it is consuming. Replacing a held order gets
        // a new identity, so an older terminal receives deleted:false instead of
        // deleting the replacement.
        res.json({ success: true, id: heldOrderId });
    }
    catch (error) {
        console.error("[API] Hold order error:", error);
        res.status(500).json({ error: "Could not hold order" });
    }
});
router.delete('/:tableId', heldOrderWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.sales), (req, res) => {
    try {
        const tableId = req.params.tableId;
        const expectedHeldOrderId = typeof req.query.heldOrderId === 'string' && req.query.heldOrderId.length > 0
            ? req.query.heldOrderId
            : null;
        if (!expectedHeldOrderId) {
            return res.json({ success: true, deleted: false });
        }
        const db = (0, db_1.getDatabase)();
        let deleted = false;
        (0, db_1.withTxn)(() => {
            const existing = db.prepare('SELECT id FROM held_orders WHERE table_id = ?').get(tableId);
            if (existing && existing.id === expectedHeldOrderId) {
                db.prepare('DELETE FROM held_orders WHERE table_id = ?').run(tableId);
                db.prepare('UPDATE tables SET status = ?, updated_at = ? WHERE id = ? AND status = ?').run(TABLE_STATUS_AVAILABLE, (0, db_1.now)(), tableId, TABLE_STATUS_HELD);
                deleted = true;
            }
        });
        // Deletion is intentionally idempotent. A held order may have been resumed
        // or deleted by another terminal between the UI's last refresh and this
        // request; that is already the desired end state, not an application error.
        res.json({ success: true, deleted });
    }
    catch (error) {
        console.error("[API] Delete held order error:", error);
        res.status(500).json({ error: "Could not delete held order" });
    }
});
exports.heldOrderRoutes = router;
//# sourceMappingURL=held-orders.js.map