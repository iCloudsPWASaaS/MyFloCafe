"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tableRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const crypto_1 = require("crypto");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const kds_1 = require("../services/kds");
const cloud_sync_1 = require("../services/cloud-sync");
const router = (0, express_1.Router)();
const ACTIVE_ORDER_STATUS_SQL = "status NOT IN ('completed', 'cancelled')";
function activeOrderForTable(db, tableId, orderId) {
    const whereOrder = orderId ? ' AND id = ?' : '';
    const params = orderId ? [tableId, orderId] : [tableId];
    const order = (0, db_1.parseRowJson)(db.prepare(`
    SELECT * FROM orders
    WHERE table_id = ? AND ${ACTIVE_ORDER_STATUS_SQL}${whereOrder}
    ORDER BY created_at DESC LIMIT 1
  `).get(...params));
    if (!order?.customer_id)
        return order;
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
    return { ...order, customer: customer || null };
}
function tableShape(table, activeOrder) {
    const currentOrder = activeOrder || null;
    return {
        ...table,
        name: table.number,
        activeOrder: currentOrder,
        current_order: currentOrder,
        seated_at: currentOrder?.created_at ?? null,
    };
}
/** Normalize a customer-facing table name without coercing objects or nullish values. */
function normalizeTableNumber(value) {
    if (typeof value !== 'string' && typeof value !== 'number')
        return null;
    if (typeof value === 'number' && !Number.isFinite(value))
        return null;
    const normalized = String(value).trim();
    return normalized || null;
}
/** Normalize optional floor/section labels and flag non-string payloads as invalid. */
function normalizeOptionalTableLabel(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value !== 'string')
        return undefined;
    return value.trim() || null;
}
/** Accept only positive integer number primitives or their non-empty string representation. */
function normalizeTableCapacity(value) {
    if (typeof value !== 'string' && typeof value !== 'number')
        return null;
    if (typeof value === 'string' && !value.trim())
        return null;
    const normalized = Number(value);
    return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}
router.get('/', (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        let query = 'SELECT * FROM tables WHERE 1=1';
        const params = [];
        if (req.query.status) {
            query += ' AND status = ?';
            params.push(req.query.status);
        }
        if (req.query.floor) {
            query += ' AND floor = ?';
            params.push(req.query.floor);
        }
        if (req.query.section) {
            query += ' AND section = ?';
            params.push(req.query.section);
        }
        if (req.query.kitchen_station_id) {
            query += ' AND kitchen_station_id = ?';
            params.push(req.query.kitchen_station_id);
        }
        if (req.query.active === 'true' || req.query.active === '1') {
            query += ' AND is_active = 1';
        }
        query += ' ORDER BY number';
        const rows = db.prepare(query).all(...params);
        // Normalize: frontend expects `name`, schema column is `number`
        const tables = rows.map((t) => tableShape(t, activeOrderForTable(db, t.id)));
        res.json({ tables });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/:id', (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }
        const activeOrder = activeOrderForTable(db, req.params.id);
        // Normalize: frontend expects `name`, schema column is `number`
        res.json({ table: tableShape(table, activeOrder) });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post('/', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        // Accept `number` (schema column) or `name` (legacy frontend field)
        const { number, name, capacity, floor, section, position_x, position_y, kitchen_station_id } = req.body;
        const tableNumber = normalizeTableNumber(number ?? name);
        if (!tableNumber) {
            return res.status(400).json({ code: 'TABLE_NAME_REQUIRED', error: 'Table number is required' });
        }
        const normalizedCapacity = capacity === undefined ? 4 : normalizeTableCapacity(capacity);
        if (normalizedCapacity === null) {
            return res.status(400).json({ code: 'TABLE_CAPACITY_INVALID', error: 'Capacity must be a positive whole number' });
        }
        const normalizedFloor = normalizeOptionalTableLabel(floor);
        const normalizedSection = normalizeOptionalTableLabel(section);
        if (normalizedFloor === undefined || normalizedSection === undefined) {
            return res.status(400).json({ code: 'TABLE_LOCATION_INVALID', error: 'Floor and section must be text values' });
        }
        const normalizedX = normalizePositionCoord(position_x);
        const normalizedY = normalizePositionCoord(position_y);
        if (normalizedX === undefined || normalizedY === undefined) {
            return res.status(400).json({ error: 'Coordinates must be numbers between 0 and 100, or null' });
        }
        const db = (0, db_1.getDatabase)();
        const existing = db.prepare('SELECT * FROM tables WHERE number = ?').get(tableNumber);
        if (existing) {
            if (existing.is_active === 0) {
                return res.status(400).json({ code: 'TABLE_INACTIVE_DUPLICATE', error: `Table ${tableNumber} already exists but is deactivated. Please reactivate it from the list.` });
            }
            else {
                return res.status(400).json({ code: 'TABLE_NAME_DUPLICATE', error: 'Table number already exists' });
            }
        }
        const tableId = `tbl-${(0, crypto_1.randomUUID)().slice(0, 8)}`;
        const result = db.prepare(`
      INSERT INTO tables (id, number, capacity, floor, section, position_x, position_y, kitchen_station_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tableId, tableNumber, normalizedCapacity, normalizedFloor, normalizedSection, normalizedX, normalizedY, kitchen_station_id || null, (0, db_1.now)(), (0, db_1.now)());
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId);
        res.status(201).json({ table });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Canvas-percentage coordinate: null/undefined clears, otherwise a finite
// 0–100 number. Returns undefined for anything else so callers can reject it.
function normalizePositionCoord(value) {
    if (value === null || value === undefined)
        return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
}
router.patch('/positions', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const raw = req.body?.positions;
        if (!Array.isArray(raw)) {
            return res.status(400).json({ error: 'Positions array is required' });
        }
        const updates = [];
        for (const item of raw) {
            if (!item || typeof item.id !== 'string' || !item.id.trim()) {
                return res.status(400).json({ error: 'Invalid table ID in positions payload' });
            }
            const x = normalizePositionCoord(item.position_x);
            const y = normalizePositionCoord(item.position_y);
            if (x === undefined || y === undefined) {
                return res.status(400).json({ error: 'Coordinates must be numbers between 0 and 100, or null' });
            }
            updates.push({ id: item.id.trim(), position_x: x, position_y: y });
        }
        const db = (0, db_1.getDatabase)();
        if (updates.length > 0) {
            const rows = db.prepare(`SELECT id FROM tables WHERE id IN (${updates.map(() => '?').join(',')})`).all(...updates.map((u) => u.id));
            const found = new Set(rows.map((r) => r.id));
            const missing = updates.find((u) => !found.has(u.id));
            if (missing) {
                return res.status(404).json({ error: `Table not found: ${missing.id}` });
            }
        }
        (0, db_1.withTxn)(() => {
            const stmt = db.prepare(`
        UPDATE tables SET
          position_x = ?,
          position_y = ?,
          updated_at = ?
        WHERE id = ?
      `);
            const currentTime = (0, db_1.now)();
            for (const u of updates) {
                stmt.run(u.position_x, u.position_y, currentTime, u.id);
            }
        });
        res.json({ success: true, count: updates.length });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put('/:id', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { number, name, capacity, floor, section, position_x, position_y, kitchen_station_id } = req.body;
        const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key);
        const hasTableNumber = has('number') || has('name');
        const tableNumber = hasTableNumber ? normalizeTableNumber(has('number') ? number : name) : undefined;
        const db = (0, db_1.getDatabase)();
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }
        if (hasTableNumber && !tableNumber) {
            return res.status(400).json({ code: 'TABLE_NAME_REQUIRED', error: 'Table number is required' });
        }
        const normalizedCapacity = has('capacity') ? normalizeTableCapacity(capacity) : table.capacity;
        if (normalizedCapacity === null) {
            return res.status(400).json({ code: 'TABLE_CAPACITY_INVALID', error: 'Capacity must be a positive whole number' });
        }
        const normalizedFloor = has('floor') ? normalizeOptionalTableLabel(floor) : table.floor;
        const normalizedSection = has('section') ? normalizeOptionalTableLabel(section) : table.section;
        const normalizedX = has('position_x') ? normalizePositionCoord(position_x) : table.position_x;
        const normalizedY = has('position_y') ? normalizePositionCoord(position_y) : table.position_y;
        if (normalizedX === undefined || normalizedY === undefined) {
            return res.status(400).json({ error: 'Coordinates must be numbers between 0 and 100, or null' });
        }
        if (normalizedFloor === undefined || normalizedSection === undefined) {
            return res.status(400).json({ code: 'TABLE_LOCATION_INVALID', error: 'Floor and section must be text values' });
        }
        if (hasTableNumber) {
            const existing = db.prepare('SELECT * FROM tables WHERE number = ? AND id != ?').get(tableNumber, req.params.id);
            if (existing) {
                return res.status(400).json({ code: 'TABLE_NAME_DUPLICATE', error: 'Table number already exists' });
            }
        }
        db.prepare(`
      UPDATE tables SET
        number = ?,
        capacity = ?,
        floor = ?,
        section = ?,
        position_x = ?,
        position_y = ?,
        kitchen_station_id = ?,
        updated_at = ?
      WHERE id = ?
    `).run(hasTableNumber ? tableNumber : table.number, normalizedCapacity, normalizedFloor, normalizedSection, normalizedX, normalizedY, has('kitchen_station_id') ? kitchen_station_id : table.kitchen_station_id, (0, db_1.now)(), req.params.id);
        const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        res.json({ table: tableShape(updated, activeOrderForTable(db, req.params.id)) });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post('/:id/deactivate', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }
        if (table.is_active === 0) {
            return res.status(400).json({ error: 'Already deactivated' });
        }
        const activeOrder = db.prepare(`
      SELECT * FROM orders WHERE table_id = ? AND ${ACTIVE_ORDER_STATUS_SQL}
    `).get(req.params.id);
        if (activeOrder) {
            return res.status(400).json({ error: 'Cannot deactivate table with active orders' });
        }
        db.prepare('UPDATE tables SET is_active = 0, updated_at = ? WHERE id = ?').run((0, db_1.now)(), req.params.id);
        const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        res.json({ table: tableShape(updated) });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post('/:id/reactivate', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }
        if (table.is_active === 1) {
            return res.status(400).json({ error: 'Already active' });
        }
        db.prepare('UPDATE tables SET is_active = 1, updated_at = ? WHERE id = ?').run((0, db_1.now)(), req.params.id);
        const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        res.json({ table: tableShape(updated) });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post('/:id/move-order', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.sales), (req, res) => {
    try {
        const sourceTableId = req.params.id;
        const { target_table_id, order_id } = req.body;
        if (!target_table_id) {
            return res.status(400).json({ error: 'target_table_id is required' });
        }
        if (target_table_id === sourceTableId) {
            return res.status(400).json({ error: 'Order is already on this table' });
        }
        const db = (0, db_1.getDatabase)();
        const moved = (0, db_1.withTxn)(() => {
            const sourceTable = db.prepare('SELECT * FROM tables WHERE id = ?').get(sourceTableId);
            if (!sourceTable) {
                const error = new Error('Source table not found');
                error.status = 404;
                throw error;
            }
            const targetTable = db.prepare('SELECT * FROM tables WHERE id = ?').get(target_table_id);
            if (!targetTable) {
                const error = new Error('Target table not found');
                error.status = 404;
                throw error;
            }
            const order = activeOrderForTable(db, sourceTableId, order_id);
            if (!order) {
                const error = new Error(order_id ? 'Active order not found on source table' : 'Source table has no active order');
                error.status = 404;
                throw error;
            }
            const targetActiveOrder = activeOrderForTable(db, target_table_id);
            if (targetActiveOrder) {
                const error = new Error('Target table already has an active order');
                error.status = 409;
                throw error;
            }
            const nowStr = (0, db_1.now)();
            db.prepare('UPDATE orders SET table_id = ?, type = ?, updated_at = ? WHERE id = ?')
                .run(target_table_id, order.type, nowStr, order.id);
            db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?")
                .run(nowStr, sourceTableId);
            db.prepare("UPDATE tables SET status = 'occupied', updated_at = ? WHERE id = ?")
                .run(nowStr, target_table_id);
            const updatedOrder = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id));
            const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
            const updatedSource = db.prepare('SELECT * FROM tables WHERE id = ?').get(sourceTableId);
            const updatedTarget = db.prepare('SELECT * FROM tables WHERE id = ?').get(target_table_id);
            return {
                order: {
                    ...updatedOrder,
                    items,
                    table: { ...updatedTarget, name: updatedTarget.number },
                },
                sourceTable: tableShape(updatedSource, activeOrderForTable(db, sourceTableId)),
                targetTable: tableShape(updatedTarget, activeOrderForTable(db, target_table_id)),
            };
        });
        cloud_sync_1.cloudSync.recordOrderChanged(moved.order.id, 'order.table_moved');
        (0, kds_1.notifyKdsUpdate)();
        res.json({
            order: moved.order,
            sourceTable: moved.sourceTable,
            targetTable: moved.targetTable,
        });
    }
    catch (error) {
        const statusCode = error.status || 500;
        console.error('[API] Table move failed:', error);
        res.status(statusCode).json({ error: statusCode >= 500 ? 'Table move failed' : error.message });
    }
});
router.patch('/:id/status', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }
        const validStatuses = ['available', 'occupied', 'reserved', 'cleaning', 'held'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
        }
        const db = (0, db_1.getDatabase)();
        const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        if (!table) {
            return res.status(404).json({ error: 'Table not found' });
        }
        db.prepare('UPDATE tables SET status = ?, updated_at = ? WHERE id = ?')
            .run(status, (0, db_1.now)(), req.params.id);
        const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
        res.json({ table: updated });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.tableRoutes = router;
//# sourceMappingURL=tables.js.map