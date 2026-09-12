"use strict";
/**
 * Merchant print template CRUD API (#447, epic #438).
 *
 * Owner-role lifecycle management for tenant-owned semantic receipt
 * templates: create draft -> activate -> archive, with single-step rollback.
 * Payloads are validated fail-closed by the shared kernel validator on every
 * write. #448 adds validated offline transfer: GET /:id/export downloads a
 * self-describing `.json` envelope; POST /import runs the same fail-closed
 * pipeline on an uploaded envelope and lands it as a NEW draft. This API
 * deliberately does NOT expose a visual editor.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.printTemplateRoutes = void 0;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const merchant_print_templates_1 = require("../services/merchant-print-templates");
const router = (0, express_1.Router)();
const merchantTemplateWriteRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
});
function actorId(req) {
    const user = req.user;
    return String(user?.userId || '') || null;
}
/** Public row shape: provenance stays informational, payloads stay internal. */
function shape(row) {
    return {
        id: row.id,
        name: row.name,
        origin: row.origin,
        derivedFrom: row.derived_from ? JSON.parse(row.derived_from) : null,
        documentType: row.document_type,
        schemaVersion: row.schema_version,
        status: row.status,
        hasPreviousPayload: Boolean(row.previous_payload_json),
        checksum: row.checksum,
        createdBy: row.created_by,
        updatedBy: row.updated_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function handleError(res, error) {
    if (error instanceof merchant_print_templates_1.MerchantTemplateError) {
        res.status(error.statusCode).json({
            error: error.message,
            ...(error.details ? { details: error.details } : {}),
        });
        return;
    }
    console.error('[Print Templates] Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
}
router.get('/', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (_req, res) => {
    try {
        res.json({ templates: (0, merchant_print_templates_1.listMerchantPrintTemplates)().map(shape) });
    }
    catch (error) {
        handleError(res, error);
    }
});
router.post('/', merchantTemplateWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    try {
        const row = (0, merchant_print_templates_1.createMerchantPrintTemplate)({
            name: req.body?.name,
            payload: req.body?.payload,
            origin: req.body?.origin,
            derivedFrom: req.body?.derivedFrom,
        }, actorId(req));
        res.status(201).json({ template: shape(row) });
    }
    catch (error) {
        handleError(res, error);
    }
});
router.put('/:id', merchantTemplateWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    try {
        const row = (0, merchant_print_templates_1.updateMerchantPrintTemplate)(String(req.params.id), {
            name: req.body?.name,
            payload: req.body?.payload,
        }, actorId(req));
        res.json({ template: shape(row) });
    }
    catch (error) {
        handleError(res, error);
    }
});
router.post('/:id/activate', merchantTemplateWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    try {
        const row = (0, merchant_print_templates_1.activateMerchantPrintTemplate)(String(req.params.id), actorId(req));
        res.json({ template: shape(row) });
    }
    catch (error) {
        handleError(res, error);
    }
});
router.post('/:id/archive', merchantTemplateWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    try {
        const row = (0, merchant_print_templates_1.archiveMerchantPrintTemplate)(String(req.params.id), actorId(req));
        res.json({ template: shape(row) });
    }
    catch (error) {
        handleError(res, error);
    }
});
router.post('/:id/rollback', merchantTemplateWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    try {
        const row = (0, merchant_print_templates_1.rollbackMerchantPrintTemplate)(String(req.params.id), actorId(req));
        res.json({ template: shape(row) });
    }
    catch (error) {
        handleError(res, error);
    }
});
router.get('/:id/payload', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const row = (0, merchant_print_templates_1.loadMerchantPrintTemplateRow)(String(req.params.id));
        if (!row)
            return res.status(404).json({ error: 'Template not found' });
        res.json({ id: row.id, schemaVersion: row.schema_version, checksum: row.checksum, payload: JSON.parse(row.payload_json) });
    }
    catch (error) {
        handleError(res, error);
    }
});
// --- Offline transfer (#448) ----------------------------------------------
/** Download the portable transfer envelope for one template (owner only). */
router.get('/:id/export', merchantTemplateWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    try {
        const file = (0, merchant_print_templates_1.exportMerchantPrintTemplateFile)(String(req.params.id));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
        res.send(file.json);
    }
    catch (error) {
        handleError(res, error);
    }
});
/**
 * Import a transfer file as a NEW draft (owner only). The body carries the
 * raw envelope text in `file` (plus optional `name` override and the client
 * `fileName` for provenance); every byte is treated as untrusted input and
 * pushed through the full fail-closed validation pipeline in the service.
 */
router.post('/import', merchantTemplateWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (req, res) => {
    try {
        const row = (0, merchant_print_templates_1.importMerchantPrintTemplateFile)({
            file: req.body?.file,
            name: req.body?.name,
            fileName: req.body?.fileName,
        }, actorId(req));
        res.status(201).json({ template: shape(row) });
    }
    catch (error) {
        handleError(res, error);
    }
});
exports.printTemplateRoutes = router;
//# sourceMappingURL=print-templates.js.map