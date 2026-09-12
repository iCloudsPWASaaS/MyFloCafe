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
exports.whatsappRoutes = void 0;
const express_1 = require("express");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const async_handler_1 = require("../middleware/async-handler");
const db_1 = require("../db");
const shutdown_1 = require("../shutdown");
const whatsapp = __importStar(require("../services/whatsapp"));
const QRCode = __importStar(require("qrcode"));
const phone_1 = require("../lib/phone");
const router = (0, express_1.Router)();
function parsePaginationParam(value, fallback, max) {
    if (value === undefined)
        return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || (max !== undefined && parsed > max))
        return null;
    return parsed;
}
router.get('/status', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManagerCashier), (_req, res) => {
    const s = whatsapp.getStatus();
    // Don't expose the raw QR string via /status; the QR endpoint returns a rendered image.
    res.json({
        ...s,
        qr: undefined,
        pairingCode: undefined,
        // Default ON when the row hasn't been seeded yet (existing installs that
        // were already at v29 before whatsapp_filter_groups was added).
        filterGroups: (0, db_1.getSettingValue)('whatsapp_filter_groups') !== 'false',
    });
});
router.post('/settings', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    const next = req.body?.filterGroups;
    if (typeof next !== 'boolean') {
        res.status(400).json({ error: 'filterGroups must be a boolean' });
        return;
    }
    (0, db_1.upsertSettings)({ whatsapp_filter_groups: next ? 'true' : 'false' });
    res.json({ ok: true, filterGroups: next });
});
router.get('/qr', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (0, async_handler_1.asyncHandler)(async (_req, res) => {
    const status = whatsapp.getStatus();
    if (!status.qr) {
        res.status(404).json({ error: 'no QR available', reason: 'no_qr' });
        return;
    }
    const dataUrl = await QRCode.toDataURL(status.qr, { margin: 1, width: 320 });
    res.json({ dataUrl });
}));
router.get('/pairing-code', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (_req, res) => {
    const status = whatsapp.getStatus();
    if (!status.pairingCode) {
        res.status(404).json({ error: 'no pairing code available', reason: 'no_pairing_code' });
        return;
    }
    res.json({ code: status.pairingCode });
});
router.post('/enable', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.user?.userId ?? null;
    const result = await whatsapp.enable(userId ?? 'unknown');
    res.json(result);
}));
router.post('/disable', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (_req, res) => {
    whatsapp.disable();
    res.json({ ok: true });
});
router.post('/connect', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { method, phone } = req.body ?? {};
    if (method === 'qr') {
        res.json(await (0, shutdown_1.trackHttpRequestWork)(req, whatsapp.connectWithQr((0, shutdown_1.getHttpRequestSignal)(req))));
    }
    else if (method === 'pairing_code') {
        if (!phone) {
            res.status(400).json({ error: 'phone required for pairing code', reason: 'phone_required_pairing' });
            return;
        }
        const tenantCountry = (0, db_1.getSettingValue)('country') || 'IN';
        const parsedPhone = (0, phone_1.parsePhoneE164)(String(phone), tenantCountry);
        if (!parsedPhone) {
            res.status(400).json({ error: 'Valid phone number required for pairing code', reason: 'invalid_phone' });
            return;
        }
        res.json(await (0, shutdown_1.trackHttpRequestWork)(req, whatsapp.connectWithPairingCode(parsedPhone.e164, (0, shutdown_1.getHttpRequestSignal)(req))));
    }
    else {
        res.status(400).json({ error: 'method must be "qr" or "pairing_code"', reason: 'bad_connect_method' });
    }
}));
router.post('/disconnect', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (_req, res) => {
    whatsapp.disconnect();
    res.json({ ok: true });
});
router.post('/send', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManagerCashier), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { bill_id, phone_e164, body, kind } = req.body ?? {};
    if (!phone_e164) {
        res.status(400).json({ error: 'phone_e164 required', reason: 'phone_required' });
        return;
    }
    const tenantCountry = (0, db_1.getSettingValue)('country') || 'IN';
    const parsedPhone = (0, phone_1.parsePhoneE164)(String(phone_e164), tenantCountry);
    if (!parsedPhone) {
        res.status(400).json({ error: 'Valid phone_e164 required', reason: 'invalid_phone' });
        return;
    }
    if (!body || typeof body !== 'string') {
        res.status(400).json({ error: 'body required', reason: 'body_required' });
        return;
    }
    const userId = req.user?.userId ?? null;
    const result = await (0, shutdown_1.trackHttpRequestWork)(req, whatsapp.sendMessage({
        phoneE164: parsedPhone.e164,
        body: String(body),
        billId: bill_id != null ? Number(bill_id) : null,
        customerId: null,
        kind: kind || 'manual_reply',
        userId,
        signal: (0, shutdown_1.getHttpRequestSignal)(req),
    }));
    if (!result.ok) {
        const status = result.reason === 'not_connected' || result.reason === 'cooldown' ? 503 : 400;
        res.status(status).json({ error: result.error, reason: result.reason });
        return;
    }
    res.json({ ok: true, messageId: result.messageId });
}));
router.get('/messages', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManagerCashier), (req, res) => {
    const limitValue = parsePaginationParam(req.query.limit, 50, 200);
    const offset = parsePaginationParam(req.query.offset, 0);
    if (limitValue === null || limitValue < 1) {
        return res.status(400).json({ error: 'limit must be an integer between 1 and 200' });
    }
    if (offset === null) {
        return res.status(400).json({ error: 'offset must be a non-negative integer' });
    }
    const limit = limitValue;
    const direction = req.query.direction === 'inbound' || req.query.direction === 'outbound' ? req.query.direction : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const phone = typeof req.query.phone === 'string' ? req.query.phone : undefined;
    const billId = req.query.bill_id != null ? parsePaginationParam(req.query.bill_id, 0) : undefined;
    if (billId === null) {
        return res.status(400).json({ error: 'bill_id must be a non-negative integer' });
    }
    res.json({ messages: whatsapp.listMessages({ direction, status, phone, billId, limit, offset }) });
});
router.get('/inbox', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManagerCashier), (req, res) => {
    const limitValue = parsePaginationParam(req.query.limit, 50, 200);
    const offset = parsePaginationParam(req.query.offset, 0);
    if (limitValue === null || limitValue < 1) {
        return res.status(400).json({ error: 'limit must be an integer between 1 and 200' });
    }
    if (offset === null) {
        return res.status(400).json({ error: 'offset must be a non-negative integer' });
    }
    const limit = limitValue;
    res.json({ messages: whatsapp.listInbox(limit, offset) });
});
router.post('/inbox/:messageId/reply', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManagerCashier), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { body } = req.body ?? {};
    if (!body || typeof body !== 'string') {
        res.status(400).json({ error: 'body required', reason: 'body_required' });
        return;
    }
    const db = (0, db_1.getDatabase)();
    const msg = db.prepare('SELECT phone_e164 FROM whatsapp_messages WHERE id = ? AND direction = ?')
        .get(Number(req.params.messageId), 'inbound');
    if (!msg) {
        res.status(404).json({ error: 'inbound message not found', reason: 'inbound_not_found' });
        return;
    }
    const userId = req.user?.userId ?? null;
    const result = await (0, shutdown_1.trackHttpRequestWork)(req, whatsapp.sendMessage({
        phoneE164: msg.phone_e164,
        body: String(body),
        billId: null,
        customerId: null,
        kind: 'manual_reply',
        userId,
        signal: (0, shutdown_1.getHttpRequestSignal)(req),
    }));
    if (!result.ok) {
        const status = result.reason === 'not_connected' || result.reason === 'cooldown' ? 503 : 400;
        res.status(status).json({ error: result.error, reason: result.reason });
        return;
    }
    res.json({ ok: true, messageId: result.messageId });
}));
router.get('/blocklist', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (_req, res) => {
    res.json({ blocklist: whatsapp.listBlocklist() });
});
router.post('/blocklist', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    const { phone_e164, reason } = req.body ?? {};
    const tenantCountry = (0, db_1.getSettingValue)('country') || 'IN';
    const parsed = (0, phone_1.parsePhoneE164)(String(phone_e164 || ''), tenantCountry);
    if (!parsed) {
        res.status(400).json({ error: 'Valid phone_e164 required', reason: 'invalid_phone' });
        return;
    }
    const userId = req.user?.userId ?? null;
    whatsapp.addToBlocklist(parsed.e164, String(reason ?? ''), userId ?? 'unknown');
    res.json({ ok: true });
});
router.delete('/blocklist/:phone', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    const removed = whatsapp.removeFromBlocklist(String(req.params.phone));
    if (!removed) {
        res.status(404).json({ error: 'phone not in blocklist', reason: 'phone_not_in_blocklist' });
        return;
    }
    res.json({ ok: true });
});
exports.whatsappRoutes = router;
//# sourceMappingURL=whatsapp.js.map