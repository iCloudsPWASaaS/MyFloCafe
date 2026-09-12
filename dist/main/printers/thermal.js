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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasFinancialPrintWarning = hasFinancialPrintWarning;
exports.makeFinancialPrintRefusalMessage = makeFinancialPrintRefusalMessage;
exports.classifyPrintFailure = classifyPrintFailure;
exports.detectConnectedPrinters = detectConnectedPrinters;
exports.initPrinter = initPrinter;
exports.printReceipt = printReceipt;
exports.printKOT = printKOT;
exports.printReceiptDetailed = printReceiptDetailed;
exports.printKOTDetailed = printKOTDetailed;
exports.prepareReceipt = prepareReceipt;
exports.formatReceipt = formatReceipt;
exports.normalizeReceiptTemplate = normalizeReceiptTemplate;
exports.appendPoweredByFooter = appendPoweredByFooter;
exports.formatCompactReceipt = formatCompactReceipt;
exports.formatClassicReceipt = formatClassicReceipt;
exports.itemNameWidth = itemNameWidth;
exports.itemAmountWidth = itemAmountWidth;
exports.itemRows = itemRows;
exports.addonRows = addonRows;
exports.financialRows = financialRows;
exports.formatCurrency = formatCurrency;
exports.rightAlign = rightAlign;
exports.truncate = truncate;
exports.truncateShapedLine = truncateShapedLine;
exports.normalizePrintLanguage = normalizePrintLanguage;
exports.resolvePaymentMethodLabel = resolvePaymentMethodLabel;
exports.formatTableLabel = formatTableLabel;
exports.wrapText = wrapText;
exports.pushWrapped = pushWrapped;
exports.pushCenteredWrapped = pushCenteredWrapped;
exports.formatKOT = formatKOT;
exports.buildTestPage = buildTestPage;
exports.normalizeThermalText = normalizeThermalText;
exports.resolveCurrencyPrefix = resolveCurrencyPrefix;
exports.appendCashDrawerPulse = appendCashDrawerPulse;
exports.buildEscPos = buildEscPos;
exports.escPosToText = escPosToText;
exports.printViaNetwork = printViaNetwork;
exports.printViaUSB = printViaUSB;
exports.getPrinterStatus = getPrinterStatus;
const net = __importStar(require("net"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const db_1 = require("../db");
const profiles_1 = require("./profiles");
const countries_1 = require("../countries");
const tax_components_1 = require("../services/tax-components");
const print_templates_1 = require("../services/print-templates");
const document_merchant_1 = require("./document-merchant");
const errors_1 = require("../errors");
const telemetry_1 = require("../services/telemetry");
const cloud_sync_1 = require("../services/cloud-sync");
const crypto_1 = require("crypto");
const codepage_encoder_1 = __importDefault(require("@point-of-sale/codepage-encoder"));
const print_labels_generated_1 = require("../print/print-labels.generated");
const template_labels_1 = require("../print/template-labels");
const document_classic_1 = require("./document-classic");
const document_compact_1 = require("./document-compact");
const document_kot_1 = require("./document-kot");
const thermal_capabilities_1 = require("../../shared/print/thermal-capabilities");
const ipp_client_1 = require("./ipp-client");
function hasFinancialPrintWarning(warnings) {
    return warnings.some((warning) => warning.kind === 'financial');
}
function makeFinancialPrintRefusalMessage(warnings) {
    const row = warnings.find((warning) => warning.kind === 'financial');
    return `Receipt not printed: a financial row contains unsupported printer text${row?.text ? `: ${row.text}` : '.'} Use a supported printer profile or system/browser printing.`;
}
const FINANCIAL_PRINT_REFUSAL_DIAGNOSTIC = 'Receipt not printed: unsupported financial row';
/** Stable, privacy-safe classification for fleet telemetry. */
function classifyPrintFailure(detail) {
    const value = String(detail || '').toLowerCase();
    if (!value)
        return 'unknown';
    if (value.includes('no printer configured') || value.includes('no windows printer configured'))
        return 'not_configured';
    if (value.includes('offline') || value.includes('use printer offline') || value.includes('disconnected'))
        return 'offline';
    if (value.includes('not accepting') || value.includes('queue') && value.includes('unavailable') || value.includes('cannot open printer'))
        return 'queue_unavailable';
    if (value.includes('spool') || value.includes('startdocprinter') || value.includes('startpageprinter'))
        return 'spooler_error';
    if (value.includes('driver') || value.includes('no driver'))
        return 'driver_error';
    if (value.includes('access denied') || value.includes('permission'))
        return 'permission_denied';
    if (value.includes('timed out') || value.includes('timeout'))
        return 'timeout';
    if (value.includes('writeprinter') || value.includes('accepted') && value.includes('of'))
        return 'write_error';
    if (value.includes('not supported') || value.includes('unsupported'))
        return 'unsupported';
    return 'unknown';
}
function extractPlatformErrorCode(detail) {
    const match = String(detail || '').match(/\b(?:win32 error|error)\s+(\d+)\b/i);
    if (!match)
        return undefined;
    const code = Number(match[1]);
    return Number.isSafeInteger(code) ? code : undefined;
}
const isMasBuild = process.env.MAS_BUILD === '1' ||
    process.mas === true;
const PRINTER_DETECTION_TIMEOUT_MS = 10_000;
const RECEIPT_BRANDING_NAME = 'Powered by FloPOS';
const RECEIPT_BRANDING_URL = 'https://flopos.com';
function guessPaperWidth(name, model) {
    const profile = (0, profiles_1.matchSupportedPrinterProfile)(name, model);
    if (profile)
        return profile.defaultPaperWidth;
    const s = (name + ' ' + model).toLowerCase();
    if (s.includes('58'))
        return 'cols-32';
    return 'cols-42';
}
function annotateProfile(info) {
    const profile = (0, profiles_1.matchSupportedPrinterProfile)(info.name, info.make, info.model);
    return profile ? { ...info, profileId: profile.id, paperWidth: info.paperWidth || profile.defaultPaperWidth } : info;
}
function parseDeviceUri(uri) {
    const m = uri.match(/(?:socket|ipp|ipps|http|https|lpd):\/\/([^:\/\s]+)(?::(\d+))?/i);
    if (!m)
        return {};
    const host = m[1];
    const port = m[2] ? parseInt(m[2], 10) : undefined;
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);
    return { ip: isIp ? host : host, port };
}
async function detectConnectedPrinters(signal) {
    const printers = [];
    if (signal?.aborted) {
        return printers;
    }
    if (isMasBuild) {
        // The App Sandbox blocks the `lpstat`/`lpoptions` shell-outs detectMacOSPrinters
        // relies on, but CUPS's own local IPP server (127.0.0.1:631, always listening)
        // is reachable with the network-client entitlement already granted — see
        // ipp-client.ts for why this works where shelling out doesn't.
        return process.platform === 'darwin' ? await detectPrintersViaIpp(signal) : printers;
    }
    if (process.platform === 'darwin') {
        return await detectMacOSPrinters(signal);
    }
    if (process.platform === 'win32') {
        return detectWindowsPrinters(signal);
    }
    if (process.platform === 'linux') {
        return detectLinuxPrinters(signal);
    }
    return printers;
}
async function detectMacOSPrinters(signal) {
    const printers = [];
    try {
        const { stdout: lpStatOutput } = await execFileAsync('lpstat', ['-v'], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        const lines = lpStatOutput.split('\n');
        const printerNames = new Set();
        for (const line of lines) {
            const match = line.match(/device for (\S+):\s*(.+)/);
            if (match) {
                if (signal?.aborted)
                    return printers;
                const name = match[1];
                const uri = match[2].trim();
                if (!printerNames.has(name)) {
                    printerNames.add(name);
                    const makeModel = await getMacOSPrinterDetails(name, signal);
                    const isDefault = await isMacOSDefaultPrinter(name, signal);
                    const status = await getMacOSPrinterStatus(name, signal);
                    if (signal?.aborted)
                        return printers;
                    const isNetwork = /^(socket|ipp|ipps|http|https|lpd):\/\//i.test(uri);
                    const { ip, port } = isNetwork ? parseDeviceUri(uri) : {};
                    printers.push(annotateProfile({
                        name,
                        make: makeModel.make,
                        model: makeModel.model,
                        connectionType: isNetwork ? 'network' : 'usb',
                        deviceUri: uri,
                        status,
                        isDefault,
                        ipAddress: ip,
                        port: port || (isNetwork ? 9100 : undefined),
                        paperWidth: guessPaperWidth(name, makeModel.model),
                    }));
                }
            }
        }
    }
    catch (err) {
        console.log('[Printer] Could not detect macOS printers:', err);
    }
    return printers;
}
// MAS-build counterpart to detectMacOSPrinters: same CUPS queues, reached over
// local IPP instead of `lpstat`/`lpoptions` (see ipp-client.ts for why).
async function detectPrintersViaIpp(signal) {
    const printers = [];
    try {
        const [groups, defaultName] = await Promise.all([
            (0, ipp_client_1.ippGetPrinters)(signal),
            (0, ipp_client_1.ippGetDefaultPrinterName)(signal).catch(() => null),
        ]);
        for (const group of groups) {
            if (signal?.aborted)
                return printers;
            const name = group['printer-name']?.[0];
            if (typeof name !== 'string' || !name)
                continue;
            const deviceUri = String(group['device-uri']?.[0] || '');
            const makeAndModel = String(group['printer-make-and-model']?.[0] || '');
            const isNetwork = /^(socket|ipp|ipps|http|https|lpd):\/\//i.test(deviceUri);
            const { ip, port } = isNetwork ? parseDeviceUri(deviceUri) : {};
            const parsedUsb = !isNetwork ? parseCupsDeviceUri(deviceUri) : null;
            const [make, ...modelParts] = makeAndModel.split(' ');
            const model = modelParts.join(' ') || 'Thermal Printer';
            const state = group['printer-state']?.[0];
            const accepting = group['printer-is-accepting-jobs']?.[0];
            const status = accepting === false || state === 5 ? 'offline' : state === 4 ? 'printing' : 'idle';
            printers.push(annotateProfile({
                name,
                make: parsedUsb?.make || make || 'Unknown',
                model: parsedUsb?.model || model,
                connectionType: isNetwork ? 'network' : 'usb',
                deviceUri,
                status,
                isDefault: name === defaultName,
                ipAddress: ip,
                port: port || (isNetwork ? 9100 : undefined),
                paperWidth: guessPaperWidth(name, parsedUsb?.model || model),
            }));
        }
        // CUPS-Get-Default reports the server-level default, which most desktop
        // installs never set — the "default" shown in System Settings/`lpstat -d`
        // is a user-level lpoptions preference IPP has no operation for, and it
        // is outside a sandboxed app's readable container. A single configured
        // printer is the common case for a small POS setup and unambiguous, so
        // fall back to it rather than leaving every printer's isDefault false.
        if (!defaultName && printers.length === 1) {
            printers[0].isDefault = true;
        }
    }
    catch (err) {
        console.log('[Printer] Could not detect printers via local IPP:', err);
    }
    return printers;
}
async function getMacOSPrinterStatus(name, signal) {
    try {
        const { stdout } = await execFileAsync('lpstat', ['-p', name], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        const out = stdout.toLowerCase();
        if (out.includes('disabled'))
            return 'offline';
        if (out.includes('printing') || out.includes('now printing'))
            return 'printing';
        return 'idle';
    }
    catch {
        return 'offline';
    }
}
async function getMacOSPrinterDetails(name, signal) {
    let make = 'Unknown';
    let model = 'Thermal Printer';
    try {
        const { stdout: info } = await execFileAsync('lpoptions', ['-p', name, '-l'], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        const lower = info.toLowerCase();
        if (lower.includes('epson') || name.toLowerCase().includes('tm-')) {
            make = 'Epson';
            model = extractEpsonModel(name, info);
        }
        else if (lower.includes('xprinter') || name.toLowerCase().includes('xprinter')) {
            make = 'Xprinter';
            model = name.includes('80') ? 'Xprinter 80mm' : 'Xprinter 58mm';
        }
        else if (lower.includes('star') || name.toLowerCase().includes('tsp')) {
            make = 'Star';
            model = 'TSP Thermal';
        }
        else if (lower.includes('zjiang') || name.toLowerCase().includes('zj')) {
            make = 'Zjiang';
            model = '58mm Thermal';
        }
        else if (lower.includes('zebra')) {
            make = 'Zebra';
            model = 'Zebra Thermal';
        }
        else if (lower.includes('brother')) {
            make = 'Brother';
            model = 'Brother Thermal';
        }
        else if (lower.includes('canon')) {
            make = 'Canon';
            model = 'Canon Printer';
        }
        else if (lower.includes('hp') || lower.includes('hewlett')) {
            make = 'HP';
            model = 'HP Printer';
        }
        else {
            const nameLower = name.toLowerCase();
            if (nameLower.includes('58') || nameLower.includes('thermal')) {
                make = 'Generic';
                model = '58mm Thermal Printer';
            }
            else if (nameLower.includes('80')) {
                make = 'Generic';
                model = '80mm Thermal Printer';
            }
        }
    }
    catch {
        const nameLower = name.toLowerCase();
        if (nameLower.includes('epson') || nameLower.includes('tm-')) {
            make = 'Epson';
            model = 'TM Series';
        }
        else if (nameLower.includes('xprinter')) {
            make = 'Xprinter';
            model = nameLower.includes('80') ? 'Xprinter 80mm' : 'Xprinter 58mm';
        }
    }
    return { make, model };
}
function extractEpsonModel(name, info) {
    const lower = name.toLowerCase();
    if (lower.includes('tm-m30'))
        return 'TM-m30';
    if (lower.includes('tm-t88'))
        return 'TM-T88';
    if (lower.includes('tm-t82'))
        return 'TM-T82';
    if (lower.includes('tm-t20'))
        return 'TM-T20';
    if (lower.includes('tm-t60'))
        return 'TM-T60';
    if (lower.includes('tm-l90'))
        return 'TM-L90';
    if (lower.includes('tm-h600'))
        return 'TM-H600';
    if (lower.includes('tm-u'))
        return 'TM-U Series';
    if (lower.includes('tm-'))
        return 'TM Series';
    return 'Epson Thermal';
}
async function isMacOSDefaultPrinter(name, signal) {
    try {
        const { stdout: defaultPrinter } = await execFileAsync('lpstat', ['-d'], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        return defaultPrinter.includes(name);
    }
    catch {
        return false;
    }
}
// wmic.exe was removed from Windows 11 24H2+, so it can no longer be relied
// on to enumerate printers. Get-CimInstance talks to the same WMI class
// (Win32_Printer) through the still-supported CIM cmdlets, and -EncodedCommand
// (rather than a .ps1) survives a GPO-locked ExecutionPolicy the same way the
// raw-print helper below does.
const DETECT_WINDOWS_PRINTERS_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Get-CimInstance -ClassName Win32_Printer -Property Name,Default,PrinterStatus,DriverName |
    Select-Object Name,Default,PrinterStatus,DriverName |
    ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;
// Win32_Printer.PrinterStatus: 1=Other, 2=Unknown, 3=Idle, 4=Printing, 5=Warming Up, 6=Stopped Printing, 7=Offline.
function mapWindowsPrinterStatus(printerStatus) {
    if (printerStatus === 3 || printerStatus === 5)
        return 'idle';
    if (printerStatus === 4)
        return 'printing';
    return 'offline';
}
async function detectWindowsPrinters(signal) {
    const printers = [];
    try {
        const encoded = Buffer.from(DETECT_WINDOWS_PRINTERS_SCRIPT, 'utf16le').toString('base64');
        const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', timeout: PRINTER_DETECTION_TIMEOUT_MS, signal, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
        const trimmed = stdout.trim();
        if (trimmed && trimmed !== 'null') {
            const parsed = JSON.parse(trimmed);
            const entries = Array.isArray(parsed) ? parsed : [parsed];
            for (const entry of entries) {
                const name = typeof entry?.Name === 'string' ? entry.Name.trim() : '';
                if (!name)
                    continue;
                const driver = typeof entry.DriverName === 'string' ? entry.DriverName : '';
                const makeModel = detectWindowsMakeModel(name, driver);
                printers.push(annotateProfile({
                    name,
                    make: makeModel.make,
                    model: makeModel.model,
                    connectionType: 'usb',
                    deviceUri: name,
                    driver,
                    status: mapWindowsPrinterStatus(entry.PrinterStatus),
                    isDefault: entry.Default === true,
                    paperWidth: guessPaperWidth(name, makeModel.model),
                }));
            }
        }
    }
    catch (err) {
        console.log('[Printer] Could not detect Windows printers via Get-CimInstance:', err);
    }
    return printers;
}
function detectWindowsMakeModel(name, driver) {
    let make = 'Unknown';
    let model = 'Thermal Printer';
    const lower = (name + ' ' + driver).toLowerCase();
    if (lower.includes('epson') || name.toLowerCase().includes('tm-')) {
        make = 'Epson';
        model = name.includes('TM-m30') ? 'TM-m30' :
            name.includes('TM-T88') ? 'TM-T88' :
                name.includes('TM-T82') ? 'TM-T82' :
                    name.includes('TM-T20') ? 'TM-T20' : 'TM Series';
    }
    else if (lower.includes('xprinter')) {
        make = 'Xprinter';
        model = lower.includes('80') ? 'Xprinter 80mm' : 'Xprinter 58mm';
    }
    else if (lower.includes('star') || lower.includes('tsp')) {
        make = 'Star';
        model = 'TSP Thermal';
    }
    else if (lower.includes('zjiang')) {
        make = 'Zjiang';
        model = '58mm Thermal';
    }
    else if (lower.includes('zebra')) {
        make = 'Zebra';
        model = 'Zebra Thermal';
    }
    else if (lower.includes('brother')) {
        make = 'Brother';
        model = 'Brother Thermal';
    }
    else if (lower.includes('58') || lower.includes('thermal')) {
        make = 'Generic';
        model = '58mm Thermal';
    }
    else if (lower.includes('80')) {
        make = 'Generic';
        model = '80mm Thermal';
    }
    return { make, model };
}
// USB vendor ID lookup for common thermal printer brands
const THERMAL_PRINTER_VENDORS = {
    '04b8': 'Epson',
    '0456': 'Xprinter',
    '0519': 'Star Micronics',
    '0525': 'Star Micronics',
    '0416': 'Zjiang',
    '0419': 'Bixolon',
    '1d90': 'Citizen',
    '04f9': 'Brother',
};
// Bridge chip vendor IDs (not printer brands — these identify the USB-to-serial chip)
const BRIDGE_CHIP_VENDORS = new Set(['1a86', '10c4', '0403']);
function parseCupsDeviceUri(uri) {
    // USB URIs look like: usb://Epson/TM-T88V?serial=ABC123
    const usbMatch = uri.match(/usb:\/\/([^/?]+)\/([^?]+)/);
    if (usbMatch) {
        return { make: decodeURIComponent(usbMatch[1]), model: decodeURIComponent(usbMatch[2]) };
    }
    // Network URIs look like: socket://192.168.1.100:9100
    return null;
}
async function getMakeModelFromLpstat(signal) {
    const result = new Map();
    try {
        const { stdout: output } = await execFileAsync('lpstat', ['-l', '-p'], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        let currentName = '';
        for (const line of output.split('\n')) {
            const nameMatch = line.match(/^printer (\S+) is/);
            if (nameMatch)
                currentName = nameMatch[1];
            const uriMatch = line.match(/Device URI:\s*(.+)/);
            if (uriMatch && currentName) {
                const parsed = parseCupsDeviceUri(uriMatch[1].trim());
                if (parsed)
                    result.set(currentName, parsed);
            }
        }
    }
    catch { /* CUPS not available */ }
    return result;
}
function getUsbPrinterVendorIds() {
    const result = new Map();
    const devicesDir = '/sys/bus/usb/devices';
    try {
        const entries = fs.readdirSync(devicesDir);
        for (const entry of entries) {
            if (entry.includes(':'))
                continue; // skip interfaces
            const devPath = `${devicesDir}/${entry}`;
            try {
                const devClass = fs.readFileSync(`${devPath}/bDeviceClass`, 'utf8').trim();
                if (devClass !== '07')
                    continue; // 07 = USB printer class
                const vendorId = fs.readFileSync(`${devPath}/idVendor`, 'utf8').trim();
                const manufacturer = readSysfsSafe(`${devPath}/manufacturer`);
                const product = readSysfsSafe(`${devPath}/product`);
                result.set(entry, { vendorId, manufacturer, product });
            }
            catch { /* skip device */ }
        }
    }
    catch { /* sysfs not available */ }
    return result;
}
function readSysfsSafe(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8').trim();
    }
    catch {
        return null;
    }
}
async function detectLinuxPrinters(signal) {
    const printers = [];
    try {
        // Layer 1: Get make/model from CUPS Device URI (most reliable)
        const cupsMakeModel = await getMakeModelFromLpstat(signal);
        if (signal?.aborted)
            return printers;
        // Layer 2: Get USB vendor IDs from sysfs (works without CUPS)
        const usbVendors = getUsbPrinterVendorIds();
        // Get printer list from CUPS
        const { stdout: output } = await execFileAsync('lpstat', ['-v'], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        const lines = output.split('\n');
        for (const line of lines) {
            if (signal?.aborted)
                return printers;
            const match = line.match(/device for (\S+):\s*(.+)/);
            if (match) {
                const name = match[1];
                const uri = match[2].trim();
                const isNetwork = /^(socket|ipp|ipps|http|https|lpd):\/\//i.test(uri);
                const { ip, port } = isNetwork ? parseDeviceUri(uri) : {};
                // Try CUPS Device URI first, then fall back to Generic
                const cupsInfo = cupsMakeModel.get(name);
                let make = cupsInfo?.make || 'Generic';
                let model = cupsInfo?.model || 'Thermal Printer';
                // For USB printers without CUPS info, try sysfs vendor ID lookup
                if (!cupsInfo && !isNetwork) {
                    for (const [, vendorInfo] of usbVendors) {
                        // Skip bridge chips — they identify the serial adapter, not the printer
                        if (BRIDGE_CHIP_VENDORS.has(vendorInfo.vendorId.toLowerCase())) {
                            // But if sysfs has manufacturer/product strings, use those
                            if (vendorInfo.manufacturer && vendorInfo.product) {
                                make = vendorInfo.manufacturer;
                                model = vendorInfo.product;
                            }
                            continue;
                        }
                        const vendorMake = THERMAL_PRINTER_VENDORS[vendorInfo.vendorId.toLowerCase()];
                        if (vendorMake) {
                            make = vendorMake;
                            model = vendorInfo.product || 'Thermal Printer';
                            break;
                        }
                    }
                }
                printers.push(annotateProfile({
                    name,
                    make,
                    model,
                    connectionType: isNetwork ? 'network' : 'usb',
                    deviceUri: uri,
                    status: 'idle',
                    isDefault: false,
                    ipAddress: ip,
                    port: port || (isNetwork ? 9100 : undefined),
                    paperWidth: guessPaperWidth(name, model),
                }));
            }
        }
    }
    catch {
        console.log('[Printer] Could not detect Linux printers');
    }
    return printers;
}
async function initPrinter() {
    try {
        const db = (0, db_1.getDatabase)();
        const printer = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
        if (printer) {
            console.log(`[Printer] Default printer: ${printer.name} (${printer.connection_type})`);
        }
        else {
            console.log('[Printer] No default printer configured');
        }
    }
    catch (error) {
        console.log('[Printer] Printer initialization skipped (database not ready)');
    }
}
async function printReceipt(order, bill, business, template = 'classic', useUnicode = false, isReprint = false, signal, arabicShapingOverride, language, additionalLanguage) {
    try {
        if (signal?.aborted)
            return { ok: false, detail: 'Print cancelled during shutdown' };
        console.log('[Printer] printReceipt called, template:', template, 'useUnicode:', useUnicode, 'isReprint:', isReprint);
        const printer = getPrinterConfig();
        if (!printer) {
            console.log('[Printer] No printer configured');
            return { ok: false, detail: 'No printer configured' };
        }
        const { data, warnings, columns } = prepareReceipt(order, bill, business, template, useUnicode, isReprint, arabicShapingOverride, language, additionalLanguage);
        if (hasFinancialPrintWarning(warnings)) {
            return {
                ok: false,
                detail: makeFinancialPrintRefusalMessage(warnings),
                failureClass: 'unsupported',
                warnings,
            };
        }
        const pulseSetting = (0, db_1.getSettingValue)('cash_drawer_pulse_enabled');
        const shouldPulse = pulseSetting === null
            ? printer.cash_drawer_pulse_enabled === 1
            : pulseSetting === 'true' && shouldPulseForPayment(bill);
        const receiptData = shouldPulse ? appendCashDrawerPulse(data) : data;
        console.log('[Printer] Using printer:', printer.name, printer.connection_type, 'columns:', columns);
        console.log('[Printer] Receipt data length:', receiptData.length, 'bytes');
        console.log('[Printer] First 100 bytes:', Array.from(receiptData.slice(0, 100)).map(b => b.toString(16)).join(' '));
        const dispatch = await dispatchPrint(printer, receiptData, signal);
        return warnings.length > 0 ? { ...dispatch, warnings } : dispatch;
    }
    catch (error) {
        console.error('[Printer] Print error:', error);
        return { ok: false, detail: error?.message };
    }
}
/**
 * Decide whether a paid bill contains a payment method selected for drawer
 * opening. The setting is intentionally evaluated here, immediately before
 * dispatch, so every receipt path shares the same backend-authoritative rule.
 */
function shouldPulseForPayment(bill) {
    const configured = (0, db_1.getSettingValue)('cash_drawer_pulse_methods');
    let methods = ['cash', 'card'];
    try {
        const parsed = configured ? JSON.parse(configured) : methods;
        if (Array.isArray(parsed)) {
            const valid = parsed.filter((value) => typeof value === 'string');
            // A non-empty array that contains no valid strings (corrupt/legacy
            // value) restores the safe defaults; an intentionally empty array —
            // every method deselected — stays empty. Mirrors the settings page's
            // hydration of the same setting.
            methods = parsed.length > 0 && valid.length === 0 ? ['cash', 'card'] : valid;
        }
    }
    catch { /* Keep the safe cash/card defaults. */ }
    if (!bill?.payment_details)
        return false;
    try {
        const payments = typeof bill.payment_details === 'string' ? JSON.parse(bill.payment_details) : bill.payment_details;
        if (!Array.isArray(payments))
            return false;
        const db = (0, db_1.getDatabase)();
        return payments.some((payment) => {
            if (!payment || Number(payment.amount || 0) <= 0)
                return false;
            let method = String(payment.method || '').toLowerCase();
            if (method === 'custom' && Number.isSafeInteger(Number(payment.payment_method_id))) {
                const row = db.prepare('SELECT name FROM payment_methods WHERE id = ?').get(Number(payment.payment_method_id));
                method = String(row?.name || method).toLowerCase();
            }
            return methods.some((selected) => selected.toLowerCase() === method);
        });
    }
    catch {
        return false;
    }
}
async function printKOT(order, items, stationName, useUnicode = false, targetPrinter, signal, arabicShapingOverride, language) {
    try {
        if (signal?.aborted)
            return { ok: false, detail: 'Print cancelled during shutdown' };
        console.log('[Printer] printKOT called, items count:', items?.length || 0, 'useUnicode:', useUnicode, 'station:', stationName);
        const printer = targetPrinter || getPrinterConfig();
        if (!printer) {
            console.log('[Printer] No printer configured');
            return { ok: false, detail: 'No printer configured' };
        }
        console.log('[Printer] Using printer:', printer.name, printer.connection_type);
        const profile = (0, profiles_1.resolvePrinterProfile)(printer);
        const cols = getColumnsForPrinter(printer, profile);
        const db = (0, db_1.getDatabase)();
        const biz = db.prepare('SELECT * FROM settings LIMIT 1').get();
        const locale = biz?.country ? (0, countries_1.getCountryByCode)(biz.country)?.locale ?? 'en-US' : 'en-US';
        const timezone = (0, db_1.getSettingValue)('timezone') || 'Asia/Kolkata';
        const tzOptions = { timeZone: timezone };
        const warnings = [];
        // A request-body override (from the renderer's global shaping setting)
        // wins over the profile default so the merchant's explicit choice (#437)
        // applies even when the matched profile leaves the flag unset.
        const capabilities = (0, profiles_1.getPrinterCapabilities)(profile, arabicShapingOverride);
        const data = formatKOT(order, items, stationName, cols, useUnicode, profile.cutMode, locale, tzOptions, warnings, capabilities.shaping.arabic, normalizePrintLanguage(language ?? biz?.language), capabilities);
        console.log('[Printer] KOT data length:', data.length, 'bytes');
        const dispatch = await dispatchPrint(printer, data, signal);
        return warnings.length > 0 ? { ...dispatch, warnings } : dispatch;
    }
    catch (error) {
        console.error('[Printer] KOT print error:', error);
        return { ok: false, detail: error?.message };
    }
}
/**
 * Reports a print failure on both telemetry tiers: an anonymous, aggregate
 * Tier 1 event (specs/floadmin.md § 6.1) and, only where the merchant has
 * given the separate opt-in, a Tier 2 store-attributed diagnostic event
 * (§ 6.2). Both are best-effort and must never affect the caller's result —
 * a slow or unreachable telemetry endpoint cannot make checkout wait.
 */
function reportPrintFailure(kind, result) {
    let connectionType = 'unknown';
    try {
        connectionType = getPrinterConfig()?.connection_type || 'unknown';
    }
    catch { /* best-effort only */ }
    const failureClass = result.failureClass || classifyPrintFailure(result.detail);
    void (0, telemetry_1.sendEvent)('print_failed', {
        kind,
        code: result.code,
        stage: result.stage,
        connection_type: connectionType,
        correlation_id: result.correlationId,
        failure_class: failureClass,
        ...(result.platformErrorCode !== undefined ? { platform_error_code: result.platformErrorCode } : {}),
        ...(result.jobId !== undefined ? { job_id: result.jobId } : {}),
    });
    try {
        const message = hasFinancialPrintWarning(result.warnings || [])
            ? FINANCIAL_PRINT_REFUSAL_DIAGNOSTIC
            : (result.detail || `${kind} print failed at ${result.stage} stage`).slice(0, 300);
        cloud_sync_1.cloudSync.reportDiagnostic({
            event_id: (0, crypto_1.randomUUID)(),
            event_code: result.code || `print.${kind}.failed`,
            severity: 'error',
            correlation_id: result.correlationId,
            message,
            metadata: {
                connection_type: connectionType,
                kind,
                os_platform: process.platform,
                failure_class: failureClass,
                ...(result.platformErrorCode !== undefined ? { platform_error_code: result.platformErrorCode } : {}),
                ...(result.jobId !== undefined ? { job_id: result.jobId } : {}),
                ...(result.driverName ? { driver_name: result.driverName.slice(0, 160) } : {}),
                ...(result.printerStatus !== undefined ? { printer_status: result.printerStatus } : {}),
            },
            occurred_at: new Date().toISOString(),
        });
    }
    catch (err) {
        // Never let a diagnostics-plumbing error (e.g. a mid-migration DB) turn a
        // printer failure into an unhandled rejection — the caller must still get
        // back the real PrintResult so the cashier sees the actual printer error.
        console.error('[Printer] reportDiagnostic failed (non-fatal):', err);
    }
}
/** Typed adapters used by API callers while legacy boolean callers migrate. */
async function printReceiptDetailed(...args) {
    const id = (0, errors_1.correlationId)();
    try {
        const dispatch = await printReceipt(...args);
        const stage = !dispatch.ok && hasFinancialPrintWarning(dispatch.warnings || []) ? 'prepare' : 'dispatch';
        const result = dispatch.ok
            ? { ok: true, correlationId: id, stage: 'dispatch', warnings: dispatch.warnings }
            : {
                ok: false,
                code: 'print.receipt.failed',
                correlationId: id,
                stage,
                detail: dispatch.detail,
                failureClass: dispatch.failureClass || classifyPrintFailure(dispatch.detail),
                platformErrorCode: dispatch.platformErrorCode || extractPlatformErrorCode(dispatch.detail),
                jobId: dispatch.jobId,
                driverName: dispatch.driverName,
                printerStatus: dispatch.printerStatus,
                warnings: dispatch.warnings,
            };
        if (!result.ok)
            reportPrintFailure('receipt', result);
        return result;
    }
    catch (error) {
        const detail = error.message;
        const result = { ok: false, code: 'print.receipt.failed', correlationId: id, stage: 'dispatch', detail, failureClass: classifyPrintFailure(detail), platformErrorCode: extractPlatformErrorCode(detail) };
        reportPrintFailure('receipt', result);
        return result;
    }
}
async function printKOTDetailed(...args) {
    const id = (0, errors_1.correlationId)();
    try {
        const dispatch = await printKOT(...args);
        const result = dispatch.ok
            ? { ok: true, correlationId: id, stage: 'dispatch', warnings: dispatch.warnings }
            : {
                ok: false,
                code: 'print.kot.failed',
                correlationId: id,
                stage: 'dispatch',
                detail: dispatch.detail,
                failureClass: dispatch.failureClass || classifyPrintFailure(dispatch.detail),
                platformErrorCode: dispatch.platformErrorCode || extractPlatformErrorCode(dispatch.detail),
                jobId: dispatch.jobId,
                driverName: dispatch.driverName,
                printerStatus: dispatch.printerStatus,
                warnings: dispatch.warnings,
            };
        if (!result.ok)
            reportPrintFailure('kot', result);
        return result;
    }
    catch (error) {
        const detail = error.message;
        const result = { ok: false, code: 'print.kot.failed', correlationId: id, stage: 'dispatch', detail, failureClass: classifyPrintFailure(detail), platformErrorCode: extractPlatformErrorCode(detail) };
        reportPrintFailure('kot', result);
        return result;
    }
}
function getColumnsForPrinter(printer, profile) {
    const paperWidth = printer.paper_width || profile.defaultPaperWidth || '80mm';
    const explicitColumns = columnsForPaperWidth(paperWidth);
    if (explicitColumns)
        return explicitColumns;
    return profile.fontAColumns || 48;
}
function columnsForPaperWidth(paperWidth) {
    const colsMatch = String(paperWidth || '').match(/^cols-(3[2-9]|4[0-8])$/);
    if (colsMatch)
        return Number(colsMatch[1]);
    switch (paperWidth) {
        case '58mm':
            return 32;
        case '58mm-36':
            return 36;
        case '80mm-42':
            return 42;
        case '80mm':
            return null;
        default:
            return null;
    }
}
async function dispatchPrint(printer, data, signal) {
    switch (printer.connection_type) {
        case 'network':
            return await printViaNetwork(printer.ip_address, printer.port || 9100, data, signal);
        case 'usb':
            if (isMasBuild) {
                if (process.platform === 'darwin') {
                    return await printViaLocalIpp(data, printer.name, signal);
                }
                const detail = 'USB printers are not supported in the App Store build. Use a network printer.';
                console.log(`[Printer] ${detail}`);
                return { ok: false, detail };
            }
            return await printViaUSB(data, printer.name, signal);
        case 'webusb':
            console.log('[Printer] WebUSB printer — not supported in Electron');
            return { ok: false, detail: 'WebUSB printers are handled in the browser, not by the desktop app' };
        default:
            console.log(`[Printer] Unsupported connection type: ${printer.connection_type}`);
            return { ok: false, detail: `Unsupported connection type: ${printer.connection_type}` };
    }
}
function getPrinterConfig() {
    const db = (0, db_1.getDatabase)();
    return db.prepare(`SELECT * FROM printers
     WHERE connection_type != 'webusb'
     ORDER BY is_default DESC, name
     LIMIT 1`).get();
}
function prepareReceipt(order, bill, business, template = 'classic', useUnicode = false, isReprint = false, arabicShapingOverride, language, additionalLanguage) {
    let printer = getPrinterConfig();
    if (!printer) {
        printer = {
            id: 0,
            name: 'Default 80mm Preview',
            paper_width: '80mm',
        };
    }
    const profile = (0, profiles_1.resolvePrinterProfile)(printer);
    const columns = getColumnsForPrinter(printer, profile);
    const warnings = [];
    // A request-body override (from the renderer's global shaping setting)
    // wins over the profile default (#437); absent override keeps the
    // profile's declared capability.
    const capabilities = (0, profiles_1.getPrinterCapabilities)(profile, arabicShapingOverride);
    const data = formatReceipt(order, bill, business, template, columns, useUnicode, isReprint, profile.cutMode, warnings, capabilities.shaping.arabic, language, additionalLanguage, capabilities);
    return { printer, data, warnings, columns };
}
function formatReceipt(order, bill, business, template, cols = 48, useUnicode = false, isReprint = false, cutMode = 'full', warnings, arabicShaping = false, language, additionalLanguage, capabilities) {
    console.log('[Printer] formatReceipt - template:', template);
    console.log('[Printer] formatReceipt - order:', order?.order_number, 'bill:', bill?.bill_number);
    console.log('[Printer] formatReceipt - items count:', order?.items?.length || 0, 'cols:', cols);
    const lang = normalizePrintLanguage(language);
    const biz = business || { name: 'Store', address: '', phone: '', taxRegistrationNumber: '' };
    // Structured selection identity (#447): the persisted bill_template value
    // may be a structured { source, id } JSON string or any legacy bare value.
    // Merchant templates resolve through the document pipeline; pack templates
    // keep their compliance renderer; unknown values fall through to the core
    // classic/compact name matching below (unchanged behavior).
    const selection = (0, print_templates_1.parseBillTemplateSelection)(template);
    if (selection?.source === 'pack') {
        return renderPluginReceipt((0, print_templates_1.loadInstalledPrintTemplate)(selection.id), order, bill, biz, cols, useUnicode, isReprint, cutMode, warnings, arabicShaping, lang, capabilities);
    }
    if (selection?.source === 'merchant') {
        const result = (0, document_merchant_1.renderMerchantReceiptViaDocument)(order, bill, biz, selection.id, {
            columns: cols,
            language: lang,
            ...(additionalLanguage !== undefined ? { additionalLanguage: normalizePrintLanguage(additionalLanguage) } : {}),
            isReprint,
            useUnicode,
            arabicShaping,
            cutMode,
            capabilities,
        });
        if (warnings && result.warnings.length > 0)
            warnings.push(...result.warnings);
        return result.data;
    }
    const tpl = normalizeReceiptTemplate(selection?.source === 'core' ? selection.id : template);
    try {
        switch (tpl) {
            case 'classic':
                return formatClassicReceipt(order, bill, biz, cols, useUnicode, isReprint, cutMode, warnings, arabicShaping, lang, additionalLanguage, capabilities);
            default:
                return formatCompactReceipt(order, bill, biz, cols, useUnicode, isReprint, cutMode, warnings, arabicShaping, lang, additionalLanguage, capabilities);
        }
    }
    catch (err) {
        console.error('[Printer] formatReceipt error:', err);
        throw err;
    }
}
function normalizeReceiptTemplate(template) {
    const normalized = String(template || 'classic').toLowerCase().replace(/[^a-z]/g, '');
    if (normalized.includes('compact') || normalized.includes('minimal'))
        return 'compact';
    return 'classic';
}
function renderPluginReceipt(template, order, bill, biz, cols, useUnicode, isReprint, cutMode, warnings, arabicShaping = false, lang = 'en', capabilities) {
    if (!template)
        return formatClassicReceipt(order, bill, biz, cols, useUnicode, isReprint, cutMode, warnings, arabicShaping, lang, undefined, capabilities);
    const renderer = parseJson(template.renderer_json, {});
    const payload = parseJson(template.template_payload_json, {});
    if (renderer.id !== 'flocafe-thermal-receipt-template'
        || renderer.version !== 1
        || payload.format !== 'escpos-line-template-v1') {
        throw new Error(`Unsupported receipt plugin renderer for template ${template.template_id}`);
    }
    const profile = selectTemplateWidthProfile(payload, cols, warnings);
    return renderEscposLineTemplateV1(payload, profile, order, bill, biz, useUnicode, isReprint, cutMode, warnings, arabicShaping, lang, capabilities);
}
function parseJson(raw, fallback) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
function selectTemplateWidthProfile(payload, printerColumns, warnings) {
    const profiles = collectTemplateWidthProfiles(payload);
    const exact = profiles.find((profile) => profile.columns === printerColumns);
    if (exact)
        return exact;
    const smaller = profiles.filter((profile) => profile.columns < printerColumns).sort((a, b) => b.columns - a.columns)[0];
    if (smaller)
        return smaller;
    warnings?.push({
        field: 'bill_template_width',
        text: String(printerColumns),
        message: `Template has no ${printerColumns}-column profile; rendered with the printer width instead of squeezing a wider profile.`,
    });
    return { columns: printerColumns, layout: {} };
}
function collectTemplateWidthProfiles(payload) {
    if (!Array.isArray(payload?.widthProfiles))
        return [];
    return payload.widthProfiles
        .map((profile) => ({
        columns: Number(profile?.columns),
        layout: profile?.layout && typeof profile.layout === 'object' ? profile.layout : {},
    }))
        .filter((profile) => Number.isInteger(profile.columns) && profile.columns >= 32 && profile.columns <= 48)
        .sort((a, b) => a.columns - b.columns);
}
function renderEscposLineTemplateV1(payload, profile, order, bill, biz, useUnicode, isReprint, cutMode, warnings, arabicShaping = false, lang = 'en', capabilities) {
    const lines = [];
    const cols = profile.columns;
    const layout = profile.layout || {};
    const date = (0, db_1.parseDbTimestamp)(order.created_at);
    const bar = '='.repeat(cols);
    const dash = '-'.repeat(cols);
    const prefix = resolveCurrencyPrefix(biz.currency_symbol || '₹', useUnicode, capabilities);
    const fractionDigits = (0, countries_1.getCurrencyFractionDigits)(biz.currency || 'INR');
    const trimDecimals = biz.trim_decimals === true;
    const locale = (0, countries_1.getCountryByCode)(biz.country)?.locale ?? 'en-US';
    const normalize = (text) => normalizeThermalText(text, capabilities);
    const configuredTaxLabel = normalize((0, template_labels_1.sanitizeTemplateLabelText)(String(payload?.fields?.taxRegistrationNumberLabel || (0, countries_1.getCountryByCode)(biz.country)?.taxIdLabel || 'Tax ID')));
    const taxComponents = (0, tax_components_1.resolveTaxComponents)({ ...bill, items: order.items });
    const hasTax = Number(bill.tax_amount) !== 0
        || taxComponents.some((component) => component.amount !== 0);
    // Pack-supplied strings (#445 review): sanitized against reserved printer
    // tokens ({CUT}/{FEED}/{INIT} and styling braces) and clamped to the selected
    // width profile before they reach the receipt builder; the localized resolver
    // fallback applies the same treatment.
    const title = hasTax
        ? (0, template_labels_1.fitTemplateLabel)(normalize(String(payload?.header?.taxTitleWhenTaxPresent || '')), cols) || (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'taxInvoice', lang)), cols)
        : (0, template_labels_1.fitTemplateLabel)(normalize(String(payload?.header?.titleWhenTaxAbsent || '')), cols) || (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'invoice', lang)), cols);
    const tzOptions = biz.timezone ? { timeZone: biz.timezone } : undefined;
    lines.push('{INIT}');
    if (isReprint)
        lines.push('{CENTER}{BOLD}{DOUBLE_HEIGHT}{DOUBLE_WIDTH}** ' + normalize((0, print_labels_generated_1.printLabel)(lang, 'receipt.reprint')) + ' **{/DOUBLE_WIDTH}{/DOUBLE_HEIGHT}{/BOLD}{/CENTER}');
    if (biz.show_name !== false && biz.name) {
        const name = payload?.header?.businessNameTransform === 'uppercase'
            ? String(biz.name).toUpperCase()
            : String(biz.name);
        lines.push('{STORE_NAME}{CENTER}{BOLD}' + truncateShapedLine(name, cols, arabicShaping, lang, capabilities) + '{/BOLD}{/CENTER}');
    }
    lines.push(bar);
    lines.push(`{CENTER}${title}{/CENTER}`);
    lines.push(bar);
    lines.push(normalize((0, print_labels_generated_1.printLabel)(lang, 'print.invoiceNumber')) + ' ' + (bill.bill_number || order.order_number));
    lines.push(normalize((0, print_labels_generated_1.printLabel)(lang, 'receipt.date')) + ': ' + date.toLocaleDateString(locale + '-u-nu-latn', tzOptions));
    lines.push(normalize((0, print_labels_generated_1.printLabel)(lang, 'print.time')) + ': ' + date.toLocaleTimeString(locale + '-u-nu-latn', tzOptions));
    if (biz.show_table_number !== false && order.table?.name)
        lines.push(truncateShapedLine(formatTableLabel(order.table.name, lang), cols, arabicShaping, lang, capabilities));
    if (biz.show_customer_name !== false && biz.customer_name)
        lines.push(truncateShapedLine((0, print_labels_generated_1.printLabel)(lang, 'pos.customer') + ': ' + biz.customer_name, cols, arabicShaping, lang, capabilities));
    if (biz.show_customer_phone !== false && biz.customer_phone)
        lines.push(normalize((0, print_labels_generated_1.printLabel)(lang, 'print.numberShort')) + ': ' + biz.customer_phone);
    lines.push(dash);
    lines.push(pluginItemHeader(layout, cols, lang, capabilities));
    lines.push(dash);
    if (order.items) {
        for (const item of order.items) {
            lines.push(...pluginItemRows(item, layout, cols, prefix, locale, trimDecimals, fractionDigits, lang, capabilities));
            if (pluginDetailLines(layout).includes('addons')) {
                for (const addon of parseAddons(item.addons)) {
                    const addonLines = [];
                    pushWrapped(addonLines, '  + ' + addon.name + (addon.price ? ' ' + formatCurrency(addon.price, prefix, locale, trimDecimals, fractionDigits) : ''), cols, lang, capabilities);
                    lines.push(...addonLines.map((line) => addon.price ? '{FINANCIAL}' + line : line));
                }
            }
            if (pluginDetailLines(layout).includes('specialInstructions') && item.special_instructions) {
                pushWrapped(lines, '  ' + normalize((0, print_labels_generated_1.printLabel)(lang, 'print.note')) + ': ' + item.special_instructions, cols, lang, capabilities);
            }
        }
    }
    lines.push(dash);
    // Row labels share their line with a right-aligned amount, so they are
    // clamped to the width profile minus the same 12-column amount reserve the
    // payment-method rows already use; title/footer labels clamp to the full
    // width (#445 review F2).
    const rowLabelWidth = Math.max(8, cols - 12);
    if (payload?.totals?.showSubtotal !== false) {
        const label = (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'subtotal', lang)), rowLabelWidth);
        lines.push(...financialRows(label, formatCurrency(bill.subtotal, prefix, locale, trimDecimals, fractionDigits), cols, lang, capabilities));
    }
    if (Number(bill.discount_amount) > 0 && payload?.totals?.showDiscount !== false) {
        const label = (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'discount', lang)), rowLabelWidth);
        lines.push(...financialRows(label, '-' + formatCurrency(bill.discount_amount, prefix, locale, trimDecimals, fractionDigits), cols, lang, capabilities));
    }
    if (biz.show_tax_breakdown !== false && taxComponents.length > 0) {
        for (const tax of taxComponents) {
            if (tax.amount === 0)
                continue;
            const rawLabel = tax.rate === null ? tax.title : `${tax.title} @${tax.rate}%`;
            lines.push(pluginSummaryRow(rawLabel, formatCurrency(tax.amount, prefix, locale, trimDecimals, fractionDigits), layout, cols, lang, capabilities));
        }
    }
    else if (Number(bill.tax_amount) !== 0) {
        const label = (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'tax', lang)), rowLabelWidth);
        lines.push(...financialRows(label, formatCurrency(bill.tax_amount, prefix, locale, trimDecimals, fractionDigits), cols, lang, capabilities));
    }
    // `chargeRows` is an explicit capability declaration. Its order is not
    // presentation authority: country/legal rows remain in this stable order,
    // and zero-valued persisted charges stay absent.
    const chargeAmounts = {
        serviceCharge: Number(bill.service_charge) || 0,
        deliveryCharge: Number(bill.delivery_charge) || 0,
        packagingCharge: Number(bill.packaging_charge) || 0,
    };
    for (const row of (0, template_labels_1.declaredTemplateChargeRows)(payload?.totals?.chargeRows)) {
        const amount = chargeAmounts[row];
        if (amount === 0)
            continue;
        const label = (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, row, lang)), rowLabelWidth);
        lines.push(...financialRows(label, formatCurrency(amount, prefix, locale, trimDecimals, fractionDigits), cols, lang, capabilities));
    }
    lines.push(bar);
    // Label precedence (#445): the author's structural literal (e.g.
    // totals.grandTotalLabel) is most specific and wins first; the additive
    // payload-root `labels` map overrides next; otherwise the built-in default
    // resolves localized through the canonical print-labels catalog (#440).
    const totalLabel = (0, template_labels_1.fitTemplateLabel)(normalize(String(payload?.totals?.grandTotalLabel || '')), rowLabelWidth) || (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'total', lang)), rowLabelWidth);
    lines.push(...financialRows(totalLabel, formatCurrency(bill.total, prefix, locale, trimDecimals, fractionDigits), cols, lang, capabilities).map((line) => `{BOLD}${line}{/BOLD}`));
    if (bill.payment_details) {
        lines.push(dash);
        try {
            const payments = typeof bill.payment_details === 'string' ? JSON.parse(bill.payment_details) : bill.payment_details;
            if (payments && Array.isArray(payments)) {
                for (const payment of payments) {
                    if (payment && payment.method) {
                        const methodLabel = truncate(resolvePaymentMethodLabel(String(payment.method), lang), cols - 12, lang, capabilities);
                        lines.push(...financialRows(methodLabel, formatCurrency(payment.amount, prefix, locale, trimDecimals, fractionDigits), cols, lang, capabilities));
                    }
                }
            }
        }
        catch (err) {
            console.warn('[Printer] Failed to parse payment details JSON:', err.message);
        }
    }
    lines.push(bar);
    if (biz.show_address !== false && biz.address)
        pushWrapped(lines, normalize((0, print_labels_generated_1.printLabel)(lang, 'print.address')) + ': ' + biz.address, cols, lang, capabilities);
    if (biz.show_phone !== false && biz.phone)
        pushWrapped(lines, normalize((0, print_labels_generated_1.printLabel)(lang, 'print.phoneLong')) + ': ' + biz.phone, cols, lang, capabilities);
    const showTaxRegistration = payload?.totals?.showTaxRegistrationNumber === 'when_tax_present_or_enabled'
        ? (hasTax || biz.show_tax_id === true)
        : biz.show_tax_id === true;
    if (showTaxRegistration && biz.taxRegistrationNumber)
        pushWrapped(lines, configuredTaxLabel + ': ' + biz.taxRegistrationNumber, cols, lang, capabilities);
    if (payload?.footer?.useConfiguredFooterNote !== false && biz.footer_note)
        pushCenteredWrapped(lines, biz.footer_note, cols, lang, capabilities);
    else
        lines.push('{CENTER}' + ((0, template_labels_1.fitTemplateLabel)(normalize(String(payload?.footer?.defaultMessage || '')), cols) || (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'footerThanks', lang)), cols)) + '{/CENTER}');
    if (payload?.footer?.includePoweredByFloPOS !== false)
        appendPoweredByFooter(lines);
    lines.push('{CUT}');
    return buildEscPos(lines, useUnicode, { cutMode, arabicShaping, columns: cols, language: lang, capabilities }, warnings);
}
function appendPoweredByFooter(lines) {
    lines.push('{CENTER}{FONT_B}' + RECEIPT_BRANDING_NAME + '{/FONT_B}{/CENTER}');
    lines.push('{CENTER}{FONT_B}' + RECEIPT_BRANDING_URL + '{/FONT_B}{/CENTER}');
}
/**
 * Compact thermal receipt (#443): builds a PrintDocument from normalized
 * print data and renders it through the document pipeline (document-compact).
 */
function formatCompactReceipt(order, bill, biz, cols = 48, useUnicode = false, isReprint = false, cutMode = 'full', warnings, arabicShaping = false, lang = 'en', additionalLanguage, capabilities) {
    const result = (0, document_compact_1.renderCompactReceiptViaDocument)(order, bill, biz, {
        columns: cols,
        language: lang,
        ...(additionalLanguage !== undefined ? { additionalLanguage } : {}),
        isReprint,
        useUnicode,
        arabicShaping,
        cutMode,
        capabilities,
    });
    if (warnings && result.warnings.length > 0)
        warnings.push(...result.warnings);
    return result.data;
}
/**
 * Classic thermal receipt (#443): builds a PrintDocument from normalized
 * print data and renders it through the document pipeline (document-classic).
 * Token-line emission stays an implementation detail of the ESC/POS renderer.
 */
function formatClassicReceipt(order, bill, biz, cols = 48, useUnicode = false, isReprint = false, cutMode = 'full', warnings, arabicShaping = false, lang = 'en', additionalLanguage, capabilities) {
    const result = (0, document_classic_1.renderClassicReceiptViaDocument)(order, bill, biz, {
        columns: cols,
        language: lang,
        ...(additionalLanguage !== undefined ? { additionalLanguage } : {}),
        isReprint,
        useUnicode,
        arabicShaping,
        cutMode,
        capabilities,
    });
    if (warnings && result.warnings.length > 0)
        warnings.push(...result.warnings);
    return result.data;
}
function pluginLineItemColumns(layout, cols, lang = 'en', capabilities) {
    const configured = layout?.lineItems?.columns;
    if (Array.isArray(configured) && configured.length > 0) {
        const columns = configured
            .map((column) => ({
            key: typeof column?.key === 'string' ? column.key : undefined,
            label: typeof column?.label === 'string'
                ? normalizeThermalText(column.label, capabilities)
                : undefined,
            width: Number(column?.width),
            align: column?.align === 'right' || column?.align === 'center' ? column.align : 'left',
            wrap: column?.wrap === true,
            maxLines: Number.isInteger(column?.maxLines) && column.maxLines > 0 ? column.maxLines : undefined,
            ellipsis: column?.ellipsis !== false,
        }))
            .filter((column) => column.key && Number.isInteger(column.width) && Number(column.width) > 0);
        if (columns.length > 0)
            return columns;
    }
    return [
        { key: 'item', label: normalizeThermalText((0, print_labels_generated_1.printLabel)(lang, 'receipt.item'), capabilities), width: itemNameWidth(cols, 10), align: 'left', wrap: true, maxLines: 2, ellipsis: true },
        { key: 'quantity', label: normalizeThermalText((0, print_labels_generated_1.printLabel)(lang, 'receipt.qty'), capabilities), width: 4, align: 'left' },
        { key: 'amount', label: normalizeThermalText((0, print_labels_generated_1.printLabel)(lang, 'receipt.amount'), capabilities), width: 10, align: 'right' },
    ];
}
function pluginLineGap(layout) {
    const gap = Number(layout?.lineItems?.gap);
    return Number.isInteger(gap) && gap >= 0 && gap <= 4 ? gap : 0;
}
function pluginDetailLines(layout) {
    const detailLines = layout?.lineItems?.detailLines;
    if (!Array.isArray(detailLines))
        return ['addons', 'specialInstructions'];
    return detailLines.filter((line) => typeof line === 'string');
}
function pluginItemHeader(layout, cols, lang = 'en', capabilities) {
    return composePluginColumns(pluginLineItemColumns(layout, cols, lang, capabilities).map((column) => ({
        ...column,
        value: column.label || column.key || '',
    })), pluginLineGap(layout), cols);
}
function pluginItemRows(item, layout, cols, prefix, locale, trimDecimals, fractionDigits, lang = 'en', capabilities) {
    const columns = pluginLineItemColumns(layout, cols, lang, capabilities);
    const gap = pluginLineGap(layout);
    const values = columns.map((column) => ({
        ...column,
        value: normalizeThermalText(pluginItemColumnValue(column.key || '', item, prefix, locale, trimDecimals, fractionDigits), capabilities),
    }));
    const wrappedValues = values.map((column) => {
        if (!column.wrap)
            return [truncateCell(column.value, Number(column.width), column.ellipsis !== false)];
        const maxLines = column.maxLines || 2;
        const wrapped = wrapText(column.value, Number(column.width));
        const limited = wrapped.slice(0, maxLines);
        if (wrapped.length > maxLines && limited.length > 0 && column.ellipsis !== false) {
            limited[limited.length - 1] = truncateCell(limited[limited.length - 1], Number(column.width), true);
        }
        return limited.length > 0 ? limited : [''];
    });
    const lineCount = Math.max(1, ...wrappedValues.map((value) => value.length));
    const rows = [];
    for (let index = 0; index < lineCount; index++) {
        rows.push('{FINANCIAL}' + composePluginColumns(values.map((column, columnIndex) => ({
            ...column,
            value: wrappedValues[columnIndex][index] || '',
        })), gap, cols));
    }
    return rows;
}
function pluginItemColumnValue(key, item, prefix, locale, trimDecimals, fractionDigits) {
    switch (key) {
        case 'item':
            return String(item.product_name || '');
        case 'quantity':
            return String(item.quantity ?? '');
        case 'rate': {
            const quantity = Number(item.quantity) || 0;
            const rate = Number(item.unit_price ?? item.price ?? (quantity ? Number(item.total) / quantity : 0));
            return formatCurrency(rate, prefix, locale, trimDecimals, fractionDigits);
        }
        case 'taxRate':
            return pluginItemTaxRate(item);
        case 'amount':
            return formatCurrency(item.total, prefix, locale, trimDecimals, fractionDigits);
        default:
            return '';
    }
}
function pluginItemTaxRate(item) {
    const rates = new Set();
    const breakdown = Array.isArray(item.tax_breakdown) ? item.tax_breakdown : [];
    for (const component of breakdown) {
        if (component?.rate !== null && component?.rate !== undefined)
            rates.add(String(component.rate));
    }
    return [...rates].join('+');
}
function pluginSummaryRow(label, amount, layout, cols, lang = 'en', capabilities) {
    const normalizedLabel = normalizeThermalText(label, capabilities);
    const labelWidth = Number(layout?.taxSummary?.labelWidth);
    const amountWidth = Number(layout?.taxSummary?.amountWidth);
    if (Number.isInteger(labelWidth) && Number.isInteger(amountWidth) && labelWidth > 0 && amountWidth > 0) {
        return '{FINANCIAL}' + composePluginColumns([
            { value: normalizedLabel, width: labelWidth, align: 'left', ellipsis: true },
            { value: amount, width: amountWidth, align: 'right', ellipsis: true },
        ], Math.max(0, cols - labelWidth - amountWidth), cols);
    }
    const safeLabel = truncate(normalizedLabel, cols - 12, lang, capabilities);
    return '{FINANCIAL}' + safeLabel + rightAlign(amount, cols - safeLabel.length);
}
function composePluginColumns(columns, gap, cols) {
    const separator = ' '.repeat(gap);
    const line = columns.map((column) => alignCell(truncateCell(column.value, Number(column.width), column.ellipsis !== false), Number(column.width), column.align || 'left')).join(separator);
    return truncateCell(line, cols, false).padEnd(Math.min(cols, line.length));
}
function alignCell(value, width, align) {
    const text = truncateCell(value, width, true);
    if (align === 'right')
        return text.padStart(width);
    if (align === 'center') {
        const left = Math.floor((width - text.length) / 2);
        return ' '.repeat(Math.max(0, left)) + text.padEnd(Math.max(0, width - left));
    }
    return text.padEnd(width);
}
function truncateCell(text, length, ellipsis) {
    const value = String(text || '');
    if (length <= 0)
        return '';
    if (value.length <= length)
        return value;
    if (!ellipsis || length <= 2)
        return value.slice(0, length);
    return value.slice(0, length - 2) + '..';
}
// Item row layout: [ name (nameLen) ][ qty (4) ][ amount right-aligned (amtLen) ].
// Item rows keep [ name ][ qty ][ amount ] inline when the value fits; an
// oversized amount continues on full-width lines. Tax components belong in
// the document-level breakdown, not a redundant per-item column derived from
// deprecated product tax fields.
function itemNameWidth(cols, amtLen) {
    return Math.max(1, cols - 4 - amtLen);
}
function itemAmountWidth(order, prefix, locale, trimDecimals, cols, fractionDigits = 2) {
    // rightAlign() keeps at least one separator before an amount, so reserve
    // that separator when a long currency prefix expands the amount column.
    let width = 10;
    for (const item of order?.items ?? []) {
        width = Math.max(width, formatCurrency(item.total ?? 0, prefix, locale, trimDecimals, fractionDigits).length + 1);
        for (const addon of parseAddons(item.addons)) {
            if (addon?.price) {
                width = Math.max(width, formatCurrency(addon.price, prefix, locale, trimDecimals, fractionDigits).length + 1);
            }
        }
    }
    return Math.min(width, Math.max(1, cols - 5));
}
function itemRows(item, nameLen, amtLen, cols, prefix, locale = 'en-US', trimDecimals = false, language = 'en', fractionDigits = 2, capabilities) {
    const qtyW = 4;
    const productName = normalizeThermalText(item.product_name, capabilities);
    const name = truncate(productName, nameLen, language, capabilities).padEnd(nameLen);
    const qty = String(item.quantity).padEnd(qtyW);
    const label = name + qty;
    const amount = formatCurrency(item.total, prefix, locale, trimDecimals, fractionDigits);
    const inlineWidth = Math.max(1, cols - label.length - 1);
    if (amount.length <= inlineWidth)
        return ['{FINANCIAL}' + label + rightAlign(amount, cols - label.length)];
    return ['{FINANCIAL}' + label.trimEnd(), ...wrapValue(amount, cols).map((line) => '{FINANCIAL}' + line)];
}
function addonRows(addon, nameLen, amtLen, cols, prefix, locale = 'en-US', trimDecimals = false, language = 'en', fractionDigits = 2, capabilities) {
    const addonName = normalizeThermalText(addon.name, capabilities);
    const quantity = typeof addon.quantity === 'number' && addon.quantity > 1 ? ` x${addon.quantity}` : '';
    const label = truncate('  + ' + addonName + quantity, nameLen, language, capabilities).padEnd(nameLen);
    if (!addon.price)
        return [label + ' '.repeat(Math.max(0, cols - label.length))];
    const price = formatCurrency(addon.price, prefix, locale, trimDecimals, fractionDigits);
    const inlineWidth = Math.max(1, cols - label.length - 1);
    if (price.length <= inlineWidth)
        return ['{FINANCIAL}' + label + rightAlign(price, cols - label.length)];
    return ['{FINANCIAL}' + label.trimEnd(), ...wrapValue(price, cols).map((line) => '{FINANCIAL}' + line)];
}
function financialRows(label, value, cols, _language = 'en', capabilities) {
    const normalizedLabel = normalizeThermalText(label, capabilities);
    const safeLabel = normalizedLabel.slice(0, Math.max(1, cols - 1));
    const inlineWidth = Math.max(1, cols - safeLabel.length - 1);
    if (value.length <= inlineWidth) {
        return ['{FINANCIAL}' + safeLabel + rightAlign(value, cols - safeLabel.length)];
    }
    return ['{FINANCIAL}' + safeLabel, ...wrapValue(value, cols).map((line) => '{FINANCIAL}' + line)];
}
function wrapValue(value, cols) {
    const width = Math.max(1, cols);
    const lines = [];
    for (let offset = 0; offset < value.length; offset += width) {
        lines.push(value.slice(offset, offset + width));
    }
    return lines.length > 0 ? lines : [''];
}
function parseAddons(addons) {
    return Array.isArray(addons) ? addons : [];
}
function getSafeLatnLocale(locale) {
    if (!locale)
        return 'en-US-u-nu-latn';
    if (/-nu-[a-z0-9]+/i.test(locale)) {
        return locale.replace(/-nu-[a-z0-9]+/i, '-nu-latn');
    }
    if (locale.includes('-u-')) {
        return `${locale}-nu-latn`;
    }
    return `${locale}-u-nu-latn`;
}
function formatCurrency(amount, prefix, locale = 'en-US', trimDecimals = false, fractionDigits = 2) {
    const numeric = Number(amount) || 0;
    const factor = 10 ** fractionDigits;
    const hasDecimals = Math.round(numeric * factor) % factor !== 0;
    const safeLocale = getSafeLatnLocale(locale);
    const formattedNum = numeric.toLocaleString(safeLocale, {
        minimumFractionDigits: trimDecimals && !hasDecimals ? 0 : fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).replace(/[\u00A0\u202F]/g, ' ');
    return prefix + formattedNum;
}
function rightAlign(text, width = 24) {
    return ' '.repeat(Math.max(1, width - text.length)) + text;
}
function truncate(text, length, _language = 'en', capabilities) {
    const normalizedText = normalizeThermalText(text, capabilities);
    return normalizedText.length > length ? normalizedText.substring(0, length - 2) + '..' : normalizedText;
}
function truncateShapedLine(text, length, arabicShaping, language = 'en', capabilities) {
    const normalizedText = normalizeThermalText(text, capabilities);
    return arabicShaping && hasArabicScript(normalizedText) ? truncate(normalizedText, Math.max(1, length), language, capabilities) : normalizedText;
}
/**
 * Receipt label language resolution (#440). Unknown or ungenerated languages
 * fall back to English so receipts always render real labels.
 */
function normalizePrintLanguage(language) {
    return language && (0, print_labels_generated_1.isGeneratedPrintLanguage)(language) ? language : 'en';
}
const PAYMENT_METHOD_CONCEPTS = {
    cash: 'pos.methodCash',
    card: 'pos.methodCard',
    wallet: 'pos.methodWallet',
};
/** Ported from web-print.ts (#440): known methods localize; unknown keep the capitalize fallback. */
function resolvePaymentMethodLabel(method, lang) {
    const concept = PAYMENT_METHOD_CONCEPTS[String(method || '').toLowerCase()];
    if (concept)
        return (0, print_labels_generated_1.printLabel)(lang, concept);
    return capitalize(String(method || ''));
}
/** pos.tableLabel carries an ICU {name} placeholder; backend rendering swaps it inline. */
function formatTableLabel(tableName, lang) {
    return (0, print_labels_generated_1.printLabel)(lang, 'pos.tableLabel').replace('{name}', tableName);
}
function capitalize(text) {
    return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
function wrapText(text, cols) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    for (const word of words) {
        if (word.length > cols) {
            if (current) {
                lines.push(current);
                current = '';
            }
            for (let i = 0; i < word.length; i += cols) {
                lines.push(word.slice(i, i + cols));
            }
            continue;
        }
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= cols) {
            current = candidate;
        }
        else {
            if (current)
                lines.push(current);
            current = word;
        }
    }
    if (current)
        lines.push(current);
    return lines.length > 0 ? lines : [''];
}
function pushWrapped(lines, text, cols, _language = 'en', capabilities) {
    const normalized = normalizeThermalText(text, capabilities);
    for (const line of wrapText(normalized, cols))
        lines.push(line);
}
function pushCenteredWrapped(lines, text, cols, _language = 'en', capabilities) {
    const normalized = normalizeThermalText(text, capabilities);
    for (const line of wrapText(normalized, cols))
        lines.push('{CENTER}' + line + '{/CENTER}');
}
/**
 * Kitchen order ticket (#443): builds a KotDocument (single-language policy
 * resolved by the caller through the kernel) and renders it via the document
 * pipeline (document-kot).
 */
function formatKOT(order, items, stationName, cols = 48, useUnicode = false, cutMode = 'full', locale = 'en-US', tzOptions, warnings, arabicShaping = false, language, capabilities) {
    const lang = normalizePrintLanguage(language);
    const result = (0, document_kot_1.renderKotViaDocument)(order, items, stationName, {
        columns: cols,
        language: lang,
        ...(locale ? { locale } : {}),
        ...(tzOptions?.timeZone ? { timezone: String(tzOptions.timeZone) } : {}),
        useUnicode,
        arabicShaping,
        cutMode,
        capabilities,
    });
    if (warnings && result.warnings.length > 0)
        warnings.push(...result.warnings);
    return result.data;
}
function buildTestPage(paperWidth = '80mm', cutMode = 'full', language, timezone) {
    const width = columnsForPaperWidth(paperWidth) || 48;
    const lang = normalizePrintLanguage(language);
    const label = (concept) => normalizeThermalText((0, print_labels_generated_1.printLabel)(lang, concept));
    const bar = '='.repeat(width);
    const ruler = Array.from({ length: width }, (_, i) => String((i + 1) % 10)).join('');
    const edgeProbe = 'X'.repeat(width);
    const lines = [
        '{INIT}',
        '{CENTER}{BOLD}' + label('print.test.title') + '{/BOLD}{/CENTER}',
        '',
        bar,
        '{CENTER}' + label('print.test.networkUsb') + '{/CENTER}',
        bar,
        '',
        `${label('print.test.columns')}: ${width}`,
        ...wrapText(label('print.test.wrapHint'), width),
        ruler,
        edgeProbe,
        bar,
        `${label('print.time')}: ${new Date().toLocaleString('en-US-u-nu-latn', timezone ? { timeZone: timezone } : undefined)}`,
        '',
        bar,
        '{CENTER}' + label('print.test.success') + '{/CENTER}',
        bar,
        '{CUT}',
    ];
    return buildEscPos(lines, false, { cutMode, language: lang });
}
// Every ASCII fallback is no wider than 3 characters, so currency labels such
// as USD/EUR/INR have a stable reserved slot in receipt amount columns.
const CURRENCY_ASCII_MAP = {
    '₹': 'Rs', '₨': 'Rs', '€': 'EUR', '£': 'GBP', '¥': 'Yen',
    '₩': 'KRW', '₺': 'TRY', '₫': 'VND', '₪': 'ILS', '₽': 'RUB',
    '฿': 'THB', '₱': 'PHP', '₴': 'UAH', '₦': 'NGN', '₵': 'GHS',
    '₡': 'CRC', '₲': 'PYG', 'د.إ': 'AED', '﷼': 'SAR', 'ریال': 'IRR', '৳': 'BDT',
    'E£': 'EGP',
};
const CURRENCY_TOKEN_RE = new RegExp(Object.keys(CURRENCY_ASCII_MAP)
    .sort((left, right) => right.length - left.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'), 'g');
function normalizeThermalText(text, capabilities = thermal_capabilities_1.GENERIC_THERMAL_CAPABILITIES) {
    return (0, thermal_capabilities_1.normalizeThermalText)(text, capabilities);
}
function normalizeCurrencyToAscii(text) {
    return Object.entries(CURRENCY_ASCII_MAP)
        .sort(([left], [right]) => right.length - left.length)
        .reduce((value, [symbol, fallback]) => value.split(symbol).join(fallback), text);
}
// Resolves the currency symbol into the exact text that will be printed,
// padded to a fixed 3-column slot (leading spaces for shorter symbols/codes).
// symbol). Must run BEFORE rightAlign() computes padding — swapping the
// symbol out afterwards (e.g. '₹' -> 'Rs') changes the string length and
// pushes trailing digits onto the next line.
function resolveCurrencyPrefix(symbol, useUnicode, capabilities) {
    // fa-IR resolves IRR to the textual token "ریال". Generic ESC/POS printers
    // cannot shape that token, so normalize this known currency even when the
    // caller requests Unicode. Preserve the existing useUnicode behavior for
    // every other currency value.
    const normalizedSymbol = symbol === 'ریال' ? 'IRR' : symbol;
    const isAsciiSafe = /^[\x00-\x7F]+$/.test(normalizedSymbol);
    const normalizedForCapabilities = capabilities
        ? (0, thermal_capabilities_1.normalizeThermalText)(normalizedSymbol, capabilities)
        : normalizedSymbol;
    const rawPrefix = capabilities
        ? ((0, thermal_capabilities_1.selectThermalCodePage)(normalizedForCapabilities, capabilities) !== null
            ? normalizedForCapabilities
            : (CURRENCY_ASCII_MAP[normalizedSymbol] || normalizedSymbol.slice(0, 3).toUpperCase() || 'Rs'))
        : (useUnicode || isAsciiSafe)
            ? normalizedSymbol
            : (CURRENCY_ASCII_MAP[normalizedSymbol] || normalizedSymbol.slice(0, 3).toUpperCase() || 'Rs');
    const prefix = rawPrefix.length > 3 ? rawPrefix.slice(0, 3) : rawPrefix;
    return prefix.length >= 3 ? prefix : ' '.repeat(3 - prefix.length) + prefix;
}
// Arabic (incl. Persian) Unicode blocks: Arabic, Arabic Supplement, Arabic
// Extended-A, Arabic Presentation Forms-A/B. These scripts require contextual
// shaping and bidirectional ordering that generic ESC/POS firmware does not
// implement — the selected profile capability (or legacy request override)
// must declare Arabic shaping before they are passed through unchanged.
const ARABIC_SCRIPT_GLOBAL_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const ARABIC_SHAPING_ALLOWED_GLOBAL_RE = /[\u200C\u200D\u200F\u2026]/g;
const ESCPOS_TEXT_CONTROL_RE = /[\x00-\x1F\x7F]/g;
function hasArabicScript(text) {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}
/** Precise warning that distinguishes Arabic shaping from generic unsupported chars. */
function makeUnsupportedLineWarning(isStoreName, text) {
    const label = isStoreName ? 'Store name' : 'Receipt line';
    const why = hasArabicScript(text)
        ? 'it contains Persian/Arabic script and the printer does not declare Arabic shaping support'
        : 'it contains unsupported characters';
    return `${label} was not printed because ${why}: ${text}`;
}
function appendCashDrawerPulse(data) {
    return Buffer.concat([data, Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA])]);
}
/**
 * Build ESC/POS bytes and classify unsupported financial rows for the receipt
 * transport guard. Receipt renderers mark amount-bearing lines with the
 * internal {FINANCIAL} token; it is stripped before bytes are emitted.
 */
function buildEscPos(lines, _useUnicode = false, options = {}, warnings) {
    const buf = [];
    const useLegacyUnicode = options.capabilities === undefined && _useUnicode;
    const capabilities = (0, thermal_capabilities_1.mergeThermalCapabilities)(options.capabilities, options.arabicShaping);
    const hasNativeCodePage = capabilities.encoding.codePages.some((codePage) => codePage !== 'ascii');
    let activeCodePage = capabilities.encoding.preferredCodePage;
    const resetAllStyles = () => {
        buf.push(0x1B, 0x45, 0x00);
        buf.push(0x1B, 0x21, 0x00);
        buf.push(0x1B, 0x61, 0x00);
    };
    for (let line of lines) {
        if (line.includes('{INIT}')) {
            buf.push(0x1B, 0x40);
            resetAllStyles();
            if (!useLegacyUnicode && activeCodePage !== 'ascii') {
                buf.push(0x1B, 0x74, (0, thermal_capabilities_1.escPosCodePageId)(activeCodePage));
            }
            continue;
        }
        if (line.includes('{FEED}')) {
            buf.push(0x1B, 0x64, 0x05);
            continue;
        }
        if (line.includes('{CUT}')) {
            buf.push(0x1B, 0x64, 0x05);
            if (options.cutMode === 'partial') {
                buf.push(0x1D, 0x56, 0x42, 0x00);
            }
            else {
                buf.push(0x1D, 0x56, 0x00);
            }
            continue;
        }
        if (!useLegacyUnicode && !hasNativeCodePage)
            line = normalizeCurrencyToAscii(line);
        line = (0, thermal_capabilities_1.normalizeThermalText)(line, capabilities);
        const isStoreName = line.includes('{STORE_NAME}');
        const isFinancial = line.includes('{FINANCIAL}');
        line = line.replace(/\{STORE_NAME\}/g, '');
        let printableLine = line.replace(/\{[A-Z_/]+\}/g, '');
        const lineBold = line.includes('{BOLD}');
        const lineDH = line.includes('{DOUBLE_HEIGHT}');
        const lineDW = line.includes('{DOUBLE_WIDTH}');
        const lineFontB = line.includes('{FONT_B}');
        const center = line.startsWith('{CENTER}') && line.includes('{/CENTER}');
        const textWithoutSupportedCurrency = printableLine.replace(CURRENCY_TOKEN_RE, '');
        const selectedCodePage = (0, thermal_capabilities_1.selectThermalCodePage)(textWithoutSupportedCurrency, capabilities);
        if (/[^\x00-\x7F]/.test(textWithoutSupportedCurrency)) {
            // Allow Arabic/Persian script through only when the printer profile
            // explicitly declares Arabic shaping support AND the line contains no
            // other non-ASCII script. Otherwise skip it — never emit unshaped text.
            const arabicOnly = capabilities.shaping.arabic
                && hasArabicScript(printableLine)
                && !/[^\x00-\x7F]/.test(textWithoutSupportedCurrency
                    .replace(ARABIC_SCRIPT_GLOBAL_RE, '')
                    .replace(ARABIC_SHAPING_ALLOWED_GLOBAL_RE, ''));
            const codePageRepresentable = (0, thermal_capabilities_1.isThermalTextRepresentable)(textWithoutSupportedCurrency, capabilities);
            if (!arabicOnly && !codePageRepresentable) {
                if (warnings) {
                    const text = printableLine.trim();
                    warnings.push({
                        field: isFinancial ? 'financial row' : isStoreName ? 'store name' : 'receipt line',
                        text,
                        message: makeUnsupportedLineWarning(isStoreName, text),
                        kind: isFinancial ? 'financial' : 'line',
                    });
                }
                continue;
            }
            line = line.replace(ESCPOS_TEXT_CONTROL_RE, '');
            printableLine = line.replace(/\{[A-Z_/]+\}/g, '');
            if (Number.isInteger(options.columns) && options.columns > 0) {
                const maxCols = lineDW ? Math.floor(options.columns / 2) : options.columns;
                line = truncate(printableLine, Math.max(1, maxCols));
            }
        }
        // ESC/POS mode byte bit 0 selects the character font: 0 = Font A (12x24,
        // the default), 1 = Font B (9x17, condensed). No token means Font A.
        line = line.replace(/\{FINANCIAL\}/g, '');
        line = line.replace(/\{CENTER\}/g, '').replace(/\{\/CENTER\}/g, '');
        line = line.replace(/\{BOLD\}/g, '').replace(/\{\/BOLD\}/g, '');
        line = line.replace(/\{DOUBLE_HEIGHT\}/g, '').replace(/\{\/DOUBLE_HEIGHT\}/g, '');
        line = line.replace(/\{DOUBLE_WIDTH\}/g, '').replace(/\{\/DOUBLE_WIDTH\}/g, '');
        line = line.replace(/\{FONT_B\}/g, '').replace(/\{\/FONT_B\}/g, '');
        buf.push(0x1B, 0x61, center ? 0x01 : 0x00);
        let mode = 0;
        if (lineDH)
            mode |= 0x10;
        if (lineDW)
            mode |= 0x20;
        if (lineBold)
            mode |= 0x08;
        if (lineFontB)
            mode |= 0x01;
        buf.push(0x1B, 0x21, mode);
        if (selectedCodePage && selectedCodePage !== activeCodePage && !useLegacyUnicode) {
            buf.push(0x1B, 0x74, (0, thermal_capabilities_1.escPosCodePageId)(selectedCodePage));
            activeCodePage = selectedCodePage;
        }
        if (lineBold) {
            buf.push(0x1B, 0x45, 0x01);
        }
        const encodedText = !useLegacyUnicode && selectedCodePage
            ? codepage_encoder_1.default.encode(line, selectedCodePage)
            : Buffer.from(line, 'utf8');
        buf.push(...encodedText);
        buf.push(0x0A);
    }
    return Buffer.from(buf);
}
/** Convert the command subset emitted by buildEscPos() into a paperless text preview. */
function escPosToText(data) {
    const bytes = Buffer.from(data);
    const text = [];
    const lineBytes = [];
    let activeCodePage = 'utf8';
    const flushLine = () => {
        if (lineBytes.length === 0)
            return;
        text.push(decodeThermalPreviewBytes(lineBytes, activeCodePage));
        lineBytes.length = 0;
    };
    for (let i = 0; i < bytes.length;) {
        const byte = bytes[i];
        if (byte === 0x1B) {
            const command = bytes[i + 1];
            if (command === 0x40) {
                flushLine();
                activeCodePage = 'utf8';
                i += 2;
            }
            else if (command === 0x74) {
                flushLine();
                activeCodePage = THERMAL_CODE_PAGE_BY_ID[bytes[i + 2]] ?? 'utf8';
                i += 3;
            }
            else if (command === 0x21 || command === 0x45 || command === 0x61) {
                i += 3;
            }
            else if (command === 0x64) {
                flushLine();
                const feedLines = bytes[i + 2] || 0;
                for (let line = 0; line < feedLines; line++)
                    text.push('\n');
                i += 3;
            }
            else {
                i += Math.min(2, bytes.length - i);
            }
            continue;
        }
        if (byte === 0x1D && bytes[i + 1] === 0x56) {
            flushLine();
            const mode = bytes[i + 2];
            i += mode === 0x41 || mode === 0x42 ? 4 : 3;
            continue;
        }
        if (byte === 0x0A) {
            flushLine();
            text.push('\n');
            i += 1;
            continue;
        }
        if (byte === 0x0D) {
            i += 1;
            continue;
        }
        lineBytes.push(byte);
        i += 1;
    }
    flushLine();
    return text.join('').replace(/\n+$/, '');
}
const THERMAL_CODE_PAGE_HIGH_HALVES = {
    cp437: "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
    cp850: "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ",
    cp858: "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ",
    windows1252: "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜š›œžŸÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ",
};
const THERMAL_CODE_PAGE_BY_ID = {
    0: 'cp437',
    2: 'cp850',
    16: 'windows1252',
    19: 'cp858',
};
function decodeThermalPreviewBytes(bytes, codePage) {
    if (codePage === 'utf8')
        return Buffer.from(bytes).toString('utf8');
    if (codePage === 'ascii')
        return bytes.map((byte) => String.fromCharCode(byte)).join('');
    const highHalf = THERMAL_CODE_PAGE_HIGH_HALVES[codePage];
    return bytes.map((byte) => byte < 0x80 ? String.fromCharCode(byte) : highHalf[byte - 0x80] ?? '\uFFFD').join('');
}
async function printViaNetwork(ip, port, data, signal) {
    return new Promise((resolve) => {
        const client = new net.Socket();
        let settled = false;
        const onAbort = () => {
            client.destroy();
            finish({ ok: false, detail: 'Print cancelled during shutdown' });
        };
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            resolve(result);
        };
        client.connect(port, ip, () => {
            client.write(data, () => {
                client.end();
                finish({ ok: true });
            });
        });
        client.on('error', (err) => {
            console.error(`[Printer] Network error: ${err.message}`);
            client.destroy();
            finish({ ok: false, detail: `Network error: ${err.message}` });
        });
        client.setTimeout(5000, () => {
            client.destroy();
            finish({ ok: false, detail: `Timed out connecting to ${ip}:${port}` });
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted)
            onAbort();
    });
}
async function printViaUSB(data, printerName, signal) {
    console.log('[Printer] printViaUSB called, platform:', process.platform, 'printer:', printerName);
    if (process.platform === 'darwin' || process.platform === 'linux') {
        return await printViaCups(data, printerName, signal);
    }
    if (process.platform === 'win32') {
        return await printViaUSBWindows(data, printerName, signal);
    }
    console.warn('[Printer] Unsupported platform:', process.platform);
    return { ok: false, detail: `Unsupported platform: ${process.platform}` };
}
// MAS-build counterpart to printViaCups: submits the same raw ESC/POS bytes
// to the same CUPS queue, over local IPP instead of shelling out to `lp`
// (blocked by the App Sandbox). See ipp-client.ts for the rationale.
async function printViaLocalIpp(data, printerName, signal) {
    if (!printerName) {
        return { ok: false, detail: 'No printer configured' };
    }
    try {
        const attrs = await (0, ipp_client_1.ippGetPrinterAttributes)(printerName, signal);
        if (attrs.state === 5) {
            return { ok: false, detail: 'print queue is disabled' };
        }
        if (attrs.isAcceptingJobs === false) {
            return { ok: false, detail: 'print queue is not accepting jobs' };
        }
    }
    catch (err) {
        if (signal?.aborted)
            return { ok: false, detail: 'Print cancelled during shutdown' };
        // Mirrors describeCupsQueueProblem: an unreachable/unknown queue check
        // should not itself block the print — let Print-Job below surface the
        // real failure if there is one.
        console.log(`[Printer] IPP pre-flight check failed for "${printerName}":`, err);
    }
    try {
        const result = await (0, ipp_client_1.ippPrintRaw)(printerName, data, signal);
        if (!result.ok) {
            console.error(`[Printer] IPP print failed for "${printerName}": ${result.detail}`);
            return { ok: false, detail: result.detail || `IPP print failed for "${printerName}"` };
        }
        console.log(`[Printer] IPP print queued for "${printerName}" (job ${result.jobId ?? 'unknown'})`);
        return { ok: true, jobId: result.jobId };
    }
    catch (err) {
        const detail = String(err?.message || err || '').trim();
        console.error(`[Printer] IPP print failed for "${printerName}": ${detail}`);
        return { ok: false, detail: detail || `IPP print failed for "${printerName}"` };
    }
}
// `lp` exits 0 as soon as CUPS accepts the job into the queue, so a queue that
// is disabled — which is what CUPS does once the backend fails, e.g. after the
// printer is unplugged — would otherwise be reported to the cashier as a
// successful print. Mirrors the GetPrinter pre-flight on the Windows path.
//
// Returns a human-readable problem, or null to proceed. Anything unexpected
// (no CUPS, unknown queue) returns null so `lp` still gets its chance: this
// check only ever turns a silent failure into a visible one.
async function describeCupsQueueProblem(printerName, signal) {
    if (!printerName)
        return null;
    // LC_ALL=C — the state words below are matched in English, and lpstat is localised.
    const opts = { encoding: 'utf8', timeout: 5000, signal, env: { ...process.env, LC_ALL: 'C' } };
    try {
        const { stdout } = await execFileAsync('lpstat', ['-p', printerName], opts);
        if (/\bdisabled\b/i.test(stdout)) {
            const since = stdout.match(/disabled since [^\n]*/i);
            return since ? since[0].trim().replace(/\s+-\s*$/, '') : 'print queue is disabled';
        }
    }
    catch {
        return null;
    }
    try {
        const { stdout } = await execFileAsync('lpstat', ['-a', printerName], opts);
        if (/not accepting/i.test(stdout))
            return 'print queue is not accepting jobs';
    }
    catch {
        return null;
    }
    return null;
}
async function printViaCups(data, printerName, signal) {
    const label = printerName || 'default';
    const problem = await describeCupsQueueProblem(printerName, signal);
    if (signal?.aborted)
        return { ok: false, detail: 'Print cancelled during shutdown' };
    if (problem) {
        console.error(`[Printer] CUPS print aborted for "${label}": ${problem}`);
        return { ok: false, detail: problem };
    }
    const tmpFile = path.join(os.tmpdir(), `flo_print_${process.pid}_${Date.now()}.bin`);
    try {
        fs.writeFileSync(tmpFile, data);
        const args = printerName
            ? ['-d', printerName, '-o', 'raw', tmpFile]
            : ['-o', 'raw', tmpFile];
        const { stdout } = await execFileAsync('lp', args, { encoding: 'utf8', timeout: 20000, signal });
        console.log(`[Printer] CUPS print queued for "${label}" (${stdout.trim()})`);
        return { ok: true };
    }
    catch (err) {
        const detail = String(err.stderr || err.message || '').trim();
        console.error(`[Printer] CUPS print failed for "${label}": ${detail}`);
        return { ok: false, detail: detail || `CUPS print failed for "${label}"` };
    }
    finally {
        try {
            fs.unlinkSync(tmpFile);
        }
        catch { }
    }
}
// Raw ESC/POS on Windows has to bypass the print driver: node-thermal-printer's
// `printer:<name>` interface and PowerShell's `Start-Process -Verb PrintTo` both
// hand the document to a driver that must already understand it, and a thermal
// printer's driver does not. Writing to the spooler with datatype RAW is the
// documented way to get bytes through untouched.
//
// Kept as C# compiled at run time by Add-Type rather than a native addon so the
// app stays free of per-Electron-ABI prebuilds. Uses the *W entry points so
// printer names outside ASCII survive marshalling.
//
// NOTE: no backslash escapes, backticks, or `${` may appear in this source — it
// is embedded in a TS template literal and then in a single-quoted PowerShell
// here-string, and both would rewrite it.
const WINSPOOL_HELPER_SOURCE = `
using System;
using System.Runtime.InteropServices;

public static class FloRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private class DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PRINTER_INFO_2 {
        public IntPtr pServerName;
        public IntPtr pPrinterName;
        public IntPtr pShareName;
        public IntPtr pPortName;
        public IntPtr pDriverName;
        public IntPtr pComment;
        public IntPtr pLocation;
        public IntPtr pDevMode;
        public IntPtr pSepFile;
        public IntPtr pPrintProcessor;
        public IntPtr pDatatype;
        public IntPtr pParameters;
        public IntPtr pSecurityDescriptor;
        public uint Attributes;
        public uint Priority;
        public uint DefaultPriority;
        public uint StartTime;
        public uint UntilTime;
        public uint Status;
        public uint cJobs;
        public uint AveragePPM;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "GetPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern bool GetPrinter(IntPtr hPrinter, int Level, IntPtr pPrinter, uint cbBuf, out uint pcbNeeded);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint StartDocPrinter(IntPtr hPrinter, int Level, [In] DOCINFO pDocInfo);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    private const uint PRINTER_ATTRIBUTE_WORK_OFFLINE = 0x00000400;

    private static string DescribeBlockingState(uint status, uint attributes) {
        if ((attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE) != 0) return "printer is set to 'Use Printer Offline' in Windows";
        if ((status & 0x00000080) != 0) return "printer is offline";
        if ((status & 0x00001000) != 0) return "printer is not available";
        if ((status & 0x00000010) != 0) return "printer is out of paper";
        if ((status & 0x00000008) != 0) return "printer has a paper jam";
        if ((status & 0x00400000) != 0) return "printer cover is open";
        if ((status & 0x00100000) != 0) return "printer needs attention";
        if ((status & 0x00000002) != 0) return "printer reported an error";
        return null;
    }

    // OpenPrinter succeeds against the queue even when the device is unplugged,
    // so without this the job would silently spool and we would report success.
    private static void EnsureReady(IntPtr hPrinter) {
        uint needed = 0;
        GetPrinter(hPrinter, 2, IntPtr.Zero, 0, out needed);
        if (needed == 0) return;

        IntPtr buf = Marshal.AllocHGlobal((int)needed);
        try {
            uint unused = 0;
            if (!GetPrinter(hPrinter, 2, buf, needed, out unused)) return;
            PRINTER_INFO_2 info = (PRINTER_INFO_2)Marshal.PtrToStructure(buf, typeof(PRINTER_INFO_2));
            string problem = DescribeBlockingState(info.Status, info.Attributes);
            if (problem != null) throw new Exception(problem);
        } finally {
            Marshal.FreeHGlobal(buf);
        }
    }

    public static uint SendRaw(string printerName, byte[] bytes) {
        IntPtr hPrinter = IntPtr.Zero;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("cannot open printer '" + printerName + "' (Win32 error " + Marshal.GetLastWin32Error() + ")");

        try {
            EnsureReady(hPrinter);

            DOCINFO docInfo = new DOCINFO();
            docInfo.pDocName = "FloCafe Receipt";
            docInfo.pDataType = "RAW";

            uint jobId = StartDocPrinter(hPrinter, 1, docInfo);
            if (jobId == 0)
                throw new Exception("StartDocPrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")");

            try {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("StartPagePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")");

                int written = 0;
                if (!WritePrinter(hPrinter, bytes, bytes.Length, out written))
                    throw new Exception("WritePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")");
                if (written != bytes.Length)
                    throw new Exception("WritePrinter accepted " + written + " of " + bytes.Length + " bytes");

                EndPagePrinter(hPrinter);
            } finally {
                EndDocPrinter(hPrinter);
            }

            return jobId;
        } finally {
            ClosePrinter(hPrinter);
        }
    }
}
`;
// Delivered as -EncodedCommand rather than a .ps1: ExecutionPolicy governs script
// files only, and a GPO-set policy silently overrides -ExecutionPolicy Bypass, so
// a script file would fail on exactly the managed machines a POS runs on.
// The printer name and payload path travel in the child environment, so neither
// is ever parsed as script text.
const WINSPOOL_HELPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  $name = $env:FLO_PRINTER_NAME
  $file = $env:FLO_PRINT_FILE
  if ([string]::IsNullOrEmpty($name)) { throw 'no printer name supplied' }
  if ([string]::IsNullOrEmpty($file)) { throw 'no payload file supplied' }

  # Best-effort metadata for Tier-2 diagnostics. This is never included in the
  # anonymous telemetry payload and must not prevent the raw print attempt.
  try {
    $printerInfo = Get-CimInstance -ClassName Win32_Printer -Property Name,PrinterStatus,DriverName |
      Where-Object { $_.Name -eq $name } |
      Select-Object -First 1 Name,PrinterStatus,DriverName
    if ($printerInfo) {
      Write-Output ('FLO_PRINTER_INFO=' + ($printerInfo | ConvertTo-Json -Compress))
    }
  } catch { }

  Add-Type -TypeDefinition @'
${WINSPOOL_HELPER_SOURCE}
'@

  $bytes = [System.IO.File]::ReadAllBytes($file)
  $jobId = [FloRawPrinter]::SendRaw($name, $bytes)
  Write-Output ('FLO_JOB_ID=' + $jobId)
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function parseWindowsPrintOutput(output) {
    const outputLines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const jobLine = outputLines.find((line) => line.startsWith('FLO_JOB_ID='));
    const infoLine = outputLines.find((line) => line.startsWith('FLO_PRINTER_INFO='));
    const parsed = {};
    if (jobLine) {
        const jobId = Number(jobLine.slice('FLO_JOB_ID='.length));
        if (Number.isSafeInteger(jobId) && jobId > 0)
            parsed.jobId = jobId;
    }
    if (infoLine) {
        try {
            const info = JSON.parse(infoLine.slice('FLO_PRINTER_INFO='.length));
            if (typeof info.DriverName === 'string' && info.DriverName.trim())
                parsed.driverName = info.DriverName.trim();
            if (typeof info.PrinterStatus === 'number')
                parsed.printerStatus = info.PrinterStatus;
        }
        catch { /* diagnostics metadata is best-effort */ }
    }
    return parsed;
}
async function printViaUSBWindows(data, printerName, signal) {
    if (!printerName) {
        const detail = 'No Windows printer configured; refusing to guess a target';
        console.error(`[Printer] ${detail}`);
        return { ok: false, detail };
    }
    // %TEMP%, not C:\Windows\Temp — the latter is not writable by a standard user.
    const tmpFile = path.join(os.tmpdir(), `flo_print_${process.pid}_${Date.now()}.bin`);
    try {
        fs.writeFileSync(tmpFile, data);
        const encoded = Buffer.from(WINSPOOL_HELPER_SCRIPT, 'utf16le').toString('base64');
        const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
            encoding: 'utf8',
            timeout: 20000,
            signal,
            windowsHide: true,
            env: { ...process.env, FLO_PRINTER_NAME: printerName, FLO_PRINT_FILE: tmpFile },
        });
        const metadata = parseWindowsPrintOutput(stdout);
        console.log(`[Printer] Windows raw print accepted for "${printerName}" (${String(stdout).trim()})`);
        return { ok: true, ...metadata };
    }
    catch (err) {
        const detail = String(err.stderr || err.message || '').trim();
        console.error(`[Printer] Windows raw print failed for "${printerName}": ${detail}`);
        return {
            ok: false,
            detail: detail || `Windows raw print failed for "${printerName}"`,
            failureClass: classifyPrintFailure(detail),
            platformErrorCode: extractPlatformErrorCode(detail),
            ...parseWindowsPrintOutput(err.stdout),
        };
    }
    finally {
        try {
            fs.unlinkSync(tmpFile);
        }
        catch { }
    }
}
function getPrinterStatus() {
    const printer = getPrinterConfig();
    return { connected: !!printer, printer };
}
//# sourceMappingURL=thermal.js.map