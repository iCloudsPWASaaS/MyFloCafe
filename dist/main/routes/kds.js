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
exports.kdsRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const crypto = __importStar(require("crypto"));
const crypto_1 = require("crypto");
const security_1 = require("../middleware/security");
const auth_1 = require("./auth");
const kds_1 = require("../services/kds");
const role_permissions_1 = require("../../shared/role-permissions");
const router = (0, express_1.Router)();
function getKdsUserStationIds(db, req) {
    const userId = req.user?.userId;
    return userId ? (0, db_1.getUserKdsStationIds)(db, userId) : null;
}
function getKdsUserHasStationAssignments(db, req) {
    const userId = req.user?.userId;
    return userId ? (0, db_1.hasUserKdsStationAssignments)(db, userId) : null;
}
function isRestrictedKdsPayload(req, categoryIds, stationIds) {
    return req.user?.role === 'chef' || categoryIds.length > 0 || stationIds.length > 0;
}
function getKdsUserCategoryIds(db, req) {
    const userId = req.user?.userId;
    if (!userId)
        return null;
    const user = db.prepare('SELECT role, category_ids, is_active FROM users WHERE id = ?').get(userId);
    if (!user?.is_active || !(0, role_permissions_1.hasRole)(user.role, role_permissions_1.ROLE_ACCESS.kitchen))
        return null;
    return (0, role_permissions_1.hasRole)(user.role, role_permissions_1.ROLE_ACCESS.ownerManager) ? [] : (0, auth_1.parseCategoryIds)(user.category_ids);
}
// KDS disabled → 404 the pairing surface, checked before the role gate below
// so a request from an authenticated-but-wrong-role user doesn't leak that
// the route exists either (issue #133).
router.use('/pairing', security_1.requireKdsEnabledOr404);
router.use((0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.kitchen));
router.get('/orders', security_1.requireKdsEnabled, (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const userCategoryIds = getKdsUserCategoryIds(db, req);
        const userStationIds = getKdsUserStationIds(db, req);
        const hasStationAssignments = getKdsUserHasStationAssignments(db, req);
        const stationCategoryIds = (0, db_1.getKdsStationCategoryIds)(db, userStationIds || []);
        if (!userCategoryIds || !userStationIds || hasStationAssignments === null || !stationCategoryIds)
            return res.status(403).json({ error: 'User account is not active' });
        if (hasStationAssignments && userStationIds.length === 0)
            return res.status(403).json({ error: 'No active kitchen station is assigned to this user' });
        const stationId = req.query.station_id;
        if (stationId && !db.prepare('SELECT 1 FROM kitchen_stations WHERE id = ? AND is_active = 1').get(stationId)) {
            return res.status(404).json({ error: 'Kitchen station not found' });
        }
        const stationScope = (0, db_1.getKdsStationRoutingScope)(db, userStationIds, userCategoryIds);
        if (!stationScope)
            return res.status(403).json({ error: 'Could not load station permissions' });
        const stationRoutingCategoryIds = stationScope.tablelessCategoryIds;
        const requestedStationCategoryIds = stationId ? (0, db_1.getKdsStationCategoryIds)(db, [stationId]) : stationCategoryIds;
        if (!requestedStationCategoryIds)
            return res.status(403).json({ error: 'Could not load station permissions' });
        const requestedScope = stationId
            ? (0, db_1.getKdsStationRoutingScope)(db, [stationId], userCategoryIds)
            : stationScope;
        if (!requestedScope)
            return res.status(403).json({ error: 'Could not load station permissions' });
        const requestedRoutingCategoryIds = requestedScope.tablelessCategoryIds;
        const payloadStationIds = stationId ? [stationId] : userStationIds;
        const restrictedPayload = isRestrictedKdsPayload(req, userCategoryIds, userStationIds);
        if (stationId && userStationIds.length > 0 && !userStationIds.includes(stationId)) {
            return res.status(403).json({ error: 'You are not assigned to this kitchen station' });
        }
        if (stationId &&
            userCategoryIds.length > 0 &&
            requestedStationCategoryIds.length > 0 &&
            !requestedStationCategoryIds.some((categoryId) => userCategoryIds.includes(categoryId))) {
            return res.status(403).json({ error: 'You are not assigned to this kitchen station' });
        }
        let allowedProductIds = null;
        if (userCategoryIds.length > 0) {
            const productRows = db.prepare(`
        SELECT id FROM products WHERE category_id IN (${userCategoryIds.map(() => '?').join(',')})
      `).all(...userCategoryIds);
            allowedProductIds = new Set(productRows.map((product) => String(product.id)));
        }
        // A prepaid order is marked 'completed' the moment its bill is fully
        // paid, which can happen before the kitchen has prepared anything — so
        // a completed order still belongs here if it has items the kitchen
        // hasn't served yet. #208: rewrite the OR EXISTS scan as a CTE-anchored
        // subquery that hits idx_orders_status + idx_order_items_order instead
        // of scanning all orders with a correlated subquery.
        let query = `
      WITH active_ids AS (
        SELECT id FROM orders WHERE status IN ('pending','preparing','ready','served')
        UNION
        SELECT o.id FROM orders o
        JOIN order_items oi ON oi.order_id = o.id AND oi.status NOT IN ('served','cancelled')
        WHERE o.status NOT IN ('pending','preparing','ready','served','cancelled')
      )
      SELECT o.*, t.number as table_name, t.floor, t.section, t.kitchen_station_id
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      WHERE o.id IN active_ids
    `;
        const params = [];
        if (userStationIds.length > 0) {
            const stationPlaceholders = userStationIds.map(() => '?').join(',');
            const categoryRoute = stationRoutingCategoryIds.length > 0
                ? ` OR EXISTS (SELECT 1 FROM order_items routed_oi JOIN products routed_p ON routed_p.id = routed_oi.product_id WHERE routed_oi.order_id = o.id AND t.kitchen_station_id IS NULL AND routed_p.category_id IN (${stationRoutingCategoryIds.map(() => '?').join(',')}))`
                : '';
            query += ` AND (t.kitchen_station_id IN (${stationPlaceholders})${categoryRoute}${requestedScope.hasUnrestrictedStation ? ' OR t.kitchen_station_id IS NULL' : ''})`;
            params.push(...userStationIds, ...stationRoutingCategoryIds);
        }
        if (stationId) {
            const categoryRoute = requestedRoutingCategoryIds.length > 0
                ? ` OR EXISTS (SELECT 1 FROM order_items requested_oi JOIN products requested_p ON requested_p.id = requested_oi.product_id WHERE requested_oi.order_id = o.id AND t.kitchen_station_id IS NULL AND requested_p.category_id IN (${requestedRoutingCategoryIds.map(() => '?').join(',')}))`
                : '';
            query += ` AND (t.kitchen_station_id = ?${categoryRoute}${requestedScope.hasUnrestrictedStation ? ' OR t.kitchen_station_id IS NULL' : ''})`;
            params.push(stationId, ...requestedRoutingCategoryIds);
        }
        query += ' ORDER BY o.created_at ASC';
        const orders = db.prepare(query).all(...params);
        const ordersById = new Map(orders.map((order) => [order.id, order]));
        // One batched items query (with product/category joins) plus one addons
        // pass, instead of N+1 per order — the KDS board polls this constantly.
        const orderIds = orders.map((o) => o.id);
        const itemsByOrder = {};
        if (orderIds.length > 0) {
            const placeholders = orderIds.map(() => '?').join(',');
            const rawItems = db.prepare(`
        SELECT oi.*, p.category_id, c.name as category_name
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE oi.order_id IN (${placeholders})
        ORDER BY oi.order_id, oi.created_at ASC
      `).all(...orderIds);
            for (const item of rawItems) {
                if (!itemsByOrder[item.order_id])
                    itemsByOrder[item.order_id] = [];
                itemsByOrder[item.order_id].push(item);
            }
        }
        const allVisibleItems = orders
            .flatMap((o) => itemsByOrder[o.id] || [])
            .filter((i) => i.status !== 'void_adjustment'
            && !['completed', 'cancelled', 'refunded'].includes(i.status)
            && (i.status !== 'voided' || (0, db_1.isVoidedItemKdsVisible)(i.voided_at))
            && (!allowedProductIds || allowedProductIds.has(String(i.product_id)))
            && (0, db_1.isKdsStationItemAllowed)(payloadStationIds, requestedRoutingCategoryIds, ordersById.get(i.order_id)?.kitchen_station_id, i.category_id, ordersById.get(i.order_id)?.kitchen_station_id ? requestedScope.categoryIdsByStation[String(ordersById.get(i.order_id)?.kitchen_station_id)] : undefined, requestedScope.hasUnrestrictedStation));
        const itemsWithAddons = (0, db_1.attachEffectiveAddons)(db, allVisibleItems);
        const addonsByItemId = new Map(itemsWithAddons.map((it) => [it.id, it]));
        const ordersWithItems = orders.map((order) => {
            // #150: hide the void reversal line (bill adjustment, not a kitchen
            // item) and age voided items off the board after their grace period.
            const visibleItems = (itemsByOrder[order.id] || [])
                .filter((i) => i.status !== 'void_adjustment'
                && !['completed', 'cancelled', 'refunded'].includes(i.status)
                && (i.status !== 'voided' || (0, db_1.isVoidedItemKdsVisible)(i.voided_at))
                && (!allowedProductIds || allowedProductIds.has(String(i.product_id)))
                && (0, db_1.isKdsStationItemAllowed)(payloadStationIds, requestedRoutingCategoryIds, order.kitchen_station_id, i.category_id, order.kitchen_station_id ? requestedScope.categoryIdsByStation[String(order.kitchen_station_id)] : undefined, requestedScope.hasUnrestrictedStation))
                .map((i) => (0, db_1.projectKdsItem)(addonsByItemId.get(i.id) || i, restrictedPayload));
            return {
                ...(0, db_1.projectKdsOrder)(order, restrictedPayload), items: visibleItems,
                table: order.table_name ? { name: order.table_name } : null,
            };
        }).filter((order) => order.items.length > 0);
        const counts = {};
        for (const order of ordersWithItems) {
            for (const item of order.items)
                counts[item.status] = (counts[item.status] || 0) + 1;
        }
        res.json({ orders: ordersWithItems, counts });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/pairing', (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const userCategoryIds = getKdsUserCategoryIds(db, req);
        const userStationIds = getKdsUserStationIds(db, req);
        const hasStationAssignments = getKdsUserHasStationAssignments(db, req);
        if (!userCategoryIds || !userStationIds || hasStationAssignments === null)
            return res.status(403).json({ error: 'User account is not active' });
        if (hasStationAssignments && userStationIds.length === 0)
            return res.status(403).json({ error: 'No active kitchen station is assigned to this user' });
        const restrictedPayload = isRestrictedKdsPayload(req, userCategoryIds, userStationIds);
        const stations = db.prepare('SELECT * FROM kitchen_stations WHERE is_active = 1 ORDER BY sort_order, name').all()
            .filter((station) => {
            if (userStationIds.length > 0 && !userStationIds.includes(String(station.id)))
                return false;
            if (userCategoryIds.length === 0 || !station.category_ids)
                return true;
            const stationCategories = (0, auth_1.parseCategoryIds)(station.category_ids);
            return stationCategories.length === 0 || stationCategories.some((categoryId) => userCategoryIds.includes(categoryId));
        })
            .map((station) => (0, db_1.projectKdsStation)(station, restrictedPayload, userCategoryIds));
        res.json({ stations });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post('/pairing', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { station_id } = req.body;
        const db = (0, db_1.getDatabase)();
        if (station_id) {
            const station = db.prepare('SELECT * FROM kitchen_stations WHERE id = ? AND is_active = 1').get(station_id);
            if (!station) {
                return res.status(404).json({ error: 'Kitchen station not found' });
            }
        }
        const token = crypto.randomBytes(32).toString('hex');
        // Space form, same as every other DB timestamp (v45 normalized the
        // column) — a consumer comparing expires_at against a space-form now
        // would see ISO-Z tokens sort after it and treat them as never expired.
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace('T', ' ').replace(/\..*$/, '');
        const tokenId = (0, crypto_1.randomUUID)();
        const result = db.prepare(`
      INSERT INTO kds_pairing_tokens (id, token, station_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tokenId, token, station_id || null, expiresAt, (0, db_1.now)());
        const pairingUrl = `flo://kds/pair?token=${token}`;
        const webUrl = `/kds/pair?token=${token}`;
        res.status(201).json({
            pairingToken: {
                id: tokenId,
                token,
                station_id,
                expires_at: expiresAt,
                pairing_url: pairingUrl,
                web_url: webUrl,
            }
        });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/display', security_1.requireKdsEnabled, (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const userCategoryIds = getKdsUserCategoryIds(db, req);
        const userStationIds = getKdsUserStationIds(db, req);
        const hasStationAssignments = getKdsUserHasStationAssignments(db, req);
        if (!userCategoryIds || !userStationIds || hasStationAssignments === null)
            return res.status(403).json({ error: 'User account is not active' });
        if (hasStationAssignments && userStationIds.length === 0)
            return res.status(403).json({ error: 'No active kitchen station is assigned to this user' });
        const stationId = req.query.station_id;
        if (!stationId) {
            return res.status(400).json({ error: 'station_id is required' });
        }
        const station = db.prepare('SELECT * FROM kitchen_stations WHERE id = ? AND is_active = 1').get(stationId);
        if (!station) {
            return res.status(404).json({ error: 'Kitchen station not found' });
        }
        if (userStationIds.length > 0 && !userStationIds.includes(stationId)) {
            return res.status(403).json({ error: 'You are not assigned to this kitchen station' });
        }
        let stationCategoryIds = [];
        try {
            const stationData = station;
            if (stationData.category_ids) {
                stationCategoryIds = (0, auth_1.parseCategoryIds)(stationData.category_ids);
            }
        }
        catch (e) {
            stationCategoryIds = [];
        }
        if (userCategoryIds.length > 0 &&
            stationCategoryIds.length > 0 &&
            !stationCategoryIds.some((categoryId) => userCategoryIds.includes(categoryId))) {
            return res.status(403).json({ error: 'You are not assigned to this kitchen station' });
        }
        const stationItemCategoryIds = stationCategoryIds.length > 0
            ? (userCategoryIds.length > 0
                ? stationCategoryIds.filter((categoryId) => userCategoryIds.includes(categoryId))
                : stationCategoryIds)
            : (userCategoryIds.length > 0 ? userCategoryIds : null);
        const restrictedPayload = isRestrictedKdsPayload(req, userCategoryIds, userStationIds);
        // #150: 'void_adjustment' is a bill-only reversal line, never a kitchen
        // item — excluded outright. A voided item itself stays visible, struck
        // through, until voided_at ages past the same grace period every other
        // KDS surface uses (main/db.ts's isVoidedItemKdsVisible). The cutoff is
        // emitted in the DB's space form — an ISO-Z bound would sort after every
        // space-form row of the same day and hide voided items immediately.
        const voidedCutoff = new Date(Date.now() - db_1.KDS_VOIDED_ITEM_VISIBILITY_MS).toISOString().replace('T', ' ').replace(/\..*$/, '');
        let itemsQuery = `
      SELECT oi.*, o.id as order_id, o.order_number, o.type, o.status as order_status,
        o.table_id, t.number as table_name, o.special_instructions as order_notes,
        o.created_at as order_time
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN tables t ON o.table_id = t.id
      WHERE oi.status NOT IN ('completed', 'cancelled', 'served', 'void_adjustment', 'refunded')
        AND (oi.status != 'voided' OR oi.voided_at IS NULL OR oi.voided_at > ?)
        AND o.status != 'cancelled'
    `;
        const params = [voidedCutoff];
        const categoryRoute = stationItemCategoryIds === null
            ? ' OR t.kitchen_station_id IS NULL'
            : stationItemCategoryIds.length > 0
                ? ` OR EXISTS (SELECT 1 FROM products routed_p WHERE t.kitchen_station_id IS NULL AND routed_p.id = oi.product_id AND routed_p.category_id IN (${stationItemCategoryIds.map(() => '?').join(',')}))`
                : '';
        itemsQuery += ` AND (t.kitchen_station_id = ?${categoryRoute})`;
        params.push(stationId, ...(stationItemCategoryIds || []));
        if (stationItemCategoryIds !== null) {
            itemsQuery += ` AND EXISTS (SELECT 1 FROM products p WHERE p.id = oi.product_id AND p.category_id IN (${stationItemCategoryIds.length > 0 ? stationItemCategoryIds.map(() => '?').join(',') : "''"}))`;
            params.push(...stationItemCategoryIds);
        }
        itemsQuery += ' ORDER BY oi.created_at ASC';
        const items = (0, db_1.attachEffectiveAddons)(db, db.prepare(itemsQuery).all(...params))
            .map((item) => (0, db_1.projectKdsItem)(item, restrictedPayload));
        const groupedByOrder = {};
        for (const item of items) {
            const orderId = item.order_id;
            if (!groupedByOrder[orderId]) {
                groupedByOrder[orderId] = {
                    order_id: orderId,
                    order_number: item.order_number,
                    table_id: restrictedPayload ? null : item.table_id,
                    table_name: item.table_name,
                    table: item.table_name ? { name: item.table_name } : null,
                    type: item.type,
                    order_status: item.order_status,
                    order_notes: item.order_notes,
                    order_time: item.order_time,
                    items: [],
                };
            }
            groupedByOrder[orderId].items.push(item);
        }
        res.json({
            station: (0, db_1.projectKdsStation)(station, isRestrictedKdsPayload(req, userCategoryIds, userStationIds), userCategoryIds),
            orders: Object.values(groupedByOrder),
        });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.patch('/items/:id/status', security_1.requireKdsEnabled, (req, res) => {
    try {
        const { status, expected_status: expectedStatus } = req.body;
        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }
        const validStatuses = ['pending', 'preparing', 'ready', 'served'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
        }
        if (expectedStatus !== undefined && !validStatuses.includes(expectedStatus)) {
            return res.status(400).json({ error: `Invalid expected status. Use: ${validStatuses.join(', ')}` });
        }
        const db = (0, db_1.getDatabase)();
        const userCategoryIds = getKdsUserCategoryIds(db, req);
        const userStationIds = getKdsUserStationIds(db, req);
        const hasStationAssignments = getKdsUserHasStationAssignments(db, req);
        if (!userCategoryIds || !userStationIds || hasStationAssignments === null)
            return res.status(403).json({ error: 'User account is not active' });
        if (hasStationAssignments && userStationIds.length === 0)
            return res.status(403).json({ error: 'No active kitchen station is assigned to this user' });
        const stationCategoryIds = (0, db_1.getKdsStationCategoryIds)(db, userStationIds);
        const stationScope = (0, db_1.getKdsStationRoutingScope)(db, userStationIds, userCategoryIds);
        if (!stationCategoryIds || !stationScope)
            return res.status(403).json({ error: 'Could not load station permissions' });
        const stationRoutingCategoryIds = stationScope.tablelessCategoryIds;
        let restrictedPayload = isRestrictedKdsPayload(req, userCategoryIds, userStationIds);
        const updatedItem = (0, db_1.withTxn)(() => {
            const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
            const currentCategoryIds = getKdsUserCategoryIds(db, req);
            const currentStationIds = getKdsUserStationIds(db, req);
            const currentAssignments = getKdsUserHasStationAssignments(db, req);
            const currentUser = db.prepare('SELECT tokens_valid_after FROM users WHERE id = ?').get(req.user?.userId);
            if (!currentCategoryIds || !currentStationIds || currentAssignments === null || !currentUser || (0, security_1.isTokenRevoked)(token) || (0, security_1.isTokenStale)(req.user?.iat, currentUser.tokens_valid_after))
                throw new Error('USER_FORBIDDEN');
            if (currentAssignments && currentStationIds.length === 0)
                throw new Error('STATION_FORBIDDEN');
            const currentStationCategoryIds = (0, db_1.getKdsStationCategoryIds)(db, currentStationIds);
            const currentStationScope = (0, db_1.getKdsStationRoutingScope)(db, currentStationIds, currentCategoryIds);
            if (!currentStationCategoryIds || !currentStationScope)
                throw new Error('PERMISSIONS_UNAVAILABLE');
            const currentRoutingCategoryIds = currentStationScope.tablelessCategoryIds;
            userCategoryIds.splice(0, userCategoryIds.length, ...currentCategoryIds);
            userStationIds.splice(0, userStationIds.length, ...currentStationIds);
            restrictedPayload = isRestrictedKdsPayload(req, currentCategoryIds, currentStationIds);
            const item = db.prepare(`
        SELECT oi.*, p.category_id
        FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.id = ?
      `).get(req.params.id);
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
            if (userCategoryIds.length > 0) {
                const product = db.prepare('SELECT category_id FROM products WHERE id = ?').get(item.product_id);
                if (!product || !userCategoryIds.includes(String(product.category_id || ''))) {
                    throw new Error('CATEGORY_FORBIDDEN');
                }
            }
            if (!db.prepare('SELECT id FROM orders WHERE id = ?').get(item.order_id)) {
                throw new Error('ORPHANED_ORDER_ITEM');
            }
            if (currentStationIds.length > 0) {
                const station = db.prepare(`
          SELECT t.kitchen_station_id
          FROM orders o LEFT JOIN tables t ON t.id = o.table_id
          WHERE o.id = ?
        `).get(item.order_id);
                if (!(0, db_1.isKdsStationItemAllowed)(currentStationIds, currentRoutingCategoryIds, station?.kitchen_station_id, item.category_id, station?.kitchen_station_id ? currentStationScope.categoryIdsByStation[String(station?.kitchen_station_id)] : undefined, currentStationScope.hasUnrestrictedStation)) {
                    throw new Error('STATION_FORBIDDEN');
                }
            }
            const updateResult = expectedStatus === undefined
                ? db.prepare("UPDATE order_items SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('voided', 'void_adjustment', 'completed', 'cancelled', 'refunded')").run(status, (0, db_1.now)(), req.params.id)
                : db.prepare('UPDATE order_items SET status = ?, updated_at = ? WHERE id = ? AND status = ?').run(status, (0, db_1.now)(), req.params.id, expectedStatus);
            if (updateResult.changes !== 1)
                throw new Error('STATUS_CONFLICT');
            return db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.params.id);
        });
        if (!updatedItem) {
            return res.status(404).json({ error: 'Order item not found' });
        }
        (0, kds_1.notifyKdsUpdate)();
        res.json({ item: (0, db_1.projectKdsItem)(updatedItem, restrictedPayload) });
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
        console.error("[API] KDS item status update error:", error);
        res.status(500).json({ error: "Could not update item status" });
    }
});
exports.kdsRoutes = router;
//# sourceMappingURL=kds.js.map