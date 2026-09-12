"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderItemRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const kds_1 = require("../services/kds");
const auth_1 = require("./auth");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const router = (0, express_1.Router)();
// PATCH /api/order-items/:id/status — update a single item's kitchen status
router.patch('/:id/status', security_1.requireKdsEnabled, (req, res) => {
    try {
        const role = req.user?.role;
        if (!(0, role_permissions_1.hasRole)(role, role_permissions_1.ROLE_ACCESS.kitchen)) {
            return res.status(403).json({ error: 'Only chef, manager, or owner can update item status' });
        }
        const itemId = req.params.id;
        if (!itemId) {
            return res.status(400).json({ error: 'Order item ID is required' });
        }
        const { status, expected_status: expectedStatus } = req.body;
        const validStatuses = ['pending', 'preparing', 'ready', 'served'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: `Valid status required: ${validStatuses.join(', ')}` });
        }
        if (expectedStatus !== undefined && !validStatuses.includes(expectedStatus)) {
            return res.status(400).json({ error: `Invalid expected status. Use: ${validStatuses.join(', ')}` });
        }
        const db = (0, db_1.getDatabase)();
        const userId = req.user?.userId;
        const currentUser = userId
            ? db.prepare('SELECT role, category_ids FROM users WHERE id = ? AND is_active = 1').get(userId)
            : undefined;
        if (!currentUser)
            return res.status(403).json({ error: 'User account is not active' });
        let categoryIds = (0, role_permissions_1.hasRole)(currentUser.role, role_permissions_1.ROLE_ACCESS.ownerManager)
            ? []
            : (0, auth_1.parseCategoryIds)(currentUser.category_ids);
        const loadedStationIds = (0, db_1.getUserKdsStationIds)(db, userId);
        const hasStationAssignments = (0, db_1.hasUserKdsStationAssignments)(db, userId);
        if (!loadedStationIds || hasStationAssignments === null)
            return res.status(403).json({ error: 'User account is not active' });
        if (hasStationAssignments && loadedStationIds.length === 0)
            return res.status(403).json({ error: 'No active kitchen station is assigned to this user' });
        let stationIds = loadedStationIds;
        let stationCategoryIds = (0, db_1.getKdsStationCategoryIds)(db, stationIds);
        if (!stationCategoryIds)
            return res.status(403).json({ error: 'Could not load station permissions' });
        let stationScope = (0, db_1.getKdsStationRoutingScope)(db, stationIds, categoryIds);
        if (!stationScope)
            return res.status(403).json({ error: 'Could not load station permissions' });
        let stationRoutingCategoryIds = stationScope.tablelessCategoryIds;
        let restrictedKdsPayload = currentUser.role === 'chef' || categoryIds.length > 0 || stationIds.length > 0;
        const orderData = (0, db_1.withTxn)(() => {
            const liveUser = db.prepare('SELECT role, category_ids, tokens_valid_after FROM users WHERE id = ? AND is_active = 1').get(userId);
            const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
            if (!liveUser || (0, security_1.isTokenRevoked)(token) || (0, security_1.isTokenStale)(req.user?.iat, liveUser.tokens_valid_after) || !(0, role_permissions_1.hasRole)(liveUser.role, role_permissions_1.ROLE_ACCESS.kitchen))
                throw new Error('USER_FORBIDDEN');
            categoryIds = (0, role_permissions_1.hasRole)(liveUser.role, role_permissions_1.ROLE_ACCESS.ownerManager) ? [] : (0, auth_1.parseCategoryIds)(liveUser.category_ids);
            const liveStationIds = (0, db_1.getUserKdsStationIds)(db, userId);
            const liveAssignments = (0, db_1.hasUserKdsStationAssignments)(db, userId);
            if (!liveStationIds || liveAssignments === null)
                throw new Error('USER_FORBIDDEN');
            if (liveAssignments && liveStationIds.length === 0)
                throw new Error('STATION_FORBIDDEN');
            const liveStationCategoryIds = (0, db_1.getKdsStationCategoryIds)(db, liveStationIds);
            const liveStationScope = (0, db_1.getKdsStationRoutingScope)(db, liveStationIds, categoryIds);
            if (!liveStationCategoryIds || !liveStationScope)
                throw new Error('PERMISSIONS_UNAVAILABLE');
            stationIds = liveStationIds;
            stationCategoryIds = liveStationCategoryIds;
            stationScope = liveStationScope;
            stationRoutingCategoryIds = liveStationScope.tablelessCategoryIds;
            restrictedKdsPayload = liveUser.role === 'chef' || categoryIds.length > 0 || stationIds.length > 0;
            const item = db.prepare(`
        SELECT oi.*, p.category_id
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.id = ?
      `).get(itemId);
            if (!item) {
                return null;
            }
            if (item.status === 'voided') {
                throw new Error('VOIDED_ITEM');
            }
            if (item.status === 'void_adjustment') {
                throw new Error('IMMUTABLE_KDS_ITEM');
            }
            if (item.status === 'completed' || item.status === 'cancelled' || item.status === 'refunded') {
                throw new Error('TERMINAL_KDS_ITEM');
            }
            if (categoryIds.length > 0 && (!item.category_id || !categoryIds.includes(String(item.category_id)))) {
                throw new Error('CATEGORY_FORBIDDEN');
            }
            const parentOrder = db.prepare('SELECT id FROM orders WHERE id = ?').get(item.order_id);
            if (!parentOrder)
                throw new Error('ORPHANED_ORDER_ITEM');
            let orderStationId;
            if (stationIds.length > 0) {
                const station = db.prepare(`
          SELECT t.kitchen_station_id
          FROM orders o LEFT JOIN tables t ON t.id = o.table_id
          WHERE o.id = ?
        `).get(item.order_id);
                orderStationId = station?.kitchen_station_id;
                if (!(0, db_1.isKdsStationItemAllowed)(stationIds, stationRoutingCategoryIds, orderStationId, item.category_id, orderStationId ? stationScope.categoryIdsByStation[String(orderStationId)] : undefined, stationScope.hasUnrestrictedStation)) {
                    throw new Error('STATION_FORBIDDEN');
                }
            }
            const updateResult = expectedStatus === undefined
                ? db.prepare("UPDATE order_items SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('voided', 'void_adjustment', 'completed', 'cancelled', 'refunded')").run(status, (0, db_1.now)(), itemId)
                : db.prepare('UPDATE order_items SET status = ?, updated_at = ? WHERE id = ? AND status = ?').run(status, (0, db_1.now)(), itemId, expectedStatus);
            if (updateResult.changes !== 1)
                throw new Error('STATUS_CONFLICT');
            const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(item.order_id);
            const rawItems = db.prepare(`
        SELECT oi.*, p.category_id
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ?
      `).all(item.order_id);
            const visibleItems = rawItems
                .filter((row) => !['completed', 'cancelled', 'void_adjustment', 'refunded'].includes(row.status))
                .filter((row) => row.status !== 'voided' || (0, db_1.isVoidedItemKdsVisible)(row.voided_at))
                .filter((row) => categoryIds.length === 0 || (row.category_id && categoryIds.includes(String(row.category_id))))
                .filter((row) => stationIds.length === 0 || (0, db_1.isKdsStationItemAllowed)(stationIds, stationRoutingCategoryIds, orderStationId, row.category_id, orderStationId ? stationScope.categoryIdsByStation[String(orderStationId)] : undefined, stationScope.hasUnrestrictedStation));
            const items = (0, db_1.attachEffectiveAddons)(db, visibleItems.map(db_1.parseItemJson))
                .map((row) => (0, db_1.projectKdsItem)(row, restrictedKdsPayload));
            const tableRow = order.table_id
                ? db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id)
                : null;
            const table = tableRow
                ? (restrictedKdsPayload ? { name: tableRow.number } : { ...tableRow, name: tableRow.number })
                : null;
            return {
                ...(0, db_1.projectKdsOrder)(order, restrictedKdsPayload),
                items,
                table,
            };
        });
        if (orderData === null) {
            return res.status(404).json({ error: 'Order item not found' });
        }
        (0, kds_1.notifyKdsUpdate)();
        res.json({ order: orderData });
    }
    catch (error) {
        if (error.message === 'VOIDED_ITEM') {
            return res.status(400).json({ error: 'This item has been voided and can no longer be updated' });
        }
        if (error.message === 'USER_FORBIDDEN' || error.message === 'PERMISSIONS_UNAVAILABLE') {
            return res.status(403).json({ error: 'Could not load current station permissions' });
        }
        if (error.message === 'CATEGORY_FORBIDDEN' || error.message === 'STATION_FORBIDDEN') {
            return res.status(403).json({ error: 'Not authorized to update this item' });
        }
        if (error.message === 'IMMUTABLE_KDS_ITEM') {
            return res.status(400).json({ error: 'This bill adjustment cannot be updated from KDS' });
        }
        if (error.message === 'TERMINAL_KDS_ITEM') {
            return res.status(400).json({ error: 'This terminal item cannot be updated from KDS' });
        }
        if (error.message === 'ORPHANED_ORDER_ITEM') {
            return res.status(404).json({ error: 'Order item is not attached to an order' });
        }
        if (error.message === 'STATUS_CONFLICT') {
            return res.status(409).json({ error: 'Item status changed; refresh and try again' });
        }
        console.error('[OrderItems] Status update error:', error);
        res.status(500).json({ error: "Could not update order item status" });
    }
});
exports.orderItemRoutes = router;
//# sourceMappingURL=order-items.js.map