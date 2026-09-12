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
exports.getStatus = getStatus;
exports.enable = enable;
exports.disable = disable;
exports.connectWithQr = connectWithQr;
exports.connectWithPairingCode = connectWithPairingCode;
exports.disconnect = disconnect;
exports.sendMessage = sendMessage;
exports.listInbox = listInbox;
exports.listMessages = listMessages;
exports.listBlocklist = listBlocklist;
exports.addToBlocklist = addToBlocklist;
exports.removeFromBlocklist = removeFromBlocklist;
exports.initFromDb = initFromDb;
exports.shutdown = shutdown;
exports.requestShutdown = requestShutdown;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const libphonenumber_js_1 = require("libphonenumber-js");
const db_1 = require("../db");
const shutdown_1 = require("../shutdown");
const { loadBaileys: loadBaileysModule } = require('../baileys-loader.cjs');
// Baileys is ESM-only; CommonJS `require()` blows up with ERR_REQUIRE_ESM.
// Lazy-load via dynamic import() and cache the module reference for the
// lifetime of the process.
let baileysModule = null;
async function loadBaileys() {
    if (!baileysModule) {
        baileysModule = await loadBaileysModule();
    }
    return baileysModule;
}
function makeBaileysLogger() {
    const noop = () => { };
    const fallback = { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child: () => fallback };
    try {
        const pinoFactory = require('pino').pino ?? require('pino');
        return pinoFactory({ level: 'silent' });
    }
    catch (err) {
        console.error('[WhatsApp] pino failed to load (packaging/ASAR issue?) — WhatsApp logging disabled, everything else unaffected:', err.message);
        return fallback;
    }
}
const AUTH_DIR_NAME = 'whatsapp-auth';
const RATE_LIMIT_MAX_PER_HOUR = 4;
const RATE_LIMIT_MIN_GAP_MS = 30 * 1000;
const BODY_REPEAT_WINDOW_MS = 10 * 60 * 1000;
const RECENT_BODIES_PER_PHONE_MAX = 10;
const SENT_MESSAGE_CACHE_MAX = 256;
const TYPING_MIN_MS = 800;
const TYPING_MAX_PER_100_CHARS_MS = 4000;
const RECONNECT_DELAY_MS = 5_000;
const VERSION_FETCH_TIMEOUT_MS = 5_000;
const RATE_LIMITED_STATUS_CODES = new Set([429]);
// Baileys is extremely chatty at debug. Silence it so the Electron log
// doesn't drown out the real signal from our service.
const baileysLogger = makeBaileysLogger();
const SHORTENER_HOSTS = new Set([
    'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd',
    'buff.ly', 'shorturl.at', 'rb.gy', 'cutt.ly', 'rebrand.ly',
]);
const state = {
    enabled: false,
    shuttingDown: false,
    socket: null,
    state: 'disconnected',
    lastQr: null,
    lastPairingCode: null,
    connectedPhone: null,
    lastError: null,
    lastErrorReason: null,
    cooldownUntil: null,
    cooldownTimer: null,
    reconnectTimer: null,
    lastSendByPhone: new Map(),
    recentBodies: new Map(),
    sentMessageCache: new Map(),
    lidToPhoneMap: new Map(),
};
const inFlightWhatsAppWork = new Map();
let whatsappShutdownPromise = null;
let whatsappAbortController = new AbortController();
let shutdownSocket = null;
let whatsappTerminalCleanup = false;
let whatsappShutdownRequested = false;
function isWhatsAppTerminal() {
    return state.shuttingDown || whatsappTerminalCleanup;
}
function createWhatsAppAbortError() {
    const error = new Error('WhatsApp work cancelled during shutdown');
    error.code = 'ERR_SHUTDOWN_ABORTED';
    return error;
}
function cancelWhatsAppSocket() {
    if (!isWhatsAppTerminal())
        return;
    const socket = state.socket ?? shutdownSocket;
    if (!socket)
        return;
    try {
        socket.end(undefined);
    }
    catch { }
}
function abortable(operationFactory, signal, cancel = cancelWhatsAppSocket) {
    if (signal.aborted)
        return Promise.reject(createWhatsAppAbortError());
    let operation;
    try {
        operation = operationFactory();
    }
    catch (error) {
        return Promise.reject(error);
    }
    trackWhatsAppWork(operation, cancel);
    return new Promise((resolve, reject) => {
        let settled = false;
        let aborted = false;
        let joinTimeout;
        let onAbort = () => { };
        const cleanup = () => {
            signal.removeEventListener('abort', onAbort);
            if (joinTimeout)
                clearTimeout(joinTimeout);
        };
        onAbort = () => {
            if (settled || aborted)
                return;
            aborted = true;
            cancel();
            const settleCancellation = () => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                reject(createWhatsAppAbortError());
            };
            if (!isWhatsAppTerminal()) {
                settleCancellation();
                return;
            }
            joinTimeout = setTimeout(settleCancellation, shutdown_1.SHUTDOWN_TIMEOUT_MS);
            void operation.then(settleCancellation, settleCancellation);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        operation.then((value) => {
            if (settled || aborted)
                return;
            settled = true;
            cleanup();
            resolve(value);
        }, (error) => {
            if (settled || aborted)
                return;
            settled = true;
            cleanup();
            reject(error);
        });
        if (signal.aborted)
            onAbort();
    });
}
function abortableDelay(milliseconds, signal) {
    if (signal.aborted)
        return Promise.reject(createWhatsAppAbortError());
    return new Promise((resolve, reject) => {
        let onAbort = () => { };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        onAbort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            reject(createWhatsAppAbortError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted)
            onAbort();
    });
}
function trackWhatsAppWork(operation, cancel = cancelWhatsAppSocket) {
    inFlightWhatsAppWork.set(operation, cancel);
    void operation.finally(() => {
        inFlightWhatsAppWork.delete(operation);
        if (isWhatsAppTerminal() && inFlightWhatsAppWork.size === 0) {
            if (state.socket === shutdownSocket)
                state.socket = null;
            shutdownSocket = null;
        }
    }).catch(() => { });
    return operation;
}
function cancelInFlightWhatsAppWork() {
    for (const cancel of inFlightWhatsAppWork.values()) {
        try {
            cancel();
        }
        catch { }
    }
}
async function waitForWhatsAppWork() {
    const drain = (async () => {
        while (inFlightWhatsAppWork.size > 0) {
            await Promise.allSettled([...inFlightWhatsAppWork]);
        }
    })();
    void drain.catch(() => { });
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            whatsappTerminalCleanup = true;
            cancelInFlightWhatsAppWork();
            const timeoutError = new Error(`WhatsApp shutdown timed out after ${shutdown_1.SHUTDOWN_TIMEOUT_MS}ms`);
            timeoutError.code = 'ERR_SHUTDOWN_TIMEOUT';
            reject(timeoutError);
        }, shutdown_1.SHUTDOWN_TIMEOUT_MS);
        drain.then(() => {
            clearTimeout(timeout);
            resolve();
        }, (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}
function getAuthDir() {
    return path.join(electron_1.app.getPath('userData'), AUTH_DIR_NAME);
}
function writeSetting(key, value) {
    (0, db_1.getDatabase)().prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, (0, db_1.now)());
}
function getStatus() {
    return {
        enabled: state.enabled,
        state: state.state,
        connectedPhone: state.connectedPhone,
        lastError: state.lastError,
        lastErrorReason: state.lastErrorReason,
        cooldownUntil: state.cooldownUntil ?? null,
        qr: state.lastQr ?? undefined,
        pairingCode: state.lastPairingCode ?? undefined,
    };
}
/**
 * Resolve a user-supplied phone number to the JID WhatsApp actually uses for
 * it. Two-stage validation: libphonenumber-js normalizes the format (no
 * country-specific code — handles AR `9`, BR `0`, MX `1`, etc. via Google's
 * metadata), then socket.onWhatsApp() asks WhatsApp's own registry and
 * returns the canonical JID (which may be a LID or a different form than
 * the naive phone-JID). Only WhatsApp's server knows whether the number is
 * registered and which JID format it accepts.
 *
 * Returns null when the number is either unparseable or not on WhatsApp —
 * caller maps both to the `not_on_whatsapp` SendResult reason. Falls back
 * to the naive phone-JID if onWhatsApp throws (network blip); better to
 * attempt the send than block the cashier behind a transient error.
 */
async function resolveJid(phoneE164, sock, signal) {
    let normalized;
    try {
        const pn = (0, libphonenumber_js_1.parsePhoneNumber)(phoneE164);
        if (!pn?.isValid())
            return null;
        normalized = pn.number;
    }
    catch {
        return null;
    }
    const naive = `${normalized.replace('+', '')}@s.whatsapp.net`;
    try {
        const results = (await abortable(() => sock.onWhatsApp(naive), signal)) ?? [];
        return results[0]?.exists ? results[0].jid : null;
    }
    catch {
        return naive;
    }
}
/** Strip the device id and domain from a Baileys JID, leaving just the user. */
function userFromJid(jid) {
    return jid.split('@')[0].split(':')[0];
}
/**
 * Resolve a Baileys JID (which may carry `@lid` instead of `@s.whatsapp.net`
 * under WhatsApp's new Local ID system) back to a phone JID. Tries in order:
 *   1. local cache (populated by inbound messages + lid-mapping.update events)
 *   2. the alt JID Baileys v7 attaches to every message
 *   3. signalRepository.lidMapping.getPNForLID (whatsapp's own resolver)
 * Falls back to the original JID if nothing resolves — better to record an
 * LID than to drop the message.
 */
async function translateJid(jid, altJid, sock, signal) {
    if (!jid.endsWith('@lid'))
        return jid;
    const lidUser = userFromJid(jid);
    const cached = state.lidToPhoneMap.get(lidUser);
    if (cached)
        return cached;
    if (altJid && !altJid.endsWith('@lid')) {
        const phoneJid = altJid.includes('@') ? altJid : `${altJid}@s.whatsapp.net`;
        state.lidToPhoneMap.set(lidUser, phoneJid);
        return phoneJid;
    }
    try {
        const pn = await abortable(() => sock.signalRepository.lidMapping.getPNForLID(jid), signal);
        if (pn) {
            const phoneJid = `${userFromJid(pn)}@s.whatsapp.net`;
            state.lidToPhoneMap.set(lidUser, phoneJid);
            return phoneJid;
        }
    }
    catch {
        // best-effort
    }
    return jid;
}
function randomDelayMs(body) {
    const perHundred = Math.ceil(body.length / 100);
    const lower = TYPING_MIN_MS * perHundred;
    const upper = TYPING_MAX_PER_100_CHARS_MS * perHundred;
    return lower + Math.floor(Math.random() * (upper - lower));
}
function hasShortenerOrNonHttps(body) {
    const urlRe = /\bhttps?:\/\/[^\s)]+/gi;
    const matches = body.match(urlRe);
    if (!matches)
        return null;
    for (const raw of matches) {
        if (!raw.toLowerCase().startsWith('https://')) {
            return `Refusing non-HTTPS link: ${raw.slice(0, 80)}`;
        }
        try {
            const host = new URL(raw).hostname.toLowerCase();
            if (SHORTENER_HOSTS.has(host)) {
                return `Refusing URL shortener link: ${host}`;
            }
        }
        catch {
            return `Refusing unparseable URL: ${raw.slice(0, 80)}`;
        }
    }
    return null;
}
function isDuplicateBody(phoneE164, body) {
    const cutoff = Date.now() - BODY_REPEAT_WINDOW_MS;
    const recent = state.recentBodies.get(phoneE164) ?? [];
    const fresh = recent.filter((r) => r.at >= cutoff);
    for (const r of fresh) {
        if (r.body === body) {
            state.recentBodies.set(phoneE164, fresh);
            return true;
        }
    }
    fresh.push({ body, at: Date.now() });
    // Bound the per-phone history to avoid unbounded growth in long-running installs.
    if (fresh.length > RECENT_BODIES_PER_PHONE_MAX)
        fresh.splice(0, fresh.length - RECENT_BODIES_PER_PHONE_MAX);
    state.recentBodies.set(phoneE164, fresh);
    return false;
}
function isBlocked(phoneE164) {
    const row = (0, db_1.getDatabase)()
        .prepare('SELECT 1 FROM whatsapp_blocklist WHERE phone_e164 = ?')
        .get(phoneE164);
    return !!row;
}
function isOverRateLimit(phoneE164) {
    const last = state.lastSendByPhone.get(phoneE164);
    if (last) {
        const gap = Date.now() - last;
        if (gap < RATE_LIMIT_MIN_GAP_MS) {
            return { limited: true, retryAfterMs: RATE_LIMIT_MIN_GAP_MS - gap };
        }
    }
    const db = (0, db_1.getDatabase)();
    // Space form, same as now()/queued_at — an ISO-Z bound would sort above
    // every space-form row of the same day and the rate limit would never fire.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ').replace(/\..*$/, '');
    const row = db.prepare(`
    SELECT COUNT(*) AS c FROM whatsapp_messages
    WHERE phone_e164 = ? AND direction = 'outbound' AND queued_at >= ?
  `).get(phoneE164, oneHourAgo);
    if (row.c >= RATE_LIMIT_MAX_PER_HOUR) {
        return { limited: true };
    }
    return { limited: false };
}
function isInCooldown() {
    if (!state.cooldownUntil)
        return false;
    return new Date(state.cooldownUntil).getTime() > Date.now();
}
function triggerCooldown(reason, durationMs = 5 * 60 * 1000, reasonCode = 'cooldown') {
    const until = new Date(Date.now() + durationMs).toISOString();
    state.cooldownUntil = until;
    state.lastError = reason;
    state.lastErrorReason = reasonCode;
    if (state.cooldownTimer)
        clearTimeout(state.cooldownTimer);
    state.cooldownTimer = setTimeout(() => {
        state.cooldownUntil = null;
    }, durationMs);
}
function recordMessageRow(row) {
    const db = (0, db_1.getDatabase)();
    const tsField = row.timestamp_field;
    const baseTs = (0, db_1.now)();
    const result = db.prepare(`
    INSERT INTO whatsapp_messages (
      bill_id, customer_id, phone_e164, direction, kind, status,
      body, external_message_id, error, queued_at,
      seen_at, typing_at, sent_at, delivered_at, read_at, failed_at,
      created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.bill_id ?? null, row.customer_id ?? null, row.phone_e164, row.direction, row.kind, row.status, row.body, row.external_message_id ?? row.external_id ?? null, row.error ?? null, baseTs, tsField === 'seen_at' ? baseTs : null, tsField === 'typing_at' ? baseTs : null, tsField === 'sent_at' ? baseTs : null, tsField === 'delivered_at' ? baseTs : null, tsField === 'read_at' ? baseTs : null, tsField === 'failed_at' ? baseTs : null, row.created_by_user_id ?? null);
    return Number(result.lastInsertRowid);
}
const ALLOWED_TIMESTAMP_FIELDS = new Set(['seen_at', 'typing_at', 'sent_at', 'delivered_at', 'read_at', 'failed_at']);
function updateMessageRow(id, patch) {
    const db = (0, db_1.getDatabase)();
    const fields = [];
    const values = [];
    if (patch.status !== undefined) {
        fields.push('status = ?');
        values.push(patch.status);
    }
    if (patch.external_message_id !== undefined) {
        fields.push('external_message_id = ?');
        values.push(patch.external_message_id);
    }
    if (patch.error !== undefined) {
        fields.push('error = ?');
        values.push(patch.error);
    }
    if (patch.timestamp_field && ALLOWED_TIMESTAMP_FIELDS.has(patch.timestamp_field)) {
        fields.push(`${patch.timestamp_field} = ?`);
        values.push((0, db_1.now)());
    }
    if (fields.length === 0)
        return;
    values.push(id);
    db.prepare(`UPDATE whatsapp_messages SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}
/**
 * Advance a message's status and backfill any earlier-stage timestamps that
 * haven't fired yet (Baileys sometimes jumps straight to status=3 or 4
 * without an intermediate update). Without the COALESCE guard, a row ends up
 * with status='read' but only read_at populated — the stepper shows the row
 * at the end of the pipeline while the timeline shows a single
 * timestamp, which is what the operator sees as "the status didn't reach
 * the end".
 */
function advanceStatus(id, latest) {
    const ts = (0, db_1.now)();
    const stamps = new Set([latest]);
    if (latest === 'read') {
        stamps.add('delivered');
        stamps.add('sent');
    }
    else if (latest === 'delivered') {
        stamps.add('sent');
    }
    const exprs = Array.from(stamps, (s) => `${s}_at = COALESCE(${s}_at, ?)`).join(', ');
    const placeholders = Array(stamps.size).fill(ts);
    (0, db_1.getDatabase)()
        .prepare(`UPDATE whatsapp_messages SET status = ?, ${exprs} WHERE id = ?`)
        .run(latest, ...placeholders, id);
}
function findMessageByExternalId(externalId) {
    const row = (0, db_1.getDatabase)()
        .prepare('SELECT id, phone_e164 FROM whatsapp_messages WHERE external_message_id = ?')
        .get(externalId);
    return row ?? null;
}
async function persistIncoming(msg, sock) {
    if (!msg?.message)
        return;
    const signal = whatsappAbortController.signal;
    const rawJid = msg.key?.remoteJid ?? '';
    if (!rawJid || rawJid === 'status@broadcast')
        return;
    // Resolve LID → phone JID. Group chats intentionally keep their @g.us JID
    // (not translated) because the group sender-key distribution depends on it,
    // but DMs/contacts come in carrying @lid from WhatsApp's new ID system.
    const resolvedJid = rawJid.endsWith('@g.us')
        ? rawJid
        : await translateJid(rawJid, msg.key?.remoteJidAlt, sock, signal);
    if (isWhatsAppTerminal())
        return;
    const phone = '+' + userFromJid(resolvedJid);
    const body = msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        msg.message?.imageMessage?.caption ??
        msg.message?.videoMessage?.caption ??
        '';
    if (!body)
        return;
    recordMessageRow({
        phone_e164: phone,
        direction: 'inbound',
        kind: 'manual_reply',
        status: 'delivered',
        body,
        external_message_id: msg.key?.id ?? null,
        created_by_user_id: null,
    });
}
function attachSocketHandlers(socket) {
    socket.ev.on('connection.update', (update) => {
        void trackWhatsAppWork((async () => {
            if (isWhatsAppTerminal())
                return;
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                state.lastQr = qr;
                state.lastPairingCode = null;
                state.state = 'waiting_qr';
            }
            if (connection === 'open') {
                state.state = 'connected';
                state.lastQr = null;
                state.lastPairingCode = null;
                state.lastError = null;
                state.lastErrorReason = null;
                const user = socket.user;
                if (user?.id) {
                    const phone = '+' + userFromJid(user.id);
                    state.connectedPhone = phone;
                    writeSetting('whatsapp_connected_phone', phone);
                }
            }
            else if (connection === 'close') {
                const status = lastDisconnect?.error?.output?.statusCode;
                state.socket = null;
                state.lastQr = null;
                state.lastPairingCode = null;
                // Baileys's DisconnectReason.loggedOut == 401. Hardcoded here so we
                // don't have to load Baileys synchronously just to compare a number.
                if (status === 401) {
                    // Server-side logout — stale creds will 401 again. Wipe and force
                    // a fresh QR pairing on next start.
                    state.state = 'disconnected';
                    state.connectedPhone = null;
                    writeSetting('whatsapp_connected_phone', '');
                    state.lastError = 'Logged out. Reconnect to continue.';
                    state.lastErrorReason = 'logged_out';
                    wipeAuthDir();
                }
                else if (!isWhatsAppTerminal() && state.enabled) {
                    // Auto-reconnect on any transient failure (network blip, server
                    // restart, etc). Don't penalize the operator for an infrastructure
                    // blip — the cooldown only applies to explicit 429s on sends.
                    state.state = 'connecting';
                    state.lastError = `Connection closed (${status ?? 'unknown'}), reconnecting in ${RECONNECT_DELAY_MS / 1000}s…`;
                    state.lastErrorReason = 'reconnecting';
                    if (state.reconnectTimer)
                        clearTimeout(state.reconnectTimer);
                    state.reconnectTimer = setTimeout(() => {
                        state.reconnectTimer = null;
                        if (state.enabled && !isWhatsAppTerminal()) {
                            void startSocket().catch((err) => {
                                console.warn('[WhatsApp] Reconnect failed:', err?.message ?? err);
                            });
                        }
                    }, RECONNECT_DELAY_MS);
                }
                else {
                    state.state = 'disconnected';
                }
            }
        })()).catch(() => { });
    });
    socket.ev.on('creds.update', () => { });
    // Keep the LID→phone cache fresh. WhatsApp rotates these over time.
    socket.ev.on('lid-mapping.update', (update) => {
        if (isWhatsAppTerminal())
            return;
        const lid = update?.lid;
        const pn = update?.pn;
        if (!lid || !pn)
            return;
        const lidUser = userFromJid(lid);
        const phoneJid = pn.includes('@') ? pn : `${pn}@s.whatsapp.net`;
        state.lidToPhoneMap.set(lidUser, phoneJid);
    });
    socket.ev.on('messages.upsert', ({ messages }) => {
        void trackWhatsAppWork((async () => {
            if (isWhatsAppTerminal())
                return;
            const filterGroups = (0, db_1.getSettingValue)('whatsapp_filter_groups') === 'true';
            for (const msg of messages) {
                if (isWhatsAppTerminal())
                    return;
                if (msg.key?.fromMe)
                    continue;
                // No one asks Flo to deliver a paid bill into a group chat. When the
                // operator enables the group filter, drop inbound @g.us messages
                // before we persist them — the inbox stays clean and we never
                // process (translateJid / store) what we don't intend to handle.
                if (filterGroups && msg.key?.remoteJid?.endsWith('@g.us'))
                    continue;
                await persistIncoming(msg, socket);
            }
        })()).catch(() => { });
    });
    socket.ev.on('messages.update', (updates) => {
        void trackWhatsAppWork((async () => {
            if (isWhatsAppTerminal())
                return;
            for (const u of updates) {
                if (isWhatsAppTerminal())
                    return;
                const id = u.key?.id;
                if (!id)
                    continue;
                const stored = findMessageByExternalId(id);
                if (!stored)
                    continue;
                const status = u.update?.status;
                if (status === undefined)
                    continue;
                // Baileys WAProto: PENDING=1, SERVER_ACK=2, DELIVERED=3, READ=4, PLAYED=5.
                // SERVER_ACK is the first server-side confirmation that WhatsApp
                // accepted the payload — that's the truthful 'sent' mark. Earlier
                // versions mapped 1→sent which silently promoted rows to 'delivered'
                // on the real confirmation and never marked anything 'sent' at all.
                if (status === 2)
                    advanceStatus(stored.id, 'sent');
                else if (status === 3)
                    advanceStatus(stored.id, 'delivered');
                else if (status === 4)
                    advanceStatus(stored.id, 'read');
            }
        })()).catch(() => { });
    });
}
async function resolveWaWebVersion(signal) {
    // Baileys' built-in fetchLatestWaWebVersion scrapes sw.js which is
    // aggressively rate-limited (429). When it fails, Baileys falls back to
    // a hardcoded version that goes stale within weeks — WhatsApp rejects
    // connections with an expired buildHash (405 at Noise layer). Try the
    // wppconnect version tracker first (more reliable, but HTML scrape — no
    // JSON API), then Baileys as a fallback.
    try {
        const res = await fetch('https://wppconnect.io/whatsapp-versions/', {
            signal: AbortSignal.any([signal, AbortSignal.timeout(VERSION_FETCH_TIMEOUT_MS)]),
        });
        if (res.ok) {
            const html = await res.text();
            const match = html.match(/2\.3000\.(\d+)/);
            if (match)
                return [2, 3000, Number(match[1])];
        }
    }
    catch {
        // fall through
    }
    try {
        const { fetchLatestWaWebVersion } = await abortable(() => loadBaileys(), signal);
        const { version } = await abortable(() => fetchLatestWaWebVersion({}), signal);
        return version;
    }
    catch {
        // fall through
    }
    // Let Baileys use its hardcoded fallback. Better than refusing to start.
    return undefined;
}
async function startSocketImpl(requestSignal) {
    const signal = requestSignal
        ? AbortSignal.any([requestSignal, whatsappAbortController.signal])
        : whatsappAbortController.signal;
    if (!state.enabled || isWhatsAppTerminal() || signal.aborted)
        return;
    if (state.socket)
        return;
    const authDir = getAuthDir();
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
    }
    const version = await resolveWaWebVersion(signal);
    if (isWhatsAppTerminal() || signal.aborted)
        return;
    const { useMultiFileAuthState, makeWASocket, Browsers, proto } = await abortable(() => loadBaileys(), signal);
    if (isWhatsAppTerminal() || signal.aborted)
        return;
    const { state: authState, saveCreds } = await abortable(() => useMultiFileAuthState(authDir), signal);
    if (isWhatsAppTerminal() || signal.aborted)
        return;
    const socket = makeWASocket({
        version,
        auth: authState,
        printQRInTerminal: false,
        logger: baileysLogger,
        browser: Browsers.macOS('Chrome'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        getMessage: async (key) => {
            const cached = state.sentMessageCache.get(key.id ?? '');
            if (cached)
                return cached;
            // Returning an empty message prevents Baileys from hanging on
            // "waiting for this message" when WhatsApp asks to re-encrypt a
            // message we've already sent (common around session restarts).
            return proto.Message.create({});
        },
    });
    if (isWhatsAppTerminal() || signal.aborted) {
        try {
            socket.end(undefined);
        }
        catch { }
        return;
    }
    attachSocketHandlers(socket);
    socket.ev.on('creds.update', (...args) => {
        if (isWhatsAppTerminal())
            return;
        saveCreds(...args);
    });
    state.socket = socket;
    state.state = 'connecting';
}
function wipeAuthDir() {
    try {
        fs.rmSync(getAuthDir(), { recursive: true, force: true });
    }
    catch (err) {
        console.warn('[WhatsApp] Failed to wipe auth dir:', err);
    }
}
function startSocket(requestSignal) {
    return trackWhatsAppWork(startSocketImpl(requestSignal));
}
async function enable(userId) {
    if (whatsappShutdownPromise || whatsappShutdownRequested)
        return { ok: false, error: 'WhatsApp is shutting down.' };
    state.enabled = true;
    // Reset shutdown flag so the auto-reconnect-on-disconnect logic in the
    // close handler is active again after a previous disable() round.
    state.shuttingDown = false;
    whatsappAbortController = new AbortController();
    writeSetting('whatsapp_enabled', 'true');
    writeSetting('whatsapp_activated_by_user_id', userId);
    writeSetting('whatsapp_activated_at', (0, db_1.now)());
    writeSetting('whatsapp_disclosure_version_acknowledged', '1');
    state.lastError = null;
    state.lastErrorReason = null;
    // Restore from creds.json if present — re-pairing while creds are still
    // valid is a WhatsApp ban risk. 401 from the server falls through to the
    // QR flow as usual.
    const credsPath = path.join(getAuthDir(), 'creds.json');
    if (fs.existsSync(credsPath)) {
        void startSocket().catch((err) => {
            console.warn('[WhatsApp] Auto-restore on enable failed:', err?.message ?? err);
        });
    }
    return { ok: true };
}
function disable() {
    state.enabled = false;
    state.shuttingDown = true;
    whatsappAbortController.abort();
    writeSetting('whatsapp_enabled', 'false');
    writeSetting('whatsapp_connected_phone', '');
    if (state.socket) {
        try {
            state.socket.end(undefined);
        }
        catch { /* ignore */ }
        state.socket = null;
    }
    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }
    state.state = 'disconnected';
    state.connectedPhone = null;
    state.lastQr = null;
    state.lastPairingCode = null;
    state.lastError = null;
    state.lastErrorReason = null;
    state.cooldownUntil = null;
    if (state.cooldownTimer) {
        clearTimeout(state.cooldownTimer);
        state.cooldownTimer = null;
    }
    wipeAuthDir();
}
async function connectWithQr(requestSignal) {
    if (!state.enabled)
        return { ok: false, error: 'WhatsApp is not enabled.' };
    if (whatsappShutdownPromise || whatsappShutdownRequested)
        return { ok: false, error: 'WhatsApp is shutting down.' };
    state.shuttingDown = false;
    if (whatsappAbortController.signal.aborted)
        whatsappAbortController = new AbortController();
    const signal = requestSignal
        ? AbortSignal.any([requestSignal, whatsappAbortController.signal])
        : whatsappAbortController.signal;
    if (signal.aborted)
        return { ok: false, error: 'WhatsApp request cancelled.' };
    state.lastQr = null;
    state.lastPairingCode = null;
    await abortable(() => startSocket(signal), signal);
    // QR arrives asynchronously via connection.update
    return { ok: true };
}
async function connectWithPairingCode(phone, requestSignal) {
    if (!state.enabled)
        return { ok: false, error: 'WhatsApp is not enabled.' };
    if (whatsappShutdownPromise || whatsappShutdownRequested)
        return { ok: false, error: 'WhatsApp is shutting down.' };
    state.shuttingDown = false;
    if (whatsappAbortController.signal.aborted)
        whatsappAbortController = new AbortController();
    const signal = requestSignal
        ? AbortSignal.any([requestSignal, whatsappAbortController.signal])
        : whatsappAbortController.signal;
    if (signal.aborted)
        return { ok: false, error: 'WhatsApp request cancelled.' };
    try {
        if (!state.socket) {
            await abortable(() => startSocket(signal), signal);
            await abortableDelay(1500, signal);
        }
        if (!state.socket)
            return { ok: false, error: 'Socket not ready, try again.' };
        const code = await abortable(() => state.socket.requestPairingCode(phone.replace(/\D/g, '')), signal);
        state.lastPairingCode = code;
        state.state = 'waiting_pairing';
        return { ok: true, code };
    }
    catch (err) {
        return { ok: false, error: err.message ?? 'Failed to request pairing code.' };
    }
}
function disconnect() {
    // Match disable(): setting shuttingDown before ending the socket makes the
    // close handler take the disconnected branch instead of scheduling a
    // reconnect. Without this, every logout re-pops a pairing QR 5s later.
    state.shuttingDown = true;
    whatsappAbortController.abort();
    if (state.socket) {
        try {
            state.socket.logout();
        }
        catch { /* ignore */ }
        try {
            state.socket.end(undefined);
        }
        catch { /* ignore */ }
        state.socket = null;
    }
    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }
    state.state = 'disconnected';
    state.connectedPhone = null;
    state.lastQr = null;
    state.lastPairingCode = null;
    state.lastError = null;
    state.lastErrorReason = null;
    writeSetting('whatsapp_connected_phone', '');
    wipeAuthDir();
}
const sendLocks = new Map();
// Serialize sends per recipient. The rate-limit and duplicate-body checks are
// synchronous, but sendMessage yields while resolving the JID and sending;
// without this lock two requests could both pass those checks.
function sendMessage(req) {
    return trackWhatsAppWork(sendMessageWithLock(req));
}
async function sendMessageWithLock(req) {
    const signal = req.signal
        ? AbortSignal.any([whatsappAbortController.signal, req.signal])
        : whatsappAbortController.signal;
    const previous = sendLocks.get(req.phoneE164) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    sendLocks.set(req.phoneE164, current);
    try {
        await abortable(() => previous, signal);
        if (isWhatsAppTerminal())
            return { ok: false, error: 'WhatsApp is shutting down.', reason: 'send_failed' };
        return await sendMessageInternal(req, signal);
    }
    catch (error) {
        if (isWhatsAppTerminal() || signal.aborted) {
            return { ok: false, error: 'WhatsApp is shutting down.', reason: 'send_failed' };
        }
        throw error;
    }
    finally {
        release();
        if (sendLocks.get(req.phoneE164) === current)
            sendLocks.delete(req.phoneE164);
    }
}
async function sendMessageInternal(req, signal) {
    if (!state.enabled || isWhatsAppTerminal())
        return { ok: false, error: 'WhatsApp is not enabled.', reason: 'feature_off' };
    if (!req.phoneE164)
        return { ok: false, error: 'Phone number required.', reason: 'no_phone' };
    if (state.state !== 'connected' || !state.socket) {
        return { ok: false, error: 'Flo is not connected to WhatsApp.', reason: 'not_connected' };
    }
    const socket = state.socket;
    const jid = await resolveJid(req.phoneE164, socket, signal);
    if (isWhatsAppTerminal())
        return { ok: false, error: 'WhatsApp is shutting down.', reason: 'send_failed' };
    if (!jid) {
        return { ok: false, error: 'This phone is not registered on WhatsApp.', reason: 'not_on_whatsapp' };
    }
    if (isInCooldown()) {
        return { ok: false, error: 'Send is temporarily paused.', reason: 'cooldown' };
    }
    if (isBlocked(req.phoneE164)) {
        return { ok: false, error: 'This number asked to stop receiving messages.', reason: 'blocked' };
    }
    const rate = isOverRateLimit(req.phoneE164);
    if (rate.limited) {
        return { ok: false, error: 'Rate limit reached for this number.', reason: 'rate_limited' };
    }
    const contentErr = hasShortenerOrNonHttps(req.body);
    if (contentErr) {
        return { ok: false, error: contentErr, reason: 'content_blocked' };
    }
    if (isDuplicateBody(req.phoneE164, req.body)) {
        return { ok: false, error: 'Identical message sent to this number recently.', reason: 'content_blocked' };
    }
    const db = (0, db_1.getDatabase)();
    const bill = req.billId
        ? db.prepare(`
        SELECT b.*, o.customer_id AS order_customer_id
        FROM bills b
        LEFT JOIN orders o ON o.id = b.order_id
        WHERE b.id = ?
      `).get(req.billId)
        : null;
    if (bill && bill.payment_status !== 'paid') {
        return { ok: false, error: 'Bill is not paid.', reason: 'send_failed' };
    }
    let resolvedKind = req.kind;
    let resolvedCustomerId = req.customerId;
    if (bill) {
        if (bill.customer_id && String(bill.customer_id) === String(bill.order_customer_id)) {
            resolvedKind = 'bill_receipt';
            resolvedCustomerId = bill.customer_id;
        }
    }
    let messageId;
    try {
        messageId = recordMessageRow({
            phone_e164: req.phoneE164,
            direction: 'outbound',
            kind: resolvedKind,
            status: 'queued',
            body: req.body,
            bill_id: req.billId,
            customer_id: resolvedCustomerId,
            created_by_user_id: req.userId,
        });
    }
    catch (err) {
        return { ok: false, error: err.message ?? 'Failed to record message.', reason: 'send_failed' };
    }
    const shutdownFailure = () => {
        if (!whatsappTerminalCleanup) {
            try {
                updateMessageRow(messageId, {
                    status: 'failed',
                    error: 'WhatsApp is shutting down.',
                    timestamp_field: 'failed_at',
                });
            }
            catch { }
        }
        return { ok: false, messageId, error: 'WhatsApp is shutting down.', reason: 'send_failed' };
    };
    try {
        if (resolvedKind === 'manual_reply') {
            try {
                updateMessageRow(messageId, { status: 'seen', timestamp_field: 'seen_at' });
            }
            catch { /* best-effort */ }
        }
        await abortable(() => socket.presenceSubscribe(jid), signal).catch(() => { });
        if (isWhatsAppTerminal() || signal.aborted)
            return shutdownFailure();
        await abortable(() => socket.sendPresenceUpdate('composing', jid), signal).catch(() => { });
        if (isWhatsAppTerminal() || signal.aborted)
            return shutdownFailure();
        updateMessageRow(messageId, { status: 'typing', timestamp_field: 'typing_at' });
        await abortableDelay(randomDelayMs(req.body), signal);
        await abortable(() => socket.sendPresenceUpdate('paused', jid), signal).catch(() => { });
        if (isWhatsAppTerminal() || signal.aborted)
            return shutdownFailure();
        const sent = await abortable(() => socket.sendMessage(jid, { text: req.body }), signal);
        if (isWhatsAppTerminal() || signal.aborted)
            return shutdownFailure();
        // sendMessage() only resolves when Baileys hands the payload to its
        // local queue — not when WhatsApp's servers ACK it. Don't claim 'sent'
        // yet; the messages.update handler sets status='sent' + sent_at when
        // the server returns status=2 (SERVER_ACK). Without this guard, a
        // silently-dropped message (bad JID, network blip, server reject)
        // would mark the row 'sent' while the recipient never receives it.
        updateMessageRow(messageId, {
            external_message_id: sent?.key?.id ?? null,
        });
        // Cache the message body so Baileys's getMessage() can serve re-encrypt
        // requests for it (common around session restarts). Without this,
        // Baileys hangs on "waiting for this message" indefinitely.
        if (sent?.key?.id && sent?.message) {
            state.sentMessageCache.set(sent.key.id, sent.message);
            if (state.sentMessageCache.size > SENT_MESSAGE_CACHE_MAX) {
                const oldest = state.sentMessageCache.keys().next().value;
                state.sentMessageCache.delete(oldest);
            }
        }
        state.lastSendByPhone.set(req.phoneE164, Date.now());
        if (state.lastSendByPhone.size > 1000) {
            const oldestKey = state.lastSendByPhone.keys().next().value;
            if (oldestKey)
                state.lastSendByPhone.delete(oldestKey);
        }
        return { ok: true, messageId };
    }
    catch (err) {
        if (isWhatsAppTerminal() || signal.aborted)
            return shutdownFailure();
        updateMessageRow(messageId, {
            status: 'failed',
            error: err?.message ?? 'Send failed',
            timestamp_field: 'failed_at',
        });
        const statusCode = err?.output?.statusCode;
        if (typeof statusCode === 'number' && RATE_LIMITED_STATUS_CODES.has(statusCode)) {
            triggerCooldown(`Send rate-limited by WhatsApp (${statusCode}). Cooling down for 5 minutes.`, 5 * 60 * 1000, 'rate_limited');
        }
        return { ok: false, messageId, error: err?.message ?? 'Send failed', reason: 'send_failed' };
    }
}
function listInbox(limit, offset) {
    return (0, db_1.getDatabase)().prepare(`
    SELECT id, phone_e164, body, status, queued_at
    FROM whatsapp_messages
    WHERE direction = 'inbound'
    ORDER BY queued_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}
function listMessages(opts) {
    const where = [];
    const params = [];
    if (opts.direction) {
        where.push('direction = ?');
        params.push(opts.direction);
    }
    if (opts.status) {
        where.push('status = ?');
        params.push(opts.status);
    }
    if (opts.phone) {
        where.push('phone_e164 = ?');
        params.push(opts.phone);
    }
    if (opts.billId) {
        where.push('bill_id = ?');
        params.push(opts.billId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(opts.limit, opts.offset);
    return (0, db_1.getDatabase)().prepare(`
    SELECT id, phone_e164, bill_id, customer_id, direction, kind, status,
           body, error, queued_at, seen_at, typing_at, sent_at,
           delivered_at, read_at, failed_at, created_by_user_id
    FROM whatsapp_messages
    ${whereSql}
    ORDER BY queued_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);
}
function listBlocklist() {
    return (0, db_1.getDatabase)()
        .prepare('SELECT phone_e164, reason, blocked_at, blocked_by_user_id FROM whatsapp_blocklist ORDER BY blocked_at DESC')
        .all();
}
function addToBlocklist(phoneE164, reason, userId) {
    (0, db_1.getDatabase)().prepare(`
    INSERT INTO whatsapp_blocklist (phone_e164, reason, blocked_at, blocked_by_user_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(phone_e164) DO UPDATE SET reason = excluded.reason, blocked_at = excluded.blocked_at
  `).run(phoneE164, reason, (0, db_1.now)(), userId);
}
function removeFromBlocklist(phoneE164) {
    const result = (0, db_1.getDatabase)().prepare('DELETE FROM whatsapp_blocklist WHERE phone_e164 = ?').run(phoneE164);
    return result.changes > 0;
}
function initFromDb() {
    // creds.json is the source of truth for the paired phone; the DB setting
    // is just a fallback when creds.json is missing (fresh install) or corrupt.
    const credsPath = path.join(getAuthDir(), 'creds.json');
    if (fs.existsSync(credsPath)) {
        try {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
            if (creds.me?.id) {
                state.connectedPhone = '+' + userFromJid(creds.me.id);
            }
        }
        catch {
            // corrupt creds — fall through to DB fallback
        }
    }
    if (!state.connectedPhone) {
        state.connectedPhone = (0, db_1.getSettingValue)('whatsapp_connected_phone') || null;
    }
    const v = (0, db_1.getDatabase)().prepare("SELECT value FROM settings WHERE key = 'whatsapp_enabled'").get();
    state.enabled = v?.value === 'true';
    if (state.enabled) {
        void startSocket().catch((err) => {
            console.warn('[WhatsApp] Startup failed:', err?.message ?? err);
        });
    }
}
function shutdown() {
    if (whatsappShutdownPromise)
        return whatsappShutdownPromise;
    requestShutdown();
    const socket = state.socket;
    shutdownSocket = socket;
    whatsappShutdownPromise = waitForWhatsAppWork().finally(() => {
        if (inFlightWhatsAppWork.size === 0) {
            if (state.socket === socket)
                state.socket = null;
            shutdownSocket = null;
        }
    });
    return whatsappShutdownPromise;
}
function requestShutdown() {
    if (whatsappShutdownRequested)
        return;
    whatsappShutdownRequested = true;
    state.shuttingDown = true;
    whatsappAbortController.abort();
    cancelInFlightWhatsAppWork();
    if (state.cooldownTimer) {
        clearTimeout(state.cooldownTimer);
        state.cooldownTimer = null;
    }
    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }
    const socket = state.socket;
    shutdownSocket = socket;
    if (socket) {
        try {
            socket.end(undefined);
        }
        catch { /* ignore */ }
    }
}
//# sourceMappingURL=whatsapp.js.map