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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isKdsServerRunning = isKdsServerRunning;
exports.startKdsServer = startKdsServer;
exports.stopKdsServer = stopKdsServer;
exports.getKdsPort = getKdsPort;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const ws_1 = require("ws");
const http = __importStar(require("http"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const node_crypto_1 = require("node:crypto");
const shutdown_1 = require("./shutdown");
const db_1 = require("./db");
const kds_1 = require("./services/kds");
const auth_1 = require("./routes/auth");
const security_1 = require("./middleware/security");
const csp_1 = require("./csp");
const path_containment_1 = require("./lib/path-containment");
const role_permissions_1 = require("../shared/role-permissions");
let kdsServer = null;
let kdsWss = null;
let stopPromise = null;
let startReject = null;
let stopping = false;
const KDS_PORT = parseInt(process.env.KDS_PORT || '3002', 10);
let activeKdsPort = KDS_PORT;
function categoryIdsForRole(role, categoryIds) {
    return (0, role_permissions_1.hasRole)(role, role_permissions_1.ROLE_ACCESS.ownerManager) ? [] : (0, auth_1.parseCategoryIds)(categoryIds);
}
function isKdsServerRunning() {
    return kdsServer !== null;
}
/**
 * Locate the static export directory.
 */
function getStaticDir() {
    const candidates = [
        // Development / unpackaged: relative to dist/main/ (compiled output of
        // main/, see tsconfig rootDir covering shared/ since #441)
        path.join(__dirname, '../../frontend/out'),
        path.join(process.resourcesPath || '', 'frontend-out'),
    ];
    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'index.html'))) {
            return dir;
        }
    }
    return null;
}
/**
 * Helper to rewrite dotted Next.js static segment file requests to nested paths on Windows.
 * E.g., /products/__next.!KGRhc2hib2FyZCk.products.__PAGE__.txt -> /products/__next.!KGRhc2hib2FyZCk/products/__PAGE__.txt
 */
function rewriteNextExportPath(reqPath) {
    const nextIndex = reqPath.indexOf('__next.');
    if (nextIndex === -1)
        return reqPath;
    const prefix = reqPath.substring(0, nextIndex + '__next.'.length);
    const rest = reqPath.substring(nextIndex + '__next.'.length);
    const lastDotIndex = rest.lastIndexOf('.');
    if (lastDotIndex === -1)
        return reqPath;
    const namePart = rest.substring(0, lastDotIndex);
    const extPart = rest.substring(lastDotIndex);
    const rewrittenName = namePart.replace(/\./g, '/');
    return prefix + rewrittenName + extPart;
}
function startKdsServer() {
    stopPromise = null;
    stopping = false;
    return new Promise((resolve, reject) => {
        startReject = reject;
        const app = (0, express_1.default)();
        app.use((0, cors_1.default)(security_1.corsOptions));
        app.use((req, res, next) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Security-Policy', (0, csp_1.buildCspHeader)(req));
            next();
        });
        app.use(express_1.default.json());
        // body-parser 2.x (bundled with Express 5) leaves req.body undefined
        // instead of {} when a request has no parseable body -- restore the
        // old default so route handlers can destructure req.body directly.
        app.use((req, _res, next) => {
            if (req.body === undefined)
                req.body = {};
            next();
        });
        app.use(db_1.databaseMaintenanceMiddleware);
        // ── Global API rate limiting ──────────────────────────────────────────
        app.use('/api', (0, security_1.rateLimit)({ windowMs: 60 * 1000, max: 100 }));
        // ── KDS Auth Middleware ───────────────────────────────────────────────
        const requireAuth = (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader?.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'No token provided' });
            }
            const token = authHeader.split(' ')[1];
            if ((0, security_1.isTokenRevoked)(token)) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            try {
                const decoded = jsonwebtoken_1.default.verify(token, (0, auth_1.getJWTSecret)());
                const db = (0, db_1.getDatabase)();
                const user = db.prepare('SELECT id, email, role, category_ids, tokens_valid_after FROM users WHERE id = ? AND is_active = 1').get(decoded.userId);
                if (!user || (0, security_1.isTokenStale)(decoded.iat, user.tokens_valid_after)) {
                    return res.status(401).json({ error: 'Invalid token' });
                }
                if (!(0, role_permissions_1.hasRole)(user.role, role_permissions_1.ROLE_ACCESS.kitchen)) {
                    return res.status(403).json({ error: 'Access denied. Only kitchen staff allowed.' });
                }
                const stationIds = (0, db_1.getUserKdsStationIds)(db, user.id);
                const stationAssignmentsConfigured = (0, db_1.hasUserKdsStationAssignments)(db, user.id);
                if (!stationIds || stationAssignmentsConfigured === null)
                    return res.status(401).json({ error: 'Invalid token' });
                if (stationAssignmentsConfigured && stationIds.length === 0)
                    return res.status(403).json({ error: 'No active kitchen station is assigned to this user' });
                req.user = {
                    userId: user.id,
                    email: user.email,
                    role: user.role,
                    categoryIds: categoryIdsForRole(user.role, user.category_ids),
                    stationIds,
                    stationAssignmentsConfigured,
                    iat: decoded.iat,
                };
                next();
            }
            catch (error) {
                return res.status(401).json({ error: 'Invalid token' });
            }
        };
        // ── KDS API endpoints (same database, minimal routes) ─────────────
        // Health check
        app.get('/api/health', (_req, res) => {
            res.json({
                status: 'ok',
                service: 'Flo KDS Server',
                version: '1.0.0',
                timestamp: new Date().toISOString(),
            });
        });
        // Public tenant metadata — language + KDS defaults.
        // No auth: the standalone KDS needs this on first paint, before login,
        // and lives on a different origin than the main API.
        app.get('/api/kds/info', (_req, res) => {
            // Disabled KDS → pretend the endpoint doesn't exist rather than
            // confirming it's just off; this is the first thing a standalone KDS
            // device fetches, pre-login, so it's the least info a stale/
            // misconfigured device on the LAN should get (issue #133).
            if (!(0, db_1.isKdsEnabled)()) {
                return res.status(404).json({ error: 'Not found' });
            }
            try {
                const db = (0, db_1.getDatabase)();
                const rows = db.prepare('SELECT key, value FROM settings').all();
                const s = {};
                for (const row of rows)
                    s[row.key] = row.value;
                res.json({
                    language: s.language || null,
                    country: s.country || null,
                    kds_default_view: s.kds_default_view === 'kanban' ? 'kanban' : 'tabs',
                });
            }
            catch (error) {
                console.error("[API] Internal error:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });
        // KDS Auth - verify user has chef/manager/owner role
        app.post('/api/auth/login', (0, security_1.authRateLimit)(), (req, res) => {
            try {
                const { email, password } = req.body;
                if (!email || !password) {
                    return res.status(400).json({ error: 'Email and password required' });
                }
                const db = (0, db_1.getDatabase)();
                const bcrypt = require('bcryptjs');
                const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
                if (!user || !bcrypt.compareSync(password, user.password)) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }
                // Only allow chef, manager, owner roles
                if (!(0, role_permissions_1.hasRole)(user.role, role_permissions_1.ROLE_ACCESS.kitchen)) {
                    return res.status(403).json({ error: 'Access denied. Only kitchen staff allowed.' });
                }
                const stationIds = (0, db_1.getUserKdsStationIds)(db, user.id);
                const stationAssignmentsConfigured = (0, db_1.hasUserKdsStationAssignments)(db, user.id);
                if (!stationIds || stationAssignmentsConfigured === null)
                    return res.status(500).json({ error: 'Could not load station permissions' });
                if (stationAssignmentsConfigured && stationIds.length === 0) {
                    return res.status(403).json({ error: 'No active kitchen station is assigned to this user' });
                }
                const token = jsonwebtoken_1.default.sign({ userId: user.id, email: user.email, role: user.role, jti: (0, node_crypto_1.randomUUID)() }, (0, auth_1.getJWTSecret)(), { expiresIn: '24h' });
                res.json({
                    access_token: token,
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        role: user.role,
                        category_ids: categoryIdsForRole(user.role, user.category_ids),
                        station_ids: stationIds,
                        station_assignments_configured: stationAssignmentsConfigured,
                    },
                });
            }
            catch (error) {
                console.error("[API] Internal error:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });
        app.post('/api/auth/logout', (req, res) => {
            const authHeader = req.headers.authorization;
            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.slice('Bearer '.length);
                try {
                    const decoded = jsonwebtoken_1.default.verify(token, (0, auth_1.getJWTSecret)());
                    (0, security_1.revokeToken)(token, typeof decoded.exp === 'number' ? decoded.exp * 1000 : undefined);
                }
                catch {
                    // Logout remains idempotent without persisting arbitrary bearer data.
                }
            }
            res.json({ message: 'Logged out successfully' });
        });
        // Current user info — lets the frontend restore a session from a saved
        // token on page load/reload instead of forcing a fresh login every time.
        app.get('/api/auth/me', requireAuth, (req, res) => {
            try {
                const authedUser = req.user;
                const db = (0, db_1.getDatabase)();
                const row = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(authedUser.userId);
                if (!row) {
                    return res.status(404).json({ error: 'User not found' });
                }
                res.json({ user: row });
            }
            catch (error) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        // Get orders for KDS (pending, preparing, ready)
        app.get('/api/kds/orders', requireAuth, (req, res) => {
            if (!(0, db_1.isKdsEnabled)()) {
                return res.status(403).json({ error: 'KDS is disabled for this business' });
            }
            try {
                const db = (0, db_1.getDatabase)();
                const kdsUser = req.user;
                const liveUser = db.prepare('SELECT role, category_ids, is_active FROM users WHERE id = ?').get(kdsUser.userId);
                if (!liveUser?.is_active)
                    return res.status(403).json({ error: 'User account is not active' });
                const categoryIds = categoryIdsForRole(liveUser.role, liveUser.category_ids);
                const stationIds = (0, db_1.getUserKdsStationIds)(db, kdsUser.userId);
                const stationAssignmentsConfigured = (0, db_1.hasUserKdsStationAssignments)(db, kdsUser.userId);
                if (!stationIds || stationAssignmentsConfigured === null)
                    return res.status(403).json({ error: 'Could not load station permissions' });
                if (stationAssignmentsConfigured && stationIds.length === 0)
                    return res.status(403).json({ error: 'No active kitchen station is assigned to this user' });
                const stationCategoryIds = (0, db_1.getKdsStationCategoryIds)(db, stationIds);
                const stationScope = (0, db_1.getKdsStationRoutingScope)(db, stationIds, categoryIds);
                const stationRoutingCategoryIds = stationScope?.tablelessCategoryIds;
                const restrictedKdsPayload = liveUser.role === 'chef' || categoryIds.length > 0 || stationIds.length > 0;
                if (!stationCategoryIds || !stationScope || !stationRoutingCategoryIds)
                    return res.status(403).json({ error: 'Could not load station permissions' });
                const voidedCutoff = new Date(Date.now() - db_1.KDS_VOIDED_ITEM_VISIBILITY_MS).toISOString().replace('T', ' ').replace(/\..*$/, '');
                let query = `
          SELECT DISTINCT o.*, t.number as table_number, t.kitchen_station_id
          FROM orders o
          LEFT JOIN tables t ON o.table_id = t.id
          INNER JOIN order_items oi ON oi.order_id = o.id
          WHERE o.id IN (
            SELECT id FROM orders WHERE status IN ('pending', 'preparing', 'ready', 'served')
            UNION
            SELECT active_o.id FROM orders active_o
            JOIN order_items active_oi ON active_oi.order_id = active_o.id
              AND active_oi.status NOT IN ('served', 'cancelled')
            WHERE active_o.status NOT IN ('pending', 'preparing', 'ready', 'served', 'cancelled')
          )
          AND oi.status NOT IN ('completed', 'cancelled', 'void_adjustment', 'refunded')
          AND (oi.status != 'voided' OR oi.voided_at IS NULL OR oi.voided_at > ?)
        `;
                const orderParams = [voidedCutoff];
                if (stationIds.length > 0) {
                    const stationPlaceholders = stationIds.map(() => '?').join(',');
                    const categoryRoute = stationRoutingCategoryIds.length > 0
                        ? ` OR EXISTS (SELECT 1 FROM order_items routed_oi JOIN products routed_p ON routed_p.id = routed_oi.product_id WHERE routed_oi.order_id = o.id AND t.kitchen_station_id IS NULL AND routed_p.category_id IN (${stationRoutingCategoryIds.map(() => '?').join(',')}))`
                        : '';
                    query += ` AND (EXISTS (SELECT 1 FROM tables assigned_table WHERE assigned_table.id = o.table_id AND assigned_table.kitchen_station_id IN (${stationPlaceholders}))${categoryRoute}${stationScope.hasUnrestrictedStation ? ' OR t.kitchen_station_id IS NULL' : ''})`;
                    orderParams.push(...stationIds, ...stationRoutingCategoryIds);
                }
                query += ' ORDER BY o.created_at ASC';
                const orders = db.prepare(query).all(...orderParams);
                // Pre-fetch allowed product IDs once if category restrictions apply to eliminate N+1 queries
                let allowedProductIds = null;
                if (categoryIds.length > 0) {
                    const productRows = db.prepare(`
            SELECT id FROM products WHERE category_id IN (${categoryIds.map(() => '?').join(',')})
          `).all(...categoryIds);
                    allowedProductIds = new Set(productRows.map((p) => p.id));
                }
                // Batch item and addon fetches across all active orders (issue #226)
                // instead of running one items query and one addons pass per order.
                const orderIds = orders.map((o) => o.id);
                const itemsByOrder = {};
                if (orderIds.length > 0) {
                    const placeholders = orderIds.map(() => '?').join(',');
                    const rawItems = db.prepare(`
            SELECT oi.*, p.category_id
            FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id IN (${placeholders}) ORDER BY oi.order_id, oi.id
          `).all(...orderIds);
                    for (const item of rawItems) {
                        if (!itemsByOrder[item.order_id])
                            itemsByOrder[item.order_id] = [];
                        itemsByOrder[item.order_id].push(item);
                    }
                }
                // #150: hide the void reversal line (bill adjustment, not a kitchen
                // item) and age voided items off the board after their grace period.
                const isVisibleItem = (item, order) => item.status !== 'void_adjustment'
                    && !['completed', 'cancelled', 'refunded'].includes(item.status)
                    && (item.status !== 'voided' || (0, db_1.isVoidedItemKdsVisible)(item.voided_at))
                    && (0, db_1.isKdsStationItemAllowed)(stationIds, stationRoutingCategoryIds, order.kitchen_station_id, item.category_id, order.kitchen_station_id ? stationScope?.categoryIdsByStation[String(order.kitchen_station_id)] : undefined, stationScope.hasUnrestrictedStation);
                const allVisibleItems = orders
                    .flatMap((order) => (itemsByOrder[order.id] || []).filter((item) => isVisibleItem(item, order)));
                const itemsWithAddons = (0, db_1.attachEffectiveAddons)(db, allVisibleItems.map(db_1.parseItemJson));
                const addonsByItemId = new Map(itemsWithAddons.map((item) => [item.id, item]));
                const ordersWithItems = orders.map((order) => {
                    let items = (itemsByOrder[order.id] || [])
                        .filter((item) => isVisibleItem(item, order))
                        .map((item) => addonsByItemId.get(item.id) || item);
                    // Filter by category if provided
                    if (allowedProductIds) {
                        items = items.filter((item) => allowedProductIds.has(item.product_id));
                    }
                    items = items.map((item) => (0, db_1.projectKdsItem)(item, restrictedKdsPayload));
                    return {
                        ...(0, db_1.projectKdsOrder)(order, restrictedKdsPayload),
                        table: order.table_number ? { name: order.table_number } : null,
                        items,
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
        // Update order item status
        app.patch('/api/kds/items/:id/status', requireAuth, (req, res) => {
            if (!(0, db_1.isKdsEnabled)()) {
                return res.status(403).json({ error: 'KDS is disabled for this business' });
            }
            try {
                const { status, expected_status: expectedStatus } = req.body;
                const validStatuses = ['pending', 'preparing', 'ready', 'served'];
                if (!status || !validStatuses.includes(status)) {
                    return res.status(400).json({ error: `Valid status required: ${validStatuses.join(', ')}` });
                }
                if (expectedStatus !== undefined && !validStatuses.includes(expectedStatus)) {
                    return res.status(400).json({ error: `Invalid expected status. Use: ${validStatuses.join(', ')}` });
                }
                const db = (0, db_1.getDatabase)();
                const kdsUser = req.user;
                const liveUser = db.prepare('SELECT role, category_ids, is_active FROM users WHERE id = ?').get(kdsUser.userId);
                if (!liveUser?.is_active)
                    return res.status(403).json({ error: 'User account is not active' });
                const categoryIds = categoryIdsForRole(liveUser.role, liveUser.category_ids);
                const stationIds = (0, db_1.getUserKdsStationIds)(db, kdsUser.userId);
                const stationAssignmentsConfigured = (0, db_1.hasUserKdsStationAssignments)(db, kdsUser.userId);
                if (!stationIds || stationAssignmentsConfigured === null)
                    return res.status(403).json({ error: 'Could not load station permissions' });
                if (stationAssignmentsConfigured && stationIds.length === 0)
                    return res.status(403).json({ error: 'No active kitchen station is assigned to this user' });
                const updateResult = db.transaction(() => {
                    const currentUser = db.prepare('SELECT role, category_ids, is_active, tokens_valid_after FROM users WHERE id = ?').get(kdsUser.userId);
                    const currentToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
                    if (!currentUser?.is_active || (0, security_1.isTokenRevoked)(currentToken) || (0, security_1.isTokenStale)(kdsUser.iat, currentUser?.tokens_valid_after))
                        return { statusCode: 403, error: 'User account is not active' };
                    if (!(0, role_permissions_1.hasRole)(currentUser.role, role_permissions_1.ROLE_ACCESS.kitchen))
                        return { statusCode: 403, error: 'Not authorized to update KDS items' };
                    const currentCategoryIds = categoryIdsForRole(currentUser.role, currentUser.category_ids);
                    const currentStationIds = (0, db_1.getUserKdsStationIds)(db, kdsUser.userId);
                    const currentAssignmentsConfigured = (0, db_1.hasUserKdsStationAssignments)(db, kdsUser.userId);
                    if (!currentStationIds || currentAssignmentsConfigured === null)
                        return { statusCode: 403, error: 'Could not load station permissions' };
                    if (currentAssignmentsConfigured && currentStationIds.length === 0)
                        return { statusCode: 403, error: 'No active kitchen station is assigned to this user' };
                    const item = db.prepare(`
            SELECT oi.*, p.category_id
            FROM order_items oi
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.id = ?
          `).get(req.params.id);
                    if (!item)
                        return { statusCode: 404, error: 'Order item not found' };
                    if (!db.prepare('SELECT id FROM orders WHERE id = ?').get(item.order_id)) {
                        return { statusCode: 404, error: 'Order item is not attached to an order' };
                    }
                    // #150: locked once voided — see main/routes/order-items.ts for the same rule.
                    if (item.status === 'voided')
                        return { statusCode: 400, error: 'This item has been voided and can no longer be updated' };
                    if (item.status === 'void_adjustment')
                        return { statusCode: 400, error: 'This bill adjustment cannot be updated from KDS' };
                    if (item.status === 'completed' || item.status === 'cancelled' || item.status === 'refunded') {
                        return { statusCode: 400, error: 'This terminal item cannot be updated from KDS' };
                    }
                    if (currentStationIds.length > 0) {
                        const stationCategoryIds = (0, db_1.getKdsStationCategoryIds)(db, currentStationIds);
                        const stationScope = (0, db_1.getKdsStationRoutingScope)(db, currentStationIds, currentCategoryIds);
                        const stationRoutingCategoryIds = stationScope?.tablelessCategoryIds;
                        const station = db.prepare(`
              SELECT t.kitchen_station_id
              FROM orders o LEFT JOIN tables t ON t.id = o.table_id
              WHERE o.id = ?
            `).get(item.order_id);
                        if (!stationCategoryIds || !stationScope || !stationRoutingCategoryIds || !(0, db_1.isKdsStationItemAllowed)(currentStationIds, stationRoutingCategoryIds, station?.kitchen_station_id, item.category_id, station?.kitchen_station_id ? stationScope.categoryIdsByStation[String(station?.kitchen_station_id)] : undefined, stationScope.hasUnrestrictedStation)) {
                            return { statusCode: 403, error: 'Not authorized to update this station' };
                        }
                    }
                    if (currentCategoryIds.length > 0 && !currentCategoryIds.includes(String(item.category_id))) {
                        return { statusCode: 403, error: 'Not authorized to update this item' };
                    }
                    const updated = expectedStatus === undefined
                        ? db.prepare(`
                UPDATE order_items
                SET status = ?, updated_at = datetime('now')
                WHERE id = ? AND status NOT IN ('voided', 'void_adjustment', 'completed', 'cancelled', 'refunded')
              `).run(status, req.params.id)
                        : db.prepare(`
                UPDATE order_items
                SET status = ?, updated_at = datetime('now')
                WHERE id = ? AND status = ?
              `).run(status, req.params.id, expectedStatus);
                    return updated.changes === 1
                        ? { statusCode: 200, error: null }
                        : { statusCode: 409, error: 'The order item changed before it could be updated' };
                }).immediate();
                if (updateResult.statusCode !== 200) {
                    return res.status(updateResult.statusCode).json({ error: updateResult.error });
                }
                (0, kds_1.notifyKdsUpdate)();
                res.json({ success: true });
            }
            catch (error) {
                console.error('[KDS Server] PATCH item status error:', error);
                console.error("[API] Internal error:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });
        // Get categories for filtering
        app.get('/api/categories', requireAuth, (req, res) => {
            if (!(0, db_1.isKdsEnabled)()) {
                return res.status(403).json({ error: 'KDS is disabled for this business' });
            }
            try {
                const db = (0, db_1.getDatabase)();
                const kdsUser = req.user;
                const liveUser = db.prepare('SELECT role, category_ids, is_active FROM users WHERE id = ?').get(kdsUser.userId);
                if (!liveUser?.is_active)
                    return res.status(403).json({ error: 'User account is not active' });
                const liveCategoryIds = categoryIdsForRole(liveUser.role, liveUser.category_ids);
                const liveStationIds = (0, db_1.getUserKdsStationIds)(db, kdsUser.userId);
                const stationAssignmentsConfigured = (0, db_1.hasUserKdsStationAssignments)(db, kdsUser.userId);
                if (!liveStationIds || stationAssignmentsConfigured === null)
                    return res.status(403).json({ error: 'Could not load station permissions' });
                if (stationAssignmentsConfigured && liveStationIds.length === 0)
                    return res.status(403).json({ error: 'No active kitchen station is assigned to this user' });
                const stationCategoryIds = (0, db_1.getKdsStationCategoryIds)(db, liveStationIds);
                const stationScope = (0, db_1.getKdsStationRoutingScope)(db, liveStationIds, liveCategoryIds);
                const stationRoutingCategoryIds = stationScope?.tablelessCategoryIds;
                if (!stationCategoryIds || !stationScope || !stationRoutingCategoryIds)
                    return res.status(403).json({ error: 'Could not load station permissions' });
                const hasUnrestrictedStation = liveStationIds.some((stationId) => stationScope.categoryIdsByStation[String(stationId)] === null);
                const categoryIds = liveStationIds.length === 0
                    ? liveCategoryIds
                    : hasUnrestrictedStation
                        ? []
                        : stationRoutingCategoryIds.filter((categoryId) => liveCategoryIds.length === 0 || liveCategoryIds.includes(categoryId));
                const categoryScopeConfigured = !hasUnrestrictedStation && (stationRoutingCategoryIds.length > 0 || liveCategoryIds.length > 0);
                const categories = categoryScopeConfigured
                    ? db.prepare(`SELECT * FROM categories WHERE is_active = 1 AND id IN (${categoryIds.length > 0 ? categoryIds.map(() => '?').join(',') : "''"}) ORDER BY sort_order`).all(...categoryIds)
                    : db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order').all();
                res.json({ categories });
            }
            catch (error) {
                console.error("[API] Internal error:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });
        // ── Serve static files ────────────────────────────────────────────
        const staticDir = getStaticDir();
        if (staticDir) {
            console.log(`[KDS Server] Serving static files from: ${staticDir}`);
            // Middleware to patch Windows-specific Next.js static export path nesting.
            // On Windows, the Next.js static export uses dotted segments (e.g.
            // __next.!KGRhc2hib2FyZCk.products.__PAGE__.txt) instead of nested
            // directories. This rewrite is only needed when the app runs on Windows.
            if (process.platform === 'win32') {
                app.use((0, security_1.staticRouteRateLimit)(), (req, res, next) => {
                    if (req.path.includes('__next.')) {
                        const originalPath = req.path;
                        const rewritten = rewriteNextExportPath(originalPath);
                        if (rewritten !== originalPath) {
                            const fullPath = (0, path_containment_1.resolveContainedPath)(staticDir, rewritten);
                            if (fullPath && fs.existsSync(fullPath)) {
                                req.url = rewritten;
                            }
                        }
                    }
                    next();
                });
            }
            app.use(express_1.default.static(staticDir, { dotfiles: 'allow', index: false }));
            // Redirect root to standalone KDS
            app.get('/', (_req, res) => {
                res.redirect('/kds-standalone');
            });
            // SPA fallback - serve the standalone KDS for any unmatched routes
            app.get('/*splat', (0, security_1.staticRouteRateLimit)(), (req, res) => {
                // Try to serve the specific route first
                const routePath = (0, path_containment_1.resolveContainedPath)(staticDir, `.${req.path}`, 'index.html');
                if (routePath && fs.existsSync(routePath)) {
                    res.sendFile(routePath, { dotfiles: 'allow' });
                }
                else {
                    res.sendFile(path.join(staticDir, 'kds-standalone', 'index.html'), { dotfiles: 'allow' });
                }
            });
        }
        else {
            console.warn('[KDS Server] Static build not found. Run `npm run build:frontend` first.');
            app.get('/', (_req, res) => {
                res.send(`
          <html><body style="font-family:sans-serif;padding:2rem">
            <h2>Flo KDS – Build not found</h2>
            <p>Run <code>npm run build:frontend</code> then restart the app.</p>
          </body></html>
        `);
            });
        }
        // ── Error handler ────────────────────────────────────────────────
        app.use((err, _req, res, _next) => {
            console.error('[KDS Server] Error:', err);
            res.status(500).json({ error: 'Internal server error' });
        });
        const baseKdsPort = parseInt(process.env.KDS_PORT || '3002', 10);
        let currentKdsPort = baseKdsPort;
        let attempts = 0;
        const listeningServer = http.createServer(app);
        kdsServer = listeningServer;
        (0, shutdown_1.installHttpShutdownTracking)(listeningServer);
        const tryListen = () => {
            const attemptedPort = currentKdsPort;
            const onListening = () => {
                if (stopping) {
                    try {
                        listeningServer.close();
                    }
                    catch {
                        return;
                    }
                    return;
                }
                startReject = null;
                listeningServer.off('error', onError);
                const address = listeningServer.address();
                activeKdsPort = address && typeof address !== 'string' ? address.port : attemptedPort;
                console.log(`[KDS Server] HTTP server running on http://localhost:${activeKdsPort}`);
                if (listeningServer) {
                    // noServer + a manual 'upgrade' handler so a disabled KDS can 404 the
                    // upgrade instead of completing it — see main/server.ts for the same
                    // pattern on the primary API server (issue #133).
                    const wss = new ws_1.WebSocketServer({ noServer: true });
                    kdsWss = wss;
                    (0, kds_1.setupKdsWebSocket)(wss);
                    listeningServer.on('upgrade', (request, socket, head) => {
                        const pathname = (request.url || '').split('?')[0];
                        if (pathname !== '/kds') {
                            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
                            socket.destroy();
                            return;
                        }
                        if ((0, db_1.isDatabaseMaintenanceActive)()) {
                            socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
                            socket.destroy();
                            return;
                        }
                        if (!(0, db_1.isKdsEnabled)()) {
                            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                            socket.destroy();
                            return;
                        }
                        try {
                            wss.handleUpgrade(request, socket, head, (ws) => {
                                wss.emit('connection', ws, request);
                            });
                        }
                        catch (error) {
                            console.error('[KDS Server] WebSocket upgrade failed:', error);
                            socket.destroy();
                        }
                    });
                    console.log(`[KDS Server] WebSocket running on ws://localhost:${activeKdsPort}/kds`);
                }
                resolve();
            };
            const onError = (err) => {
                if (stopping)
                    return;
                listeningServer.off('listening', onListening);
                if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                    attempts++;
                    if (attempts >= 10) {
                        const errorMsg = `[KDS Server] Failed to bind to any port after 10 attempts starting from ${baseKdsPort}`;
                        console.error(errorMsg);
                        reject(new Error(errorMsg));
                        return;
                    }
                    currentKdsPort++;
                    console.log(`[KDS Server] Port ${attemptedPort} in use (${err.code}), trying ${currentKdsPort}`);
                    tryListen();
                    return;
                }
                reject(err);
            };
            listeningServer.once('listening', onListening);
            listeningServer.once('error', onError);
            listeningServer.listen(attemptedPort, '0.0.0.0');
        };
        tryListen();
    });
}
function stopKdsServer() {
    if (stopPromise)
        return stopPromise;
    stopping = true;
    const rejectStart = startReject;
    startReject = null;
    rejectStart?.((0, shutdown_1.createShutdownCancellationError)('KDS server'));
    const serverToClose = kdsServer;
    const wssToClose = kdsWss;
    // Mark resources unavailable immediately while the captured listeners and
    // clients finish closing. Repeated shutdown calls share this promise.
    kdsServer = null;
    kdsWss = null;
    stopPromise = (0, shutdown_1.closeServerResources)(serverToClose, wssToClose, 'KDS server')
        .then(() => {
        console.log('[KDS Server] HTTP/WebSocket server stopped');
    });
    return stopPromise;
}
function getKdsPort() {
    return activeKdsPort;
}
//# sourceMappingURL=kds-server.js.map