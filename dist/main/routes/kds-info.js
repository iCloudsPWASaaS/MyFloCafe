"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.kdsInfoRoutes = void 0;
/**
 * GET /api/kds-info
 * Returns the KDS access URLs (mDNS + local IP) so the POS UI can render a QR code.
 * The tablet/display on the same network opens either URL in a browser.
 */
const express_1 = require("express");
const qrcode_1 = __importDefault(require("qrcode"));
const server_1 = require("../server");
const kds_server_1 = require("../kds-server");
const security_1 = require("../middleware/security");
const async_handler_1 = require("../middleware/async-handler");
const router = (0, express_1.Router)();
router.use(security_1.requireKdsEnabled);
router.get('/', (0, async_handler_1.asyncHandler)(async (_req, res) => {
    try {
        const kdsPort = (0, kds_server_1.getKdsPort)();
        const ip = (0, server_1.getLocalIP)();
        const allIps = (0, server_1.getAllLocalIPs)();
        const mdnsUrl = `http://flo.local:${kdsPort}`;
        const ipUrl = `http://${ip}:${kdsPort}`;
        const qrUrl = ipUrl;
        const ipsData = await Promise.all(allIps.map(async (localIp) => {
            const url = `http://${localIp}:${kdsPort}`;
            try {
                const qr_data = await qrcode_1.default.toDataURL(url, { errorCorrectionLevel: 'M', width: 256 });
                return { ip: localIp, url, qr_data };
            }
            catch {
                return { ip: localIp, url, qr_data: null };
            }
        }));
        const primaryIpData = ipsData.find((entry) => entry.ip === ip);
        const qrDataUrl = primaryIpData?.qr_data ?? null;
        res.json({
            mdns_url: mdnsUrl,
            ip_url: ipUrl,
            qr_url: qrUrl,
            qr_data_url: qrDataUrl,
            ips_data: ipsData,
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
exports.kdsInfoRoutes = router;
//# sourceMappingURL=kds-info.js.map