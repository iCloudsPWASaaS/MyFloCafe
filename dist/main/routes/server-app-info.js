"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.serverAppInfoRoutes = void 0;
/**
 * GET /api/server-app-info
 * Returns Server App access URLs so Settings can render QR codes for tablets
 * and phones on the same local network.
 */
const express_1 = require("express");
const qrcode_1 = __importDefault(require("qrcode"));
const server_1 = require("../server");
const server_app_state_1 = require("../server-app-state");
const db_1 = require("../db");
const async_handler_1 = require("../middleware/async-handler");
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(async (_req, res) => {
    if (!(0, db_1.isServerAppEnabled)()) {
        return res.status(404).json({ error: 'Not found' });
    }
    try {
        const port = (0, server_app_state_1.getServerAppPort)();
        const ip = (0, server_1.getLocalIP)();
        const allIps = (0, server_1.getAllLocalIPs)();
        const mdnsUrl = `http://flo.local:${port}`;
        const ipUrl = `http://${ip}:${port}`;
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
        const primaryIpData = ipsData.find((entry) => entry.ip === ip);
        res.json({
            mdns_url: mdnsUrl,
            ip_url: ipUrl,
            qr_url: ipUrl,
            qr_data_url: primaryIpData?.qr_data ?? null,
            ips_data: ipsData,
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
exports.serverAppInfoRoutes = router;
//# sourceMappingURL=server-app-info.js.map