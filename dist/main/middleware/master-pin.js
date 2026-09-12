"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireMasterPin = requireMasterPin;
const master_pin_1 = require("../services/master-pin");
/**
 * Must be used after requireAuth + requireRole('owner'). Expects `master_pin`
 * in the request body. Rate-limit key is scoped per-route (not just per-IP) —
 * matching the existing PIN rate-limit convention in routes/orders.ts — so a
 * lockout on one gated action (e.g. backup) doesn't also lock out unrelated
 * ones (e.g. initialize) sharing the same IP.
 */
function requireMasterPin(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const routeKey = req.baseUrl + req.path;
    const result = (0, master_pin_1.authorizeMasterPin)(req.body?.master_pin, `http:${ip}:${routeKey}`);
    if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
    }
    next();
}
//# sourceMappingURL=master-pin.js.map