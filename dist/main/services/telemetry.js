"use strict";
/**
 * Anonymous usage telemetry — independent of cloud sync (sends whether or
 * not this store has cloud sync configured, since it's a separate concern).
 * Enabled by default for new installs. The owner can switch it off at any
 * time in Settings > Privacy. Tier 2 store diagnostics is a separate,
 * explicit opt-in and is never bundled into this stream.
 *
 * anon_id is a random UUID persisted locally (see db.ensureTelemetryAnonId),
 * never a store id, device id, or anything else that ties back to a business.
 * See specs/floadmin.md § Anonymous telemetry for the endpoint contract.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.telemetry = exports.TELEMETRY_URL = void 0;
exports.sendEvent = sendEvent;
const electron_1 = require("electron");
const country_provenance_1 = require("./country-provenance");
const electron_log_1 = __importDefault(require("electron-log"));
const db_1 = require("../db");
exports.TELEMETRY_URL = 'https://telemetry.flopos.com/collect';
const REQUEST_TIMEOUT_MS = 8_000;
const DAILY_PING_INTERVAL_MS = 60 * 60_000; // check hourly, send at most once/24h
const DAILY_PING_MIN_GAP_MS = 24 * 60 * 60_000;
let dailyPingTimer = null;
let telemetryStopping = false;
let telemetryStopPromise = null;
const inFlightTelemetry = new Set();
function matrixOffline() {
    return process.env.FLO_MATRIX_OFFLINE === '1';
}
function trackTelemetry(operation) {
    inFlightTelemetry.add(operation);
    void operation.finally(() => inFlightTelemetry.delete(operation)).catch(() => { });
    return operation;
}
async function sendEventImpl(eventType, payload) {
    if (matrixOffline() || !(0, db_1.isTelemetryEnabled)())
        return false;
    try {
        const anonId = (0, db_1.ensureTelemetryAnonId)();
        // Only a confirmed country is reported. settings.country is seeded to 'IN'
        // at install, so sending it unconditionally filed every install that had
        // not finished setup under India — and because the field was always
        // present, FloAdmin's IP-geolocation fallback for a missing country never
        // once fired. Omitting it is what lets that fallback do its job.
        const provenance = (0, country_provenance_1.readCountryProvenance)();
        const country = provenance.country ?? undefined;
        const response = await fetch(exports.TELEMETRY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                anon_id: anonId,
                app: 'flocafe',
                app_version: electron_1.app.getVersion(),
                event_type: eventType,
                platform: process.platform,
                ...(country ? { country } : {}),
                ...(payload ? { payload } : {}),
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const ok = response.ok;
        if (!ok) {
            electron_log_1.default.debug(`[Flo] telemetry rejected with HTTP ${response.status}`);
        }
        await response.body?.cancel().catch(() => { });
        return ok;
    }
    catch (e) {
        // Telemetry must never disrupt the app or surface to the user.
        electron_log_1.default.debug('[Flo] telemetry send failed (non-fatal):', e);
        return false;
    }
}
function sendEvent(eventType, payload) {
    if (matrixOffline() || telemetryStopping)
        return Promise.resolve(false);
    return trackTelemetry(sendEventImpl(eventType, payload));
}
function maybeSendDailyPing() {
    if (matrixOffline() || telemetryStopping)
        return;
    if (!(0, db_1.isTelemetryEnabled)())
        return;
    const lastPingAt = (0, db_1.getSettingValue)('telemetry_last_ping_at');
    const lastPingMs = lastPingAt ? (0, db_1.parseDbTimestamp)(lastPingAt).getTime() : NaN;
    const elapsed = isNaN(lastPingMs) ? Infinity : Date.now() - lastPingMs;
    if (elapsed < DAILY_PING_MIN_GAP_MS)
        return;
    const operation = sendEvent('daily_ping').then((sent) => {
        if (sent)
            (0, db_1.upsertTelemetryLastPing)();
    });
    trackTelemetry(operation);
}
exports.telemetry = {
    start() {
        telemetryStopping = false;
        telemetryStopPromise = null;
        if (dailyPingTimer) {
            clearInterval(dailyPingTimer);
            dailyPingTimer = null;
        }
        if (matrixOffline())
            return;
        void sendEvent('app_launch');
        maybeSendDailyPing();
        dailyPingTimer = setInterval(maybeSendDailyPing, DAILY_PING_INTERVAL_MS);
    },
    stop() {
        if (telemetryStopPromise)
            return telemetryStopPromise;
        telemetryStopping = true;
        if (dailyPingTimer) {
            clearInterval(dailyPingTimer);
            dailyPingTimer = null;
        }
        telemetryStopPromise = Promise.allSettled([...inFlightTelemetry]).then(() => undefined);
        return telemetryStopPromise;
    },
};
//# sourceMappingURL=telemetry.js.map