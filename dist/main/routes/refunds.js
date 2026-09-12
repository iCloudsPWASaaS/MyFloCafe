"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refundRoutes = void 0;
const crypto_1 = require("crypto");
const express_1 = require("express");
const db_1 = require("../db");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const orders_1 = require("./orders");
const refund_1 = require("../services/refund");
const countries_1 = require("../countries");
const router = (0, express_1.Router)();
exports.refundRoutes = router;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_REASON_LENGTH = 500;
function refundIdempotencyKey(req) {
    const supplied = req.get('Idempotency-Key')?.trim();
    if (!supplied)
        return null;
    if (supplied.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(supplied)) {
        throw Object.assign(new Error('Idempotency-Key is invalid or too long'), { statusCode: 400 });
    }
    return supplied;
}
function refundRequestHash(billId, body) {
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify({
        billId,
        order_item_id: body.order_item_id ?? null,
        amount: body.amount ?? null,
        method: body.method ?? null,
        reason: body.reason ?? null,
        shift_id: body.shift_id ?? null,
    })).digest('hex');
}
function refundAmountMinorUnits(value, currency) {
    if (typeof value !== 'number' && typeof value !== 'string') {
        throw Object.assign(new Error('Refund amount must be a finite number greater than zero'), { statusCode: 400 });
    }
    const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
    const factor = (0, countries_1.getCurrencyMinorUnitFactor)(currency);
    const text = String(value).trim();
    const pattern = decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
    if (!pattern.test(text)) {
        const decDesc = decimals === 0 ? 'without decimals' : `with at most ${decimals} decimal places`;
        throw Object.assign(new Error(`Refund amount must be a finite number greater than zero ${decDesc}`), { statusCode: 400 });
    }
    const parsed = Number(text);
    const minorUnits = Math.round(parsed * factor);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isSafeInteger(minorUnits)) {
        throw Object.assign(new Error('Refund amount must be a finite number greater than zero'), { statusCode: 400 });
    }
    return minorUnits;
}
router.post('/', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const body = req.body || {};
        const billId = body.bill_id;
        if (billId === undefined || billId === null || billId === '') {
            return res.status(400).json({ error: 'bill_id is required' });
        }
        const orderItemId = body.order_item_id !== undefined && body.order_item_id !== null ? Number(body.order_item_id) : null;
        if (orderItemId !== null && !Number.isSafeInteger(orderItemId)) {
            return res.status(400).json({ error: 'order_item_id must be an integer' });
        }
        const db = (0, db_1.getDatabase)();
        const currency = (0, refund_1.getTenantCurrency)(db);
        let amountCents;
        if (body.amount !== undefined && body.amount !== null) {
            amountCents = refundAmountMinorUnits(body.amount, currency);
        }
        else if (orderItemId === null) {
            return res.status(400).json({ error: 'amount is required unless order_item_id is given' });
        }
        if (typeof body.reason === 'string' && body.reason.length > MAX_REASON_LENGTH) {
            return res.status(400).json({ error: 'reason is too long' });
        }
        const idempotencyKey = refundIdempotencyKey(req);
        const requestHash = idempotencyKey ? refundRequestHash(String(billId), body) : undefined;
        const userId = String(req.user.userId);
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        const refundRequest = {
            billId,
            orderItemId,
            amountCents,
            method: body.method,
            reason: body.reason ?? null,
            shiftId: body.shift_id ?? null,
            overridePin: body.override_pin,
            managerId: body.manager_id || body.user_id,
            createdByUserId: userId,
            clientIp,
            checkPinRateLimit: orders_1.checkPinRateLimit,
            idempotencyKey,
            requestHash,
        };
        const result = (0, db_1.withTxn)(() => (0, refund_1.createRefund)(db, refundRequest));
        res.status(201).json(result);
    }
    catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || 'Unable to process refund' });
    }
});
router.get('/', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManagerCashier), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        let query = 'SELECT * FROM refunds WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as count FROM refunds WHERE 1=1';
        const params = [];
        if (req.query.bill_id) {
            query += ' AND bill_id = ?';
            countQuery += ' AND bill_id = ?';
            params.push(req.query.bill_id);
        }
        const requestedLimit = req.query.limit !== undefined ? Number(req.query.limit) : 50;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            return res.status(400).json({ error: 'limit must be a positive integer' });
        }
        const limit = Math.min(requestedLimit, 500);
        const offset = req.query.offset !== undefined ? Number(req.query.offset) : 0;
        if (!Number.isInteger(offset) || offset < 0) {
            return res.status(400).json({ error: 'offset must be a non-negative integer' });
        }
        query += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
        const pageParams = [...params, limit, offset];
        const refunds = db.prepare(query).all(...pageParams);
        const total = Number(db.prepare(countQuery).get(...params)?.count || 0);
        res.json({
            refunds,
            pagination: {
                limit,
                per_page: limit,
                offset,
                total,
                next_offset: offset + refunds.length < total ? offset + refunds.length : null,
                has_more: offset + refunds.length < total,
            },
        });
    }
    catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || 'Unable to list refunds' });
    }
});
//# sourceMappingURL=refunds.js.map