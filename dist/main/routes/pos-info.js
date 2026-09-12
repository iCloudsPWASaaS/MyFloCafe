"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.posInfoRoutes = void 0;
/**
 * GET /api/pos-info
 * Returns the POS access URLs (mDNS + local IP) so the app can render a QR code.
 * A second cashier scans this from Settings → POS Workflow to open the same
 * POS on another device on the local network.
 */
const express_1 = require("express");
const qrcode_1 = __importDefault(require("qrcode"));
const server_1 = require("../server");
const async_handler_1 = require("../middleware/async-handler");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(async (_req, res) => {
    const port = (0, server_1.getServerPort)();
    const ip = (0, server_1.getLocalIP)();
    const allIps = (0, server_1.getAllLocalIPs)();
    const mdnsUrl = `http://flo.local:${port}`;
    const ipUrl = `http://${ip}:${port}`;
    const qrUrl = ipUrl;
    const ipsData = await Promise.all(allIps.map(async (localIp) => {
        const url = `http://${localIp}:${port}`;
        try {
            const qr_data = await qrcode_1.default.toDataURL(url, { errorCorrectionLevel: 'M', width: 256 });
            return { ip: localIp, url, qr_data };
        }
        catch {
            return { ip: localIp, url, qr_data: null };
        }
    }));
    let qrDataUrl = null;
    try {
        qrDataUrl = await qrcode_1.default.toDataURL(qrUrl, { errorCorrectionLevel: 'M', width: 256 });
    }
    catch (err) {
        console.warn('[POS-Info] QR generation failed:', err);
    }
    res.json({
        mdns_url: mdnsUrl,
        ip_url: ipUrl,
        qr_url: qrUrl,
        qr_data_url: qrDataUrl,
        ips_data: ipsData,
    });
}));
exports.posInfoRoutes = router;
//# sourceMappingURL=pos-info.js.map