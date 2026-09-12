"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kitchenStationRoutes = void 0;
const express_1 = require("express");
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const router = (0, express_1.Router)();
router.get('/', (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const stations = db.prepare('SELECT * FROM kitchen_stations WHERE is_active = 1 ORDER BY sort_order, name').all();
        res.json({ kitchenStations: stations });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/:id', (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const station = db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(req.params.id);
        if (!station) {
            return res.status(404).json({ error: 'Kitchen station not found' });
        }
        const tables = db.prepare('SELECT * FROM tables WHERE kitchen_station_id = ?').all(req.params.id);
        const users = db.prepare(`
      SELECT u.id, u.name, u.role FROM station_users su
      JOIN users u ON u.id = su.user_id
      WHERE su.station_id = ?
    `).all(req.params.id);
        const printer = station.printer_id
            ? db.prepare('SELECT * FROM printers WHERE id = ?').get(station.printer_id)
            : null;
        res.json({ kitchenStation: { ...station, tables, users, printer } });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post('/', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { name, description, category_ids, printer_id, printer_ip, printer_port, printer_name, sort_order } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }
        const db = (0, db_1.getDatabase)();
        if (printer_id !== undefined && printer_id !== null) {
            if (typeof printer_id !== 'string' || printer_id.trim().length === 0) {
                return res.status(400).json({ error: 'printer_id must be a valid printer ID or null' });
            }
            const printer = db.prepare('SELECT id FROM printers WHERE id = ?').get(printer_id);
            if (!printer)
                return res.status(400).json({ error: 'printer_id does not match an existing printer' });
        }
        const id = (0, node_crypto_1.randomUUID)();
        db.prepare(`
      INSERT INTO kitchen_stations (id, name, description, category_ids, printer_id, printer_ip, printer_port, printer_name, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description || null, category_ids ? JSON.stringify(category_ids) : null, printer_id ?? null, printer_ip || null, printer_port || 9100, printer_name || null, sort_order || 0, (0, db_1.now)(), (0, db_1.now)());
        const station = db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(id);
        res.status(201).json({ kitchenStation: station });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put('/:id', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { name, description, category_ids, printer_id, printer_ip, printer_port, printer_name, sort_order, is_active } = req.body;
        const db = (0, db_1.getDatabase)();
        const station = db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(req.params.id);
        if (!station) {
            return res.status(404).json({ error: 'Kitchen station not found' });
        }
        if (printer_id !== undefined && printer_id !== null) {
            if (typeof printer_id !== 'string' || printer_id.trim().length === 0) {
                return res.status(400).json({ error: 'printer_id must be a valid printer ID or null' });
            }
            const printer = db.prepare('SELECT id FROM printers WHERE id = ?').get(printer_id);
            if (!printer)
                return res.status(400).json({ error: 'printer_id does not match an existing printer' });
        }
        const fields = {
            name,
            description,
            category_ids: category_ids !== undefined ? JSON.stringify(category_ids) : undefined,
            printer_id,
            printer_ip,
            printer_port: printer_port !== undefined ? (printer_port || 9100) : undefined,
            printer_name,
            sort_order,
            is_active,
        };
        const sets = [];
        const params = [];
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined) {
                sets.push(`${key} = ?`);
                params.push(value);
            }
        }
        sets.push('updated_at = ?');
        params.push((0, db_1.now)(), req.params.id);
        db.prepare(`UPDATE kitchen_stations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        const updated = db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(req.params.id);
        res.json({ kitchenStation: updated });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// PUT /api/kitchen-stations/:id/users — replace the full set of staff logins assigned to this station
router.put('/:id/users', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { user_ids } = req.body;
        if (!Array.isArray(user_ids)) {
            return res.status(400).json({ error: 'user_ids must be an array' });
        }
        if (user_ids.length > 100 || user_ids.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 128)) {
            return res.status(400).json({ error: 'user_ids must contain at most 100 valid user IDs' });
        }
        const db = (0, db_1.getDatabase)();
        const station = db.prepare('SELECT id FROM kitchen_stations WHERE id = ?').get(req.params.id);
        if (!station) {
            return res.status(404).json({ error: 'Kitchen station not found' });
        }
        if (user_ids.length > 0) {
            const placeholders = user_ids.map(() => '?').join(',');
            const found = db.prepare(`SELECT id FROM users WHERE id IN (${placeholders})`).all(...user_ids);
            if (found.length !== user_ids.length) {
                return res.status(400).json({ error: 'One or more user_ids do not match an existing user' });
            }
        }
        const previousUserIds = db.prepare('SELECT user_id FROM station_users WHERE station_id = ?').all(req.params.id).map((row) => row.user_id);
        const applyAssignments = db.transaction((ids) => {
            const affectedUserIds = [...new Set([...previousUserIds, ...ids])];
            if (affectedUserIds.length > 0) {
                const placeholders = affectedUserIds.map(() => '?').join(',');
                db.prepare(`UPDATE users SET station_assignments_configured = 1 WHERE id IN (${placeholders})`).run(...affectedUserIds);
            }
            db.prepare('DELETE FROM station_users WHERE station_id = ?').run(req.params.id);
            const insert = db.prepare('INSERT INTO station_users (user_id, station_id, created_at) VALUES (?, ?, ?)');
            for (const userId of ids) {
                insert.run(userId, req.params.id, (0, db_1.now)());
            }
        });
        applyAssignments(user_ids);
        const users = db.prepare(`
      SELECT u.id, u.name, u.role FROM station_users su
      JOIN users u ON u.id = su.user_id
      WHERE su.station_id = ?
    `).all(req.params.id);
        res.json({ users });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.delete('/:id', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const station = db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(req.params.id);
        if (!station) {
            return res.status(404).json({ error: 'Kitchen station not found' });
        }
        const assignedTables = db.prepare('SELECT * FROM tables WHERE kitchen_station_id = ?').all(req.params.id);
        if (assignedTables.length > 0) {
            return res.status(400).json({ error: 'Cannot delete station with assigned tables' });
        }
        db.prepare('UPDATE kitchen_stations SET is_active = 0, updated_at = ? WHERE id = ?').run((0, db_1.now)(), req.params.id);
        res.json({ message: 'Kitchen station deleted' });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.kitchenStationRoutes = router;
//# sourceMappingURL=kitchen-stations.js.map