"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerRoutes = void 0;
exports.parseCustomer = parseCustomer;
exports.getWalletBalance = getWalletBalance;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const crypto_1 = require("crypto");
const db_1 = require("../db");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const phone_1 = require("../lib/phone");
function parseCustomer(c) {
    if (!c)
        return c;
    return {
        ...c,
        tag_counts: c.tag_counts ? (() => { try {
            return JSON.parse(c.tag_counts);
        }
        catch {
            return null;
        } })() : null,
    };
}
const router = (0, express_1.Router)();
const customerReadRateLimit = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
const customerWriteRateLimit = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
function invalidPhonePredicate(alias = '') {
    const prefix = alias ? `${alias}.` : '';
    return `${prefix}is_active = 1 AND ${prefix}phone IS NOT NULL AND ${prefix}phone != '' AND ${prefix}phone != '+' || ${prefix}phone_digits`;
}
function findCustomerByCanonicalOrLegacyPhone(db, finalPhone, originalPhone) {
    const canonicalDigits = (0, phone_1.stripPhoneDigits)(finalPhone);
    const legacyDigits = (0, phone_1.stripPhoneDigits)(originalPhone);
    const candidates = Array.from(new Set([canonicalDigits, legacyDigits].filter(Boolean)));
    if (candidates.length === 0)
        return null;
    return db.prepare(`
    SELECT *
    FROM customers
    WHERE phone_digits IN (${candidates.map(() => '?').join(',')})
    ORDER BY is_active DESC, created_at ASC, id ASC
    LIMIT 1
  `).get(...candidates);
}
function getWalletBalance(customerId) {
    if (!customerId)
        return 0;
    const db = (0, db_1.getDatabase)();
    const credits = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM loyalty_ledger
    WHERE customer_id = ? AND type = 'credit'
  `).get(customerId);
    const debits = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM loyalty_ledger
    WHERE customer_id = ? AND type = 'debit'
  `).get(customerId);
    return Math.max(0, credits.total - debits.total);
}
// Cleanup endpoint: delete all customers with null IDs - must be before /:id
router.delete('/admin/cleanup', customerWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const result = db.prepare("DELETE FROM customers WHERE id IS NULL").run();
        res.json({ message: `Deleted ${result.changes} customers with null IDs` });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post('/admin/repair-phones', customerWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const tenantCountry = (0, db_1.getSettingValue)('country') || 'IN';
        const customers = db.prepare(`
      SELECT id, phone, country_code
      FROM customers
      WHERE ${invalidPhonePredicate()}
    `).all();
        let normalizedCount = 0;
        let unparseableCount = 0;
        let conflictedCount = 0;
        for (const c of customers) {
            const parsed = (0, phone_1.parsePhoneE164)(c.phone, tenantCountry);
            if (parsed) {
                const phoneDigits = (0, phone_1.stripPhoneDigits)(parsed.e164);
                const conflict = db.prepare('SELECT id FROM customers WHERE phone_digits = ? AND id != ?').get(phoneDigits, c.id);
                if (conflict) {
                    conflictedCount++;
                }
                else {
                    db.prepare('UPDATE customers SET phone = ?, country_code = ?, updated_at = ? WHERE id = ?')
                        .run(parsed.e164, parsed.countryCode, (0, db_1.now)(), c.id);
                    normalizedCount++;
                }
            }
            else {
                unparseableCount++;
            }
        }
        res.json({
            totalScanned: customers.length,
            normalizedCount,
            unparseableCount,
            conflictedCount,
        });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/alerts', customerReadRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.sales), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const result = db.prepare(`
      SELECT COUNT(*) as count 
      FROM customers 
      WHERE ${invalidPhonePredicate()}
    `).get();
        res.json({ invalidPhonesCount: result.count });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/', customerReadRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.sales), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        // #208: the previous version ran 4 correlated subqueries per customer
        // (visits, spent, wallet credits, wallet debits, last visit) and never
        // hit any index for `WHERE o.customer_id = c.id`. The equivalent join
        // uses the new `idx_orders_customer` and groups once. Aggregates across
        // customers sit in three CTEs so each scans its index once.
        let query = `
      WITH order_stats AS (
        SELECT customer_id,
          COUNT(*) AS visits_count,
          COALESCE(SUM(total), 0) AS total_spent,
          MAX(created_at) AS last_visit_at
        FROM orders
        WHERE customer_id IS NOT NULL
        GROUP BY customer_id
      ),
      ledger_credits AS (
        SELECT customer_id, COALESCE(SUM(amount), 0) AS credits
        FROM loyalty_ledger
        WHERE type = 'credit'
        GROUP BY customer_id
      ),
      ledger_debits AS (
        SELECT customer_id, COALESCE(SUM(amount), 0) AS debits
        FROM loyalty_ledger
        WHERE type = 'debit'
        GROUP BY customer_id
      )
      SELECT c.*,
        COALESCE(os.visits_count, 0) as visits_count,
        COALESCE(os.total_spent, 0) as total_spent,
        MAX(0, COALESCE(lc.credits, 0) - COALESCE(ld.debits, 0)) as wallet_balance,
        os.last_visit_at
      FROM customers c
      LEFT JOIN order_stats os ON os.customer_id = c.id
      LEFT JOIN ledger_credits lc ON lc.customer_id = c.id
      LEFT JOIN ledger_debits ld ON ld.customer_id = c.id
      WHERE c.is_active = 1
    `;
        const params = [];
        if (req.query.search) {
            const rawSearch = String(req.query.search || '').trim();
            const digitsSearch = (0, phone_1.stripPhoneDigits)(rawSearch);
            const isPhoneLikeSearch = digitsSearch.length > 0 && !/\p{L}/u.test(rawSearch);
            const search = `%${rawSearch}%`;
            const phoneDigitsSearch = `REPLACE(c.phone_digits, '/', '')`;
            if (isPhoneLikeSearch) {
                query += ` AND (c.name LIKE ? OR ${phoneDigitsSearch} LIKE ? OR c.email LIKE ?)`;
                params.push(search, `%${digitsSearch}%`, search);
            }
            else {
                query += ' AND (c.name LIKE ? OR c.email LIKE ?)';
                params.push(search, search);
            }
        }
        if (req.query.filter === 'invalid_phones') {
            query += ` AND (${invalidPhonePredicate('c')})`;
        }
        const sortField = req.query.sort || 'name';
        const sortOrder = req.query.order === 'desc' ? 'DESC' : 'ASC';
        const allowedSortFields = {
            name: 'c.name COLLATE NOCASE',
            phone: 'c.phone_digits',
            visits: 'visits_count',
            spent: 'total_spent',
            loyalty: 'wallet_balance',
            last_visit: 'last_visit_at'
        };
        const orderBy = allowedSortFields[sortField] || 'c.name COLLATE NOCASE';
        query += ` ORDER BY ${orderBy} ${sortOrder}`;
        if (req.query.per_page !== undefined) {
            const rawPerPage = String(req.query.per_page).trim();
            if (!/^\d+$/.test(rawPerPage)) {
                return res.status(400).json({ error: 'Invalid per_page parameter. Must be a positive integer.' });
            }
            const parsed = parseInt(rawPerPage, 10);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                return res.status(400).json({ error: 'Invalid per_page parameter. Must be a positive integer.' });
            }
            const limit = Math.min(parsed, 500);
            query += ` LIMIT ${limit}`;
        }
        else {
            // #208: unbounded default meant every customers list response fanned
            // the full backend on each search keystroke. Cap at 200 as a sensible
            // first-page default; clients that need more can page (cursor support
            // is a follow-up).
            query += ` LIMIT 200`;
        }
        const customers = db.prepare(query).all(...params);
        res.json({ data: customers });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/:id', customerReadRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.sales), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const customerRaw = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
        if (!customerRaw) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        const customer = parseCustomer(customerRaw);
        const walletBalance = getWalletBalance(req.params.id);
        const loyaltyHistory = db.prepare(`
      SELECT * FROM loyalty_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(req.params.id);
        const recentOrders = db.prepare(`
      SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(req.params.id);
        res.json({ customer: { ...customer, walletBalance, loyaltyHistory, recentOrders } });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/:id/wallet', customerReadRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.sales), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const customerId = req.params.id;
        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        const balance = getWalletBalance(customerId);
        const transactions = db.prepare(`
      SELECT * FROM loyalty_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100
    `).all(customerId);
        const bills = db.prepare(`
      SELECT
        b.id, b.bill_number, b.total, b.payment_status, b.paid_at, b.created_at,
        COALESCE((SELECT SUM(amount) FROM loyalty_ledger WHERE bill_id = b.id AND type = 'credit'), 0) as points_earned,
        COALESCE((SELECT SUM(amount) FROM loyalty_ledger WHERE bill_id = b.id AND type = 'debit'), 0) as points_redeemed
      FROM bills b
      WHERE b.customer_id = ? AND b.payment_status = 'paid'
      ORDER BY COALESCE(b.paid_at, b.created_at) DESC
      LIMIT 100
    `).all(customerId);
        const totals = db.prepare(`
      SELECT
        COALESCE((SELECT SUM(total) FROM bills WHERE customer_id = ? AND payment_status = 'paid'), 0) as total_spent,
        COALESCE((SELECT SUM(amount) FROM loyalty_ledger WHERE customer_id = ? AND type = 'credit'), 0) as total_points_earned,
        COALESCE((SELECT SUM(amount) FROM loyalty_ledger WHERE customer_id = ? AND type = 'debit'), 0) as total_points_redeemed
    `).get(customerId, customerId, customerId);
        res.json({
            balance,
            transactions,
            bills,
            summary: {
                totalSpent: totals.total_spent,
                totalPointsEarned: totals.total_points_earned,
                totalPointsRedeemed: totals.total_points_redeemed,
            },
        });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post('/', customerWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.sales), (req, res) => {
    try {
        const { phone, name, email, address, notes, country_code } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Name is required' });
        }
        const db = (0, db_1.getDatabase)();
        const originalPhone = phone ? String(phone).trim() : '';
        let finalPhone = originalPhone || null;
        let finalCountryCode = country_code ? String(country_code).trim() : null;
        if (finalPhone) {
            const tenantCountry = (0, db_1.getSettingValue)('country') || 'IN';
            const parsed = (0, phone_1.parsePhoneE164)(finalPhone, tenantCountry);
            if (!parsed) {
                return res.status(400).json({ message: 'Phone number is not valid. Use international format (e.g. +919876543210).' });
            }
            finalPhone = parsed.e164;
            finalCountryCode = parsed.countryCode;
            const existing = findCustomerByCanonicalOrLegacyPhone(db, finalPhone, originalPhone);
            if (existing) {
                if (existing.is_active === 0) {
                    db.prepare(`
            UPDATE customers SET
              phone = ?,
              name = ?,
              email = ?,
              country_code = ?,
              address = ?,
              notes = ?,
              is_active = 1,
              updated_at = ?
            WHERE id = ?
          `).run(finalPhone, String(name).trim(), email ? String(email).trim() : null, finalCountryCode, address ? String(address).trim() : null, notes ? String(notes).trim() : null, (0, db_1.now)(), existing.id);
                    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(existing.id);
                    return res.status(201).json({ customer });
                }
                else {
                    return res.status(409).json({ message: 'Customer with this phone already exists' });
                }
            }
        }
        const id = `cust-${(0, crypto_1.randomUUID)()}`;
        const timestamp = (0, db_1.now)();
        db.prepare(`
      INSERT INTO customers (id, phone, name, email, country_code, address, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, finalPhone, String(name).trim(), email ? String(email).trim() : null, finalCountryCode, address ? String(address).trim() : null, notes ? String(notes).trim() : null, timestamp, timestamp);
        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
        res.status(201).json({ customer });
    }
    catch (error) {
        console.error('[Customer POST error]', error);
        res.status(500).json({ message: 'Failed to create customer' });
    }
});
router.put('/:id', customerWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManagerCashier), (req, res) => {
    try {
        const { phone, name, email, address, notes, country_code } = req.body;
        const db = (0, db_1.getDatabase)();
        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        let finalPhone = customer.phone;
        let finalCountryCode = customer.country_code;
        if (phone !== undefined) {
            if (phone === null || String(phone).trim() === '') {
                finalPhone = null;
                finalCountryCode = null;
            }
            else {
                const tenantCountry = (0, db_1.getSettingValue)('country') || 'IN';
                const parsed = (0, phone_1.parsePhoneE164)(String(phone).trim(), tenantCountry);
                if (!parsed) {
                    return res.status(400).json({ error: 'Phone number is not valid. Use international format (e.g. +919876543210).' });
                }
                finalPhone = parsed.e164;
                finalCountryCode = parsed.countryCode;
                const phoneDigits = (0, phone_1.stripPhoneDigits)(finalPhone);
                const existing = db.prepare('SELECT id FROM customers WHERE phone_digits = ? AND id != ?').get(phoneDigits, req.params.id);
                if (existing) {
                    return res.status(409).json({ error: 'Customer with this phone already exists' });
                }
            }
        }
        else if (country_code !== undefined) {
            finalCountryCode = country_code ? String(country_code).trim() : null;
        }
        let finalName = customer.name;
        if (name !== undefined) {
            const trimmedName = String(name).trim();
            if (!trimmedName) {
                return res.status(400).json({ error: 'Name is required' });
            }
            finalName = trimmedName;
        }
        const finalEmail = email !== undefined ? (email ? String(email).trim() : null) : customer.email;
        const finalAddress = address !== undefined ? (address ? String(address).trim() : null) : customer.address;
        const finalNotes = notes !== undefined ? (notes ? String(notes).trim() : null) : customer.notes;
        db.prepare(`
      UPDATE customers SET
        phone = ?,
        name = ?,
        email = ?,
        country_code = ?,
        address = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(finalPhone, finalName, finalEmail, finalCountryCode, finalAddress, finalNotes, (0, db_1.now)(), req.params.id);
        const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
        res.json({ customer: updated });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Customers are never deletable — not even soft-deleted — by design: every
// row is permanently referenced by orders/bills/loyalty_ledger with no FK,
// and losing a customer's history/loyalty standing is worse than a stale
// record. There is intentionally no DELETE /:id route.
exports.customerRoutes = router;
//# sourceMappingURL=customers.js.map