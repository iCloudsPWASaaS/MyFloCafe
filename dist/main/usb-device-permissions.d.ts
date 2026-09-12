import { type Session } from 'electron';
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
export declare function registerUsbDevicePermissions(session: Session, trustedOrigin: string): void;
//# sourceMappingURL=usb-device-permissions.d.ts.map