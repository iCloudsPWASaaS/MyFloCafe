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
exports.registerUsbDevicePermissions = registerUsbDevicePermissions;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * vendorId+productId+serialNumber is the only combination that reliably
 * identifies one physical device — many printers share generic VID/PID pairs
 * from the same USB-to-serial chipset, so vendorId+productId alone can match
 * a different physical unit. Returns null when the device has no serial
 * number, meaning it has no identity trustworthy enough to persist or match
 * across restarts (mirrors how browsers scope WebUSB's own persisted-grant
 * store to devices that report a serial number).
 */
function persistableDeviceKey(device) {
    return device.serialNumber ? `${device.vendorId}:${device.productId}:${device.serialNumber}` : null;
}
function approvalsFilePath() {
    return path.join(electron_1.app.getPath('userData'), 'usb-printer-approvals.json');
}
function loadPersistedApprovals() {
    try {
        const raw = fs.readFileSync(approvalsFilePath(), 'utf8');
        const parsed = JSON.parse(raw);
        return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
    }
    catch {
        return new Set();
    }
}
function savePersistedApprovals(keys) {
    try {
        fs.writeFileSync(approvalsFilePath(), JSON.stringify([...keys]), { mode: 0o600 });
    }
    catch (err) {
        console.warn('[Printer] Failed to persist USB device approval:', err);
    }
}
/**
 * Wires up Electron's main-process USB device permission handlers, which a
 * Chromium embed (unlike a standard browser) requires before
 * `navigator.usb.requestDevice()`/`getDevices()` can resolve at all. Without
 * this, PrinterService's WebUSB connect flow has no device picker to select
 * from and silently never resolves in the packaged desktop app (issue #534).
 *
 * Electron has no built-in device-chooser UI (unlike Chrome), so this shows
 * a native confirmation dialog naming the specific device the first time it
 * is offered — restoring the same user-mediated, per-device authorization a
 * real browser's picker provides, rather than auto-granting access.
 *
 * A device that reports a serial number gets a durable approval persisted to
 * disk (see persistableDeviceKey), so PrinterService's silent startup
 * reconnect keeps working across app restarts without re-prompting. A
 * device without a serial number has no identity that safely survives a
 * restart — persisting a bare vendorId+productId match would let a
 * different physical unit sharing that pair silently inherit another
 * device's approval — so it only gets a session-scoped approval (keyed by
 * Electron's own per-session deviceId) and must be re-confirmed after every
 * restart.
 *
 * Both handlers are also scoped to `trustedOrigin` (the app's own served
 * origin, e.g. `http://localhost:<port>`) — this app never intentionally
 * loads third-party content, but nothing else in the renderer's security
 * model stops a compromised dependency or a stray external navigation from
 * requesting USB access, so any request from another origin is refused
 * outright rather than reaching the dialog at all.
 */
function registerUsbDevicePermissions(session, trustedOrigin) {
    const persistedApprovedKeys = loadPersistedApprovals();
    const sessionApprovedDeviceIds = new Set();
    const isApproved = (device) => {
        const persistKey = persistableDeviceKey(device);
        if (persistKey && persistedApprovedKeys.has(persistKey))
            return true;
        return sessionApprovedDeviceIds.has(device.deviceId);
    };
    const markApproved = (device) => {
        sessionApprovedDeviceIds.add(device.deviceId);
        const persistKey = persistableDeviceKey(device);
        if (persistKey) {
            persistedApprovedKeys.add(persistKey);
            savePersistedApprovals(persistedApprovedKeys);
        }
    };
    session.on('select-usb-device', (event, details, callback) => {
        event.preventDefault();
        if (details.frame?.origin !== trustedOrigin) {
            callback();
            return;
        }
        const device = details.deviceList[0];
        if (!device) {
            callback();
            return;
        }
        if (isApproved(device)) {
            callback(device.deviceId);
            return;
        }
        const deviceLabel = device.productName
            ? `${device.productName}${device.manufacturerName ? ` (${device.manufacturerName})` : ''}`
            : `USB device ${device.vendorId.toString(16).padStart(4, '0')}:${device.productId.toString(16).padStart(4, '0')}`;
        electron_1.dialog.showMessageBox({
            type: 'question',
            buttons: ['Allow', 'Deny'],
            defaultId: 0,
            cancelId: 1,
            title: 'Connect USB printer',
            message: 'FloCafe wants to connect to a USB device',
            detail: deviceLabel,
        }).then((result) => {
            if (result.response === 0) {
                markApproved(device);
                callback(device.deviceId);
            }
            else {
                callback();
            }
        }).catch(() => callback());
    });
    session.setDevicePermissionHandler((details) => {
        if (details.deviceType !== 'usb' || details.origin !== trustedOrigin)
            return false;
        return isApproved(details.device);
    });
}
//# sourceMappingURL=usb-device-permissions.js.map