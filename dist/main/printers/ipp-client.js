"use strict";
// Minimal IPP (RFC 8011) client for talking to the local CUPS daemon over
// loopback HTTP. Exists only for the macOS App Store build: a sandboxed app
// cannot shell out to `lp`/`lpstat` (main/printers/thermal.ts's non-MAS path)
// because the App Sandbox blocks the process-exec / IPC that CUPS's CLI tools
// need, but it CAN reach CUPS's own IPP server on 127.0.0.1:631 — cupsd
// always listens there regardless of whether "Printer Sharing" is on — using
// the same com.apple.security.network.client entitlement already granted for
// network printers. Submitting a raw job over IPP reaches the exact same
// already-configured CUPS queue that `lp -o raw` targets in the non-MAS build,
// so it works for USB printers without a new USB entitlement or fighting the
// system's printer-class driver for exclusive interface access.
//
// Implements only the operations FloCafe needs: Print-Job, Get-Printer-Attributes,
// and the CUPS extensions CUPS-Get-Printers / CUPS-Get-Default.
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
exports.ippGetPrinters = ippGetPrinters;
exports.ippGetDefaultPrinterName = ippGetDefaultPrinterName;
exports.ippGetPrinterAttributes = ippGetPrinterAttributes;
exports.ippPrintRaw = ippPrintRaw;
const http = __importStar(require("http"));
const CUPS_HOST = '127.0.0.1';
const CUPS_PORT = 631;
const IPP_TIMEOUT_MS = 10_000;
const OP_PRINT_JOB = 0x0002;
const OP_GET_PRINTER_ATTRIBUTES = 0x000b;
const OP_CUPS_GET_DEFAULT = 0x4001;
const OP_CUPS_GET_PRINTERS = 0x4002;
const TAG_OPERATION_ATTRIBUTES = 0x01;
const TAG_JOB_ATTRIBUTES = 0x02;
const TAG_END_OF_ATTRIBUTES = 0x03;
const TAG_PRINTER_ATTRIBUTES = 0x04;
const VALUE_TAG = {
    integer: 0x21,
    boolean: 0x22,
    enum: 0x23,
    uri: 0x45,
    keyword: 0x44,
    charset: 0x47,
    naturalLanguage: 0x48,
    mimeMediaType: 0x49,
    nameWithoutLanguage: 0x42,
};
let requestIdCounter = 1;
function encodeValue(tag, value) {
    if (tag === VALUE_TAG.integer || tag === VALUE_TAG.enum) {
        const buf = Buffer.alloc(4);
        buf.writeInt32BE(Number(value), 0);
        return buf;
    }
    if (tag === VALUE_TAG.boolean) {
        return Buffer.from([value ? 1 : 0]);
    }
    return Buffer.from(String(value), 'utf8');
}
function encodeAttribute(buf, attr) {
    attr.values.forEach((value, i) => {
        const nameBytes = i === 0 ? Buffer.from(attr.name, 'utf8') : Buffer.alloc(0);
        const valueBytes = encodeValue(attr.tag, value);
        const header = Buffer.alloc(1 + 2 + nameBytes.length + 2);
        header.writeUInt8(attr.tag, 0);
        header.writeUInt16BE(nameBytes.length, 1);
        nameBytes.copy(header, 3);
        header.writeUInt16BE(valueBytes.length, 3 + nameBytes.length);
        buf.push(header, valueBytes);
    });
}
function buildRequest(operationId, operationAttributes, body) {
    const parts = [];
    const header = Buffer.alloc(8);
    header.writeUInt8(2, 0); // IPP major version
    header.writeUInt8(0, 1); // IPP minor version
    header.writeUInt16BE(operationId, 2);
    header.writeUInt32BE(requestIdCounter++, 4);
    parts.push(header);
    parts.push(Buffer.from([TAG_OPERATION_ATTRIBUTES]));
    encodeAttribute(parts, { tag: VALUE_TAG.charset, name: 'attributes-charset', values: ['utf-8'] });
    encodeAttribute(parts, { tag: VALUE_TAG.naturalLanguage, name: 'attributes-natural-language', values: ['en'] });
    for (const attr of operationAttributes)
        encodeAttribute(parts, attr);
    parts.push(Buffer.from([TAG_END_OF_ATTRIBUTES]));
    if (body)
        parts.push(body);
    return Buffer.concat(parts);
}
function readString(buf, offset, length) {
    return buf.toString('utf8', offset, offset + length);
}
function decodeValue(tag, buf, offset, length) {
    if (tag === VALUE_TAG.integer || tag === VALUE_TAG.enum) {
        return length >= 4 ? buf.readInt32BE(offset) : 0;
    }
    if (tag === VALUE_TAG.boolean) {
        return length >= 1 && buf.readUInt8(offset) !== 0;
    }
    return readString(buf, offset, length);
}
function isValueTag(tag) {
    // Attribute value tags occupy 0x10-0x4F; the delimiter tags (start-of-group
    // / end-of-attributes) used here are all below that range.
    return tag >= 0x10;
}
function parseResponse(buf) {
    const statusCode = buf.readUInt16BE(2);
    let offset = 8;
    const operationAttributes = {};
    const groups = [];
    let currentGroup = null;
    let lastAttrName = '';
    while (offset < buf.length) {
        const tag = buf.readUInt8(offset);
        offset += 1;
        if (tag === TAG_END_OF_ATTRIBUTES)
            break;
        if (!isValueTag(tag)) {
            // A new attribute-group delimiter (operation/job/printer/...).
            currentGroup = tag === TAG_OPERATION_ATTRIBUTES ? null : {};
            if (currentGroup && (tag === TAG_PRINTER_ATTRIBUTES || tag === TAG_JOB_ATTRIBUTES)) {
                groups.push(currentGroup);
            }
            lastAttrName = '';
            continue;
        }
        const nameLength = buf.readUInt16BE(offset);
        offset += 2;
        const name = readString(buf, offset, nameLength);
        offset += nameLength;
        const valueLength = buf.readUInt16BE(offset);
        offset += 2;
        const value = decodeValue(tag, buf, offset, valueLength);
        offset += valueLength;
        const attrName = name || lastAttrName;
        lastAttrName = attrName;
        const target = currentGroup ?? operationAttributes;
        if (!target[attrName])
            target[attrName] = [];
        target[attrName].push(value);
    }
    return { statusCode, operationAttributes, groups };
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// cupsd is launchd-socket-activated and exits when idle — the exact scenario
// a POS printer sits in between rushes. A connection that lands mid-relaunch
// gets an immediate ECONNREFUSED even though the very next attempt succeeds
// (reproduced against a real Mac's idle cupsd); a couple of short retries
// absorb that race instead of surfacing it as a print failure.
async function ippRequest(path, operationId, operationAttributes, body, signal) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await ippRequestOnce(path, operationId, operationAttributes, body, signal);
        }
        catch (err) {
            if (err?.code !== 'ECONNREFUSED' || attempt === maxAttempts || signal?.aborted)
                throw err;
            await delay(250 * attempt);
        }
    }
    throw new Error('unreachable');
}
async function ippRequestOnce(path, operationId, operationAttributes, body, signal) {
    const requestBody = buildRequest(operationId, operationAttributes, body);
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: CUPS_HOST,
            port: CUPS_PORT,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/ipp',
                'Content-Length': requestBody.length,
            },
            timeout: IPP_TIMEOUT_MS,
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const status = res.statusCode ?? 0;
                if (status < 200 || status >= 300) {
                    reject(new Error(`local CUPS returned HTTP ${status} for ${path}`));
                    return;
                }
                try {
                    resolve(parseResponse(Buffer.concat(chunks)));
                }
                catch (err) {
                    reject(err);
                }
            });
            res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error('IPP request to local CUPS server timed out')));
        req.on('error', reject);
        if (signal) {
            if (signal.aborted) {
                req.destroy(new Error('aborted'));
                return;
            }
            signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
        }
        req.end(requestBody);
    });
}
const REQUESTED_PRINTER_ATTRIBUTES = {
    tag: VALUE_TAG.keyword,
    name: 'requested-attributes',
    values: [
        'printer-name',
        'printer-info',
        'printer-make-and-model',
        'printer-state',
        'printer-is-accepting-jobs',
        'device-uri',
        'printer-uri-supported',
    ],
};
/** Enumerates every printer CUPS knows about (queues for USB and network printers alike). */
async function ippGetPrinters(signal) {
    const response = await ippRequest('/', OP_CUPS_GET_PRINTERS, [
        { tag: VALUE_TAG.nameWithoutLanguage, name: 'requesting-user-name', values: ['flocafe'] },
        REQUESTED_PRINTER_ATTRIBUTES,
    ], undefined, signal);
    return response.groups;
}
/** Returns the CUPS-configured default printer's name, or null if none is set. */
async function ippGetDefaultPrinterName(signal) {
    const response = await ippRequest('/', OP_CUPS_GET_DEFAULT, [
        { tag: VALUE_TAG.nameWithoutLanguage, name: 'requesting-user-name', values: ['flocafe'] },
        REQUESTED_PRINTER_ATTRIBUTES,
    ], undefined, signal);
    const name = response.groups[0]?.['printer-name']?.[0];
    return typeof name === 'string' ? name : null;
}
/** Pre-flight check mirroring thermal.ts's describeCupsQueueProblem for the lp path. */
async function ippGetPrinterAttributes(printerName, signal) {
    const response = await ippRequest(`/printers/${encodeURIComponent(printerName)}`, OP_GET_PRINTER_ATTRIBUTES, [
        { tag: VALUE_TAG.uri, name: 'printer-uri', values: [`ipp://localhost/printers/${encodeURIComponent(printerName)}`] },
        { tag: VALUE_TAG.nameWithoutLanguage, name: 'requesting-user-name', values: ['flocafe'] },
        { tag: VALUE_TAG.keyword, name: 'requested-attributes', values: ['printer-state', 'printer-is-accepting-jobs'] },
    ], undefined, signal);
    const group = response.groups[0] || {};
    const state = group['printer-state']?.[0];
    const accepting = group['printer-is-accepting-jobs']?.[0];
    return {
        state: typeof state === 'number' ? state : undefined,
        isAcceptingJobs: typeof accepting === 'boolean' ? accepting : undefined,
    };
}
/** Submits raw bytes (ESC/POS) as a Print-Job with document-format application/octet-stream — the IPP equivalent of `lp -o raw`. */
async function ippPrintRaw(printerName, data, signal) {
    const response = await ippRequest(`/printers/${encodeURIComponent(printerName)}`, OP_PRINT_JOB, [
        { tag: VALUE_TAG.uri, name: 'printer-uri', values: [`ipp://localhost/printers/${encodeURIComponent(printerName)}`] },
        { tag: VALUE_TAG.nameWithoutLanguage, name: 'requesting-user-name', values: ['flocafe'] },
        { tag: VALUE_TAG.nameWithoutLanguage, name: 'job-name', values: ['FloCafe receipt'] },
        { tag: VALUE_TAG.mimeMediaType, name: 'document-format', values: ['application/octet-stream'] },
    ], data, signal);
    const jobId = response.groups[0]?.['job-id']?.[0];
    const ok = response.statusCode <= 0x00ff; // 0x00xx = successful-* per RFC 8011
    return {
        ok,
        statusCode: response.statusCode,
        jobId: typeof jobId === 'number' ? jobId : undefined,
        detail: ok ? undefined : `IPP status 0x${response.statusCode.toString(16)}`,
    };
}
//# sourceMappingURL=ipp-client.js.map