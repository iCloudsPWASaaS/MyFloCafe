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
exports.registerRoutes = registerRoutes;
const auth_1 = require("./auth");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const categories_1 = require("./categories");
const products_1 = require("./products");
const addon_groups_1 = require("./addon-groups");
const orders_1 = require("./orders");
const order_items_1 = require("./order-items");
const bills_1 = require("./bills");
const refunds_1 = require("./refunds");
const tables_1 = require("./tables");
const kitchen_stations_1 = require("./kitchen-stations");
const kitchen_1 = require("./kitchen");
const customers_1 = require("./customers");
const staff_1 = require("./staff");
const settings_1 = require("./settings");
const payment_methods_1 = require("./payment-methods");
const reports_1 = require("./reports");
const shifts_1 = require("./shifts");
const kds_1 = require("./kds");
const kds_info_1 = require("./kds-info");
const pos_info_1 = require("./pos-info");
const server_app_info_1 = require("./server-app-info");
const more_apps_1 = require("./more-apps");
const kds_2 = require("../services/kds");
const printers_1 = require("./printers");
const database_1 = require("./database");
const database_tools_1 = require("./database-tools");
const menu_csv_1 = require("./menu-csv");
const tax_packs_1 = require("./tax-packs");
const held_orders_1 = require("./held-orders");
const print_templates_1 = require("./print-templates");
const whatsapp_1 = require("./whatsapp");
const support_ticket_1 = require("./support-ticket");
const db_1 = require("../db");
const orders_2 = require("./orders");
const countries_1 = require("../countries");
const OWNER_MANAGER_ROLE_PLACEHOLDERS = role_permissions_1.ROLE_ACCESS.ownerManager.map(() => '?').join(', ');
const tax_1 = require("../services/tax");
const cloud_sync_1 = require("../services/cloud-sync");
const phone_1 = require("../lib/phone");
const qrcode_1 = __importDefault(require("qrcode"));
const async_handler_1 = require("../middleware/async-handler");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
// "Cloud POS is not registered" (thrown synchronously by cloud-sync.ts's
// signedFetch, no network call even attempted) means this store was never
// claimed in FloAdmin — a distinct, actionable state from a genuine
// connectivity failure reaching FloAdmin, and the two need different status
// codes/messages so the frontend (and anyone reading server logs) doesn't
// mistake "not claimed yet" for "FloAdmin is down".
function isUnregisteredCloudError(error) {
    return typeof error?.message === 'string' && error.message.includes('is not registered');
}
function mobilePairingErrorStatus(error) {
    return isUnregisteredCloudError(error) ? 409 : 502;
}
function mobilePairingErrorMessage(error) {
    if (isUnregisteredCloudError(error)) {
        return 'This POS hasn’t been claimed in FloAdmin yet. Complete registration in FloAdmin, then try generating a pairing code again.';
    }
    return error?.message || 'Could not reach FloAdmin';
}
const inlineCustomerLookupRateLimit = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
const inlineOrderWriteRateLimit = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
function registerRoutes(app) {
    // Auth routes
    app.use('/api/auth', auth_1.authRoutes);
    // Resource routes
    app.use('/api/categories', categories_1.categoryRoutes);
    app.use('/api/products', products_1.productRoutes);
    app.use('/api/addon-groups', addon_groups_1.addonGroupRoutes);
    app.use('/api/orders', orders_1.orderRoutes);
    app.use('/api/order-items', order_items_1.orderItemRoutes);
    app.use('/api/kitchen', kitchen_1.kitchenRoutes);
    app.use('/api/bills', bills_1.billRoutes);
    app.use('/api/refunds', refunds_1.refundRoutes);
    app.use('/api/tables', tables_1.tableRoutes);
    app.use('/api/kitchen-stations', kitchen_stations_1.kitchenStationRoutes);
    app.use('/api/customers', customers_1.customerRoutes);
    app.use('/api/staff', staff_1.staffRoutes); // users with POS roles
    app.use('/api/users', staff_1.staffRoutes); // same router, dual-mounted
    app.use('/api/settings', settings_1.settingsRoutes);
    app.use('/api/payment-methods', payment_methods_1.paymentMethodRoutes);
    app.use('/api/reports', reports_1.reportRoutes);
    app.use('/api/shifts', shifts_1.shiftRoutes);
    app.use('/api/kds', kds_1.kdsRoutes);
    app.use('/api/kds-info', kds_info_1.kdsInfoRoutes);
    app.use('/api/pos-info', pos_info_1.posInfoRoutes);
    app.use('/api/server-app-info', server_app_info_1.serverAppInfoRoutes);
    app.use('/api/more-apps', more_apps_1.moreAppsRoutes);
    app.use('/api/printers', printers_1.printerRoutes);
    app.use('/api/db', database_1.databaseRoutes);
    app.use('/api/db-tools', database_tools_1.databaseToolsRoutes);
    app.use('/api/menu-csv', menu_csv_1.menuCsvRoutes);
    app.use('/api/tax-packs', tax_packs_1.taxPackRoutes);
    app.use('/api/held-orders', held_orders_1.heldOrderRoutes);
    app.use('/api/print-templates', print_templates_1.printTemplateRoutes);
    app.use('/api/whatsapp', whatsapp_1.whatsappRoutes);
    app.use('/api/support-ticket', support_ticket_1.supportTicketRoutes);
    // Tax preview
    app.post('/api/tax/preview', (0, async_handler_1.asyncHandler)(async (req, res) => {
        const { calculateTaxPreview } = await Promise.resolve().then(() => __importStar(require('../services/tax')));
        calculateTaxPreview(req, res);
    }));
    // Categories available under the store's active country pack — powers the
    // product-page category selector. Read-only; pack activation/management
    // (installing/updating a pack) is a separate, later feature.
    app.get('/api/tax/categories', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (0, async_handler_1.asyncHandler)(async (req, res) => {
        try {
            const { getActiveCountryPack, hasConfiguredTaxCategories, previewCategoryRate } = await Promise.resolve().then(() => __importStar(require('../services/tax')));
            const country = (0, db_1.getSettingValue)('country') || 'IN';
            const businessType = (0, db_1.getSettingValue)('business_type') || 'restaurant';
            const pack = getActiveCountryPack(country);
            const configurationReady = hasConfiguredTaxCategories(pack, businessType);
            res.json({
                pack_id: pack.id,
                country: pack.country,
                // The bundled generic pack deliberately has no rules. Exposing its
                // placeholder categories as assignable would migrate a product from
                // legacy tax to a zero-tax engine path.
                categories: configurationReady
                    ? pack.categories.map((category) => {
                        const preview = previewCategoryRate(pack, businessType, category.id);
                        return {
                            id: category.id,
                            label: category.label,
                            rate_percent: preview?.percent ?? null,
                            rate_label: preview?.label ?? null,
                        };
                    })
                    : [],
                default_category_id: configurationReady ? pack.defaultCategories.product : null,
                configuration_ready: configurationReady,
                unclassified_category_id: pack.unclassifiedCategoryId,
            });
        }
        catch (error) {
            console.error('[API] Internal error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }));
    // Mobile pairing code — proxies FloAdmin (see cloud-sync.ts generatePairingCode).
    // Cache-first: repeat GETs (e.g. reopening Settings) must NOT generate a new
    // code or disconnect paired devices — only a stale/missing cache calls out.
    app.get('/api/mobile/pairing-code', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (0, async_handler_1.asyncHandler)(async (req, res) => {
        try {
            const cached = (0, db_1.getCachedPairingCode)();
            if (cached) {
                return res.json({
                    pairing_code: cached.code,
                    expires_at: cached.expiresAt,
                    qr_data_url: await qrcode_1.default.toDataURL(cached.code, { errorCorrectionLevel: 'M', width: 256 }),
                });
            }
            const { code, expires_at } = await cloud_sync_1.cloudSync.generatePairingCode(false);
            (0, db_1.setCachedPairingCode)(code, expires_at);
            res.json({
                pairing_code: code,
                expires_at,
                qr_data_url: await qrcode_1.default.toDataURL(code, { errorCorrectionLevel: 'M', width: 256 }),
            });
        }
        catch (error) {
            res.status(mobilePairingErrorStatus(error)).json({ error: mobilePairingErrorMessage(error) });
        }
    }));
    // Explicit rotate — disconnects every currently-paired RevFlo device.
    app.post('/api/mobile/rotate-code', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (0, async_handler_1.asyncHandler)(async (req, res) => {
        try {
            const { code, expires_at } = await cloud_sync_1.cloudSync.generatePairingCode(true);
            (0, db_1.setCachedPairingCode)(code, expires_at);
            res.json({
                pairing_code: code,
                expires_at,
                qr_data_url: await qrcode_1.default.toDataURL(code, { errorCorrectionLevel: 'M', width: 256 }),
            });
        }
        catch (error) {
            res.status(mobilePairingErrorStatus(error)).json({ error: mobilePairingErrorMessage(error) });
        }
    }));
    // Paired RevFlo devices for this store — Settings > Mobile App session list.
    app.get('/api/mobile/devices', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (0, async_handler_1.asyncHandler)(async (req, res) => {
        try {
            const devices = await cloud_sync_1.cloudSync.listPairedDevices();
            res.json({ devices });
        }
        catch (error) {
            console.error('[API] FloAdmin request failed:', error);
            res.status(502).json({ error: 'Could not reach FloAdmin' });
        }
    }));
    // Legacy/flat customer search endpoint (frontend uses this)
    app.get('/api/customers-search', inlineCustomerLookupRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.sales), (req, res) => {
        try {
            const { q } = req.query;
            const rawSearch = String(q || '').trim();
            if (rawSearch.length < 2) {
                return res.json([]);
            }
            const db = (0, db_1.getDatabase)();
            const digitsSearch = (0, phone_1.stripPhoneDigits)(rawSearch);
            const isPhoneLikeSearch = digitsSearch.length > 0 && !/\p{L}/u.test(rawSearch);
            const searchTerm = `%${rawSearch}%`;
            const phoneDigitsSearch = `REPLACE(phone_digits, '/', '')`;
            const query = isPhoneLikeSearch
                ? `
        SELECT * FROM customers
        WHERE is_active = 1 AND (${phoneDigitsSearch} LIKE ? OR name LIKE ? OR email LIKE ?)
        ORDER BY name LIMIT 20
      `
                : `
        SELECT * FROM customers
        WHERE is_active = 1 AND (name LIKE ? OR email LIKE ?)
        ORDER BY name LIMIT 20
      `;
            const params = isPhoneLikeSearch
                ? [`%${digitsSearch}%`, searchTerm, searchTerm]
                : [searchTerm, searchTerm];
            const customers = db.prepare(query).all(...params);
            const results = customers.map((c) => ({
                ...(0, customers_1.parseCustomer)(c),
                wallet_balance: (0, customers_1.getWalletBalance)(c.id),
            }));
            res.json(results);
        }
        catch (error) {
            console.error("[API] Internal error:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });
    // CRM lookup endpoint (frontend uses this)
    app.get('/api/crm/lookup', inlineCustomerLookupRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.sales), (req, res) => {
        try {
            const { phone, country_code } = req.query;
            if (!phone) {
                return res.status(400).json({ error: 'Phone number required' });
            }
            const db = (0, db_1.getDatabase)();
            const tenantCountry = (0, db_1.getSettingValue)('country') || 'IN';
            const parsed = (0, phone_1.parsePhoneE164)(String(phone).trim(), tenantCountry);
            const lookupPhone = parsed ? parsed.e164 : String(phone).trim();
            const phoneDigits = (0, phone_1.stripPhoneDigits)(lookupPhone);
            const customer = db.prepare('SELECT * FROM customers WHERE phone_digits = ?').get(phoneDigits);
            if (customer) {
                res.json({ found: true, customer });
            }
            else {
                res.json({ found: false, customer: null });
            }
        }
        catch (error) {
            console.error("[API] Internal error:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });
    // Cancel or void an order item (frontend calls this)
    app.patch('/api/orders/:orderId/items/:itemId/cancel', inlineOrderWriteRateLimit, (req, res) => {
        try {
            const orderId = String(req.params.orderId);
            const itemId = String(req.params.itemId);
            const { override_pin } = req.body;
            // requireAuth (main/server.ts) already verified the token and attached
            // the user's current DB role to req.user — use that, not the JWT claim.
            const actorId = String(req.user?.userId || '');
            if (!actorId)
                return res.status(403).json({ error: 'Authentication required' });
            const db = (0, db_1.getDatabase)();
            // Keep these lookups only for the inexpensive not-found response. Every
            // authorization, policy, and mutation decision is repeated from the
            // transaction-local rows below so a concurrent writer cannot authorize
            // against this pre-transaction snapshot.
            const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }
            const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId);
            if (!item) {
                return res.status(404).json({ error: 'Item not found in this order' });
            }
            // BUG #17 FIX: Wrap cancel + total recalc in transaction
            const result = (0, db_1.withTxn)(() => {
                const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
                const currentItem = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId);
                if (!currentItem || !currentOrder) {
                    throw Object.assign(new Error('Item or order not found'), { statusCode: 404 });
                }
                const actor = db.prepare('SELECT role FROM users WHERE id = ? AND is_active = 1').get(actorId);
                if (!actor) {
                    throw Object.assign(new Error('Authentication required'), { statusCode: 403 });
                }
                const userRole = actor.role;
                if (userRole === 'server' && String(currentOrder.user_id) !== actorId) {
                    throw Object.assign(new Error('Servers can only modify their own orders'), { statusCode: 403 });
                }
                // A repeated request against an already terminal item is an
                // intentional idempotent no-op. Check it before the parent terminal
                // policy so a retry cannot turn a harmless repeat into a new error.
                if (['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(currentItem.status)) {
                    if (!(0, role_permissions_1.hasRole)(userRole, role_permissions_1.ROLE_ACCESS.ownerManager)) {
                        throw Object.assign(new Error('Only owner or manager can cancel this item'), { statusCode: 403 });
                    }
                    const items = (0, db_1.attachEffectiveAddons)(db, db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(db_1.parseItemJson));
                    return {
                        updatedOrder: currentOrder,
                        items,
                        orderCancelled: currentOrder.status === 'cancelled',
                        eventType: null,
                    };
                }
                if (db.prepare(`
          SELECT 1
          FROM bills
          WHERE order_id = ?
            AND (
              COALESCE(payment_status, 'unpaid') <> 'unpaid'
              OR COALESCE(paid_amount, 0) > 0
              OR (payment_details IS NOT NULL AND TRIM(payment_details) NOT IN ('', '[]', '{}', 'null'))
            )
          LIMIT 1
        `).get(orderId)) {
                    throw Object.assign(new Error('Cannot cancel items on a paid or partially paid order'), { statusCode: 409 });
                }
                // Completed and cancelled orders are terminal. This guard must run
                // before any item, stock, order, table, or bill mutation.
                if (['completed', 'cancelled'].includes(currentOrder.status)) {
                    throw Object.assign(new Error('Cannot cancel items on completed or cancelled orders'), { statusCode: 400 });
                }
                // #150: an item the kitchen has already started on (preparing/ready)
                // can't be silently deleted like a pending one — the ingredients are
                // already consumed. Voiding it instead requires a manager PIN, mirrors
                // the whole-order-cancel override pattern, and leaves a negative bill
                // line so the removal stays visible on the bill.
                const isItemVoid = ['preparing', 'ready'].includes(currentItem.status);
                const isPrivilegedRole = (0, role_permissions_1.hasRole)(userRole, role_permissions_1.ROLE_ACCESS.ownerManager);
                const canUseOverride = (0, role_permissions_1.hasRole)(userRole, role_permissions_1.ROLE_ACCESS.cashierServer) && isItemVoid;
                if (!isPrivilegedRole && !canUseOverride) {
                    throw Object.assign(new Error('Only owner or manager can cancel this item'), { statusCode: 403 });
                }
                if (isItemVoid) {
                    if (!override_pin) {
                        throw Object.assign(new Error('Manager PIN required to void an item already in progress'), { statusCode: 400 });
                    }
                    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
                    // Key is per-client/per-action, deliberately NOT per-item: a caller
                    // must not get a fresh attempt window by rotating item identifiers
                    // (GHSA-9jjq-2fmw-x3mw).
                    const rateLimitKey = `pin:${clientIp}:item-void`;
                    if (!(0, orders_2.checkPinRateLimit)(rateLimitKey)) {
                        throw Object.assign(new Error('Too many PIN attempts. Try again in 15 minutes.'), { statusCode: 429 });
                    }
                    const managerId = req.body.manager_id || req.body.user_id;
                    let pinUser = null;
                    if (managerId) {
                        const candidate = db.prepare(`SELECT * FROM users WHERE id = ? AND pin_hash IS NOT NULL AND role IN (${OWNER_MANAGER_ROLE_PLACEHOLDERS}) AND is_active = 1`).get(managerId, ...role_permissions_1.ROLE_ACCESS.ownerManager);
                        if (candidate && (0, db_1.verifyPin)(candidate.pin_hash, override_pin)) {
                            pinUser = candidate;
                        }
                    }
                    if (!pinUser) {
                        const managers = db.prepare(`SELECT * FROM users WHERE pin_hash IS NOT NULL AND role IN (${OWNER_MANAGER_ROLE_PLACEHOLDERS}) AND is_active = 1`).all(...role_permissions_1.ROLE_ACCESS.ownerManager);
                        for (const u of managers) {
                            if ((0, db_1.verifyPin)(u.pin_hash, override_pin)) {
                                pinUser = u;
                                break;
                            }
                        }
                    }
                    if (!pinUser) {
                        throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
                    }
                }
                if (isItemVoid) {
                    // Leave the original line alone (it's a true record of what was
                    // ordered and prepared) and add a mirrored negative line instead of
                    // deleting anything — the bill total nets to the refund/comp
                    // automatically via the recalc below, same as a plain cancel would,
                    // but both lines stay on the bill permanently.
                    db.prepare(`
            INSERT INTO order_items (
              order_id, product_id, product_name, product_sku, unit_price, quantity,
              subtotal, tax_amount, tax_breakdown, tax_snapshot, tax_type, discount_amount, total,
              variant_selection, modifier_selection, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'void_adjustment', ?, ?)
          `).run(orderId, currentItem.product_id, `Void: ${currentItem.product_name}`, currentItem.product_sku, -currentItem.unit_price, currentItem.quantity, -currentItem.subtotal, -(currentItem.tax_amount || 0), (0, tax_1.invertTaxBreakdown)(currentItem.tax_breakdown), (0, tax_1.invertTaxSnapshot)(currentItem.tax_snapshot), currentItem.tax_type, -(currentItem.discount_amount || 0), -currentItem.total, currentItem.variant_selection, currentItem.modifier_selection, (0, db_1.now)(), (0, db_1.now)());
                    // #150 Q1-Q4 decision: mark 'voided', not 'cancelled' — a distinct,
                    // terminal status. Item stage-change endpoints reject any further
                    // transition once status is 'voided', and inventory is
                    // deliberately left alone: it was already deducted when the item
                    // was added, and voiding an already-prepared item must not restock it.
                    db.prepare("UPDATE order_items SET status = 'voided', voided_at = ?, updated_at = ? WHERE id = ?")
                        .run((0, db_1.now)(), (0, db_1.now)(), itemId);
                }
                else {
                    // Cancel the item and restore the inventory quantity recorded when it was added.
                    db.prepare("UPDATE order_items SET status = 'cancelled', updated_at = ? WHERE id = ?")
                        .run((0, db_1.now)(), itemId);
                    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(currentItem.product_id);
                    if (product && currentItem.inventory_deducted_quantity > 0) {
                        db.prepare('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?')
                            .run(currentItem.inventory_deducted_quantity, (0, db_1.now)(), product.id);
                    }
                }
                // Recalculate order totals excluding cancelled, voided, and void_adjustment items
                const activeItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND status NOT IN ('cancelled', 'voided', 'void_adjustment', 'refunded')")
                    .all(orderId);
                let subtotal = 0;
                let totalTax = 0;
                let exclusiveTax = 0;
                const allTaxBreakdowns = [];
                const allTaxSnapshots = [];
                for (const i of activeItems) {
                    subtotal += i.subtotal || 0;
                    totalTax += i.tax_amount || 0;
                    if (i.tax_type !== 'inclusive') {
                        exclusiveTax += i.tax_amount || 0;
                    }
                    if (i.tax_breakdown) {
                        try {
                            const breakdown = JSON.parse(i.tax_breakdown);
                            if (Array.isArray(breakdown))
                                allTaxBreakdowns.push(breakdown);
                        }
                        catch { }
                    }
                    allTaxSnapshots.push(i.tax_snapshot || null);
                }
                // BUG #13 FIX: Preserve order-level discount (scale percentage proportionally)
                const currency = (0, bills_1.getTenantCurrency)();
                const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
                const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)(currency);
                const existingDiscountAmount = currentOrder.discount_amount || 0;
                let newDiscountAmount = existingDiscountAmount;
                if (existingDiscountAmount > 0 && currentOrder.subtotal > 0) {
                    if (currentOrder.discount_type === 'percentage') {
                        const pct = currentOrder.discount_value || 0;
                        newDiscountAmount = Number((subtotal * pct / 100).toFixed(decimals));
                    }
                    // amount type: keep same value
                }
                const discountedSubtotal = Math.max(0, subtotal - newDiscountAmount);
                let newTaxAmount = totalTax;
                let newExclusiveTax = exclusiveTax;
                let taxRatio = 1;
                if (newDiscountAmount > 0 && subtotal > 0) {
                    taxRatio = discountedSubtotal / subtotal;
                    newTaxAmount = Number((totalTax * taxRatio).toFixed(decimals));
                    newExclusiveTax = Number((exclusiveTax * taxRatio).toFixed(decimals));
                }
                const tenantInfo = {
                    country: (0, db_1.getSettingValue)('country') || 'IN',
                    business_type: (0, db_1.getSettingValue)('business_type') || 'restaurant',
                    state_code: (0, db_1.getSettingValue)('state_code') || '',
                    currency: (0, bills_1.getTenantCurrency)(),
                    taxes_enabled: (0, db_1.getSettingValue)('taxes_enabled') === 'true',
                };
                const customer = currentOrder.customer_id
                    ? db.prepare('SELECT * FROM customers WHERE id = ?').get(currentOrder.customer_id)
                    : null;
                const chargeTaxes = (0, tax_1.calculateConfiguredChargeTaxes)(tenantInfo, currentOrder, customer);
                const taxRollup = (0, tax_1.combineItemAndChargeTaxes)({
                    itemTaxAmount: newTaxAmount,
                    itemExclusiveTaxAmount: newExclusiveTax,
                    itemBreakdowns: allTaxBreakdowns,
                    itemSnapshots: allTaxSnapshots,
                    itemTaxRatio: taxRatio,
                    chargeTaxes,
                    minorFactor,
                });
                // BUG #5 FIX: Correct round-off formula; BUG #24 FIX: include delivery_charge (was missing, causing total mismatch with bill generation)
                const preRoundTotal = discountedSubtotal + taxRollup.exclusiveTaxAmount
                    + (currentOrder.delivery_charge || 0) + (currentOrder.packaging_charge || 0) + (currentOrder.service_charge || 0);
                const roundOff = 0;
                const total = Number(preRoundTotal.toFixed(decimals));
                // #132 FIX: cancelling the last active item leaves nothing to serve or
                // bill — treat it as the whole order being cancelled, the same way the
                // explicit order-level cancel (routes/orders.ts) does: free the table,
                // and stamp cancelled_at/cancellation_reason. (Item stock was already restored above).
                const orderCancelled = activeItems.length === 0 && currentOrder.status !== 'cancelled';
                if (orderCancelled) {
                    db.prepare(`
            UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, total = ?, round_off = ?,
              status = 'cancelled', cancelled_at = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?
          `).run(subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newDiscountAmount, total, roundOff, (0, db_1.now)(), 'All items cancelled', (0, db_1.now)(), orderId);
                    if (currentOrder.table_id) {
                        db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?")
                            .run((0, db_1.now)(), currentOrder.table_id);
                    }
                }
                else {
                    db.prepare(`
            UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, total = ?, round_off = ?, updated_at = ? WHERE id = ?
          `).run(subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newDiscountAmount, total, roundOff, (0, db_1.now)(), orderId);
                }
                (0, bills_1.syncUnpaidBillsForOrder)(db, orderId, {
                    subtotal,
                    taxAmount: taxRollup.taxAmount,
                    taxBreakdown: JSON.stringify(taxRollup.breakdowns),
                    taxSnapshot: taxRollup.snapshotJson,
                    discountAmount: newDiscountAmount,
                    deliveryCharge: order.delivery_charge || 0,
                    packagingCharge: order.packaging_charge || 0,
                    serviceCharge: order.service_charge || 0,
                    total,
                }, tenantInfo.country);
                const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
                const items = (0, db_1.attachEffectiveAddons)(db, db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(db_1.parseItemJson));
                return {
                    updatedOrder,
                    items,
                    orderCancelled,
                    eventType: orderCancelled ? 'order.cancelled' : (isItemVoid ? 'order.item_voided' : 'order.item_cancelled'),
                };
            });
            if (result.eventType) {
                cloud_sync_1.cloudSync.recordOrderChanged(orderId, result.eventType);
                (0, kds_2.notifyKdsUpdate)();
            }
            res.json({ order: { ...result.updatedOrder, items: result.items } });
        }
        catch (error) {
            console.error('[Orders] Cancel item error:', error);
            console.error("[API] Internal error:", error);
            res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Internal server error" });
        }
    });
    // Restore cancelled order item (frontend calls this)
    app.patch('/api/orders/:orderId/items/:itemId/restore', (req, res) => {
        try {
            const { orderId, itemId } = req.params;
            // requireAuth (main/server.ts) already verified the token and attached
            // the user's current DB role to req.user — use that, not the JWT claim.
            const actorId = String(req.user?.userId || '');
            if (!actorId)
                return res.status(403).json({ error: 'Authentication required' });
            const db = (0, db_1.getDatabase)();
            // Keep these lookups only for the inexpensive not-found response. The
            // transaction repeats all mutable state and policy checks authoritatively.
            const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }
            const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId);
            if (!item) {
                return res.status(404).json({ error: 'Item not found in this order' });
            }
            // BUG #17 FIX: Wrap restore + total recalc in transaction
            const result = (0, db_1.withTxn)(() => {
                const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
                const currentItem = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId);
                if (!currentItem || !currentOrder) {
                    throw Object.assign(new Error('Item or order not found'), { statusCode: 404 });
                }
                const actor = db.prepare('SELECT role FROM users WHERE id = ? AND is_active = 1').get(actorId);
                if (!actor || !(0, role_permissions_1.hasRole)(actor.role, role_permissions_1.ROLE_ACCESS.ownerManager)) {
                    throw Object.assign(new Error('Only owner or manager can restore items'), { statusCode: 403 });
                }
                if (['completed', 'cancelled'].includes(currentOrder.status)) {
                    throw Object.assign(new Error('Cannot restore items on completed or cancelled orders'), { statusCode: 400 });
                }
                if (db.prepare("SELECT id FROM bills WHERE order_id = ? AND payment_status = 'paid'").get(orderId)) {
                    throw Object.assign(new Error('Cannot restore items on a paid order'), { statusCode: 400 });
                }
                // Only cancelled items can be restored; ignore if already active or voided
                if (currentItem.status !== 'cancelled') {
                    const items = (0, db_1.attachEffectiveAddons)(db, db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(db_1.parseItemJson));
                    return { updatedOrder: currentOrder, items, changed: false };
                }
                // Re-deduct the inventory quantity originally consumed by the item
                const product = db.prepare('SELECT * FROM products WHERE id = ?').get(currentItem.product_id);
                if (product && currentItem.inventory_deducted_quantity > 0) {
                    if (product.stock_quantity < currentItem.inventory_deducted_quantity) {
                        throw Object.assign(new Error(`Insufficient stock to restore item (Available: ${product.stock_quantity}, Required: ${currentItem.inventory_deducted_quantity})`), { statusCode: 400 });
                    }
                    db.prepare('UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ?')
                        .run(currentItem.inventory_deducted_quantity, (0, db_1.now)(), product.id);
                }
                // Restore - mark as pending
                db.prepare("UPDATE order_items SET status = 'pending', updated_at = ? WHERE id = ?")
                    .run((0, db_1.now)(), itemId);
                // Recalculate order totals
                const activeItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND status NOT IN ('cancelled', 'voided', 'void_adjustment', 'refunded')")
                    .all(orderId);
                let subtotal = 0;
                let totalTax = 0;
                let exclusiveTax = 0;
                const allTaxBreakdowns = [];
                const allTaxSnapshots = [];
                for (const i of activeItems) {
                    subtotal += i.subtotal || 0;
                    totalTax += i.tax_amount || 0;
                    if (i.tax_type !== 'inclusive') {
                        exclusiveTax += i.tax_amount || 0;
                    }
                    if (i.tax_breakdown) {
                        try {
                            const breakdown = JSON.parse(i.tax_breakdown);
                            if (Array.isArray(breakdown))
                                allTaxBreakdowns.push(breakdown);
                        }
                        catch { }
                    }
                    allTaxSnapshots.push(i.tax_snapshot || null);
                }
                // BUG #13 FIX: Preserve order-level discount (scale percentage proportionally)
                const currency = (0, bills_1.getTenantCurrency)();
                const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
                const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)(currency);
                const existingDiscountAmount = currentOrder.discount_amount || 0;
                let newDiscountAmount = existingDiscountAmount;
                if (existingDiscountAmount > 0 && currentOrder.subtotal > 0) {
                    if (currentOrder.discount_type === 'percentage') {
                        const pct = currentOrder.discount_value || 0;
                        newDiscountAmount = Number((subtotal * pct / 100).toFixed(decimals));
                    }
                    // amount type: keep same value
                }
                const discountedSubtotal = Math.max(0, subtotal - newDiscountAmount);
                let newTaxAmount = totalTax;
                let newExclusiveTax = exclusiveTax;
                let taxRatio = 1;
                if (newDiscountAmount > 0 && subtotal > 0) {
                    taxRatio = discountedSubtotal / subtotal;
                    newTaxAmount = Number((totalTax * taxRatio).toFixed(decimals));
                    newExclusiveTax = Number((exclusiveTax * taxRatio).toFixed(decimals));
                }
                const tenantInfo = {
                    country: (0, db_1.getSettingValue)('country') || 'IN',
                    business_type: (0, db_1.getSettingValue)('business_type') || 'restaurant',
                    state_code: (0, db_1.getSettingValue)('state_code') || '',
                    currency: (0, bills_1.getTenantCurrency)(),
                    taxes_enabled: (0, db_1.getSettingValue)('taxes_enabled') === 'true',
                };
                const customer = currentOrder.customer_id
                    ? db.prepare('SELECT * FROM customers WHERE id = ?').get(currentOrder.customer_id)
                    : null;
                const chargeTaxes = (0, tax_1.calculateConfiguredChargeTaxes)(tenantInfo, currentOrder, customer);
                const taxRollup = (0, tax_1.combineItemAndChargeTaxes)({
                    itemTaxAmount: newTaxAmount,
                    itemExclusiveTaxAmount: newExclusiveTax,
                    itemBreakdowns: allTaxBreakdowns,
                    itemSnapshots: allTaxSnapshots,
                    itemTaxRatio: taxRatio,
                    chargeTaxes,
                    minorFactor,
                });
                // BUG #5 FIX: Correct round-off formula; BUG #24 FIX: include delivery_charge (was missing, causing total mismatch with bill generation)
                const preRoundTotal = discountedSubtotal + taxRollup.exclusiveTaxAmount
                    + (currentOrder.delivery_charge || 0) + (currentOrder.packaging_charge || 0) + (currentOrder.service_charge || 0);
                const roundOff = 0;
                const total = Number(preRoundTotal.toFixed(decimals));
                db.prepare(`
          UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, total = ?, round_off = ?, updated_at = ? WHERE id = ?
        `).run(subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newDiscountAmount, total, roundOff, (0, db_1.now)(), orderId);
                (0, bills_1.syncUnpaidBillsForOrder)(db, orderId, {
                    subtotal,
                    taxAmount: taxRollup.taxAmount,
                    taxBreakdown: JSON.stringify(taxRollup.breakdowns),
                    taxSnapshot: taxRollup.snapshotJson,
                    discountAmount: newDiscountAmount,
                    deliveryCharge: order.delivery_charge || 0,
                    packagingCharge: order.packaging_charge || 0,
                    serviceCharge: order.service_charge || 0,
                    total,
                }, tenantInfo.country);
                const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
                const items = (0, db_1.attachEffectiveAddons)(db, db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(db_1.parseItemJson));
                return { updatedOrder, items, changed: true };
            });
            if (result.changed) {
                cloud_sync_1.cloudSync.recordOrderChanged(orderId, 'order.item_restored');
                (0, kds_2.notifyKdsUpdate)();
            }
            res.json({ order: { ...result.updatedOrder, items: result.items } });
        }
        catch (error) {
            console.error('[Orders] Restore item error:', error);
            console.error("[API] Internal error:", error);
            res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Internal server error" });
        }
    });
}
//# sourceMappingURL=index.js.map