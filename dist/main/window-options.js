"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAC_TRAFFIC_LIGHT_POSITION = void 0;
exports.resolveTitleBarMode = resolveTitleBarMode;
exports.createMainWindow = createMainWindow;
exports.applyWindowControlAction = applyWindowControlAction;
exports.getPopupWindowOptions = getPopupWindowOptions;
exports.getKdsWindowOptions = getKdsWindowOptions;
exports.createKdsWindow = createKdsWindow;
exports.createLocalWindowOpenHandler = createLocalWindowOpenHandler;
const title_bar_theme_1 = require("./title-bar-theme");
// macOS traffic-light buttons are 12px tall; y = (40 - 12) / 2 centers them in
// the 40px title bar. x keeps the standard inset margin from the window edge.
// Exported for the platform-matrix runtime probe (tests/platform-titlebar-runtime-probe.cjs)
// so the macOS hands-on row can assert the exact centered values.
exports.MAC_TRAFFIC_LIGHT_POSITION = { x: 16, y: 14 };
/**
 * Window Controls Overlay APIs became dependable across our supported
 * platforms from Electron 33 onward; older builds can end up hidden-with-
 * no-controls when the overlay silently fails, so they fall back.
 */
const MIN_OVERLAY_ELECTRON_MAJOR = 33;
/**
 * Decides whether the main window can rely on Electron's native
 * titleBarOverlay caption buttons (or macOS hiddenInset traffic lights), or
 * whether the renderer must draw HTML fallback controls.
 *
 * Deliberately defensive: macOS always resolves to 'native-overlay'; on Windows
 * and Linux, an unknown platform, a pre-33 Electron, or a missing runtime
 * overlay API all resolve to 'html-fallback' so the window never ends up
 * frameless with no visible way to minimize/close it.
 */
function resolveTitleBarMode(probe) {
    if (probe.platform !== 'darwin' && probe.platform !== 'win32' && probe.platform !== 'linux') {
        return 'html-fallback';
    }
    if (probe.platform === 'darwin') {
        // macOS supplies native traffic lights via titleBarStyle: 'hiddenInset'.
        // It never needs HTML fallback caption buttons.
        return 'native-overlay';
    }
    const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(probe.electronVersion);
    const major = versionMatch ? Number(versionMatch[1]) : Number.NaN;
    if (!Number.isSafeInteger(major) || major < MIN_OVERLAY_ELECTRON_MAJOR)
        return 'html-fallback';
    if (!probe.overlayApiPresent)
        return 'html-fallback';
    return 'native-overlay';
}
function createMainWindow(BrowserWindowConstructor, preload, platform = process.platform, isDarkOrTitleBarMode = false, titleBarMode = typeof isDarkOrTitleBarMode === 'string' ? isDarkOrTitleBarMode : 'native-overlay') {
    const isDark = typeof isDarkOrTitleBarMode === 'boolean' ? isDarkOrTitleBarMode : false;
    const resolvedTitleBarMode = typeof isDarkOrTitleBarMode === 'string' ? isDarkOrTitleBarMode : titleBarMode;
    return new BrowserWindowConstructor({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        title: 'Flo',
        titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'hidden',
        ...(resolvedTitleBarMode === 'native-overlay'
            ? {
                titleBarOverlay: {
                    ...(0, title_bar_theme_1.resolveTitleBarOverlayColors)(isDark),
                    height: title_bar_theme_1.TITLE_BAR_HEIGHT,
                },
            }
            : {}),
        ...(platform === 'darwin' ? { trafficLightPosition: exports.MAC_TRAFFIC_LIGHT_POSITION } : {}),
        webPreferences: {
            preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
        show: false,
    });
}
/**
 * Applies one validated window-control action. 'close' intentionally goes
 * through `win.close()` so it fires the same 'close' event as the native
 * caption button, preserving close-to-tray semantics.
 */
function applyWindowControlAction(win, action) {
    if (action !== 'minimize' && action !== 'toggle-maximize' && action !== 'close') {
        return { error: 'Unsupported window action' };
    }
    switch (action) {
        case 'minimize':
            win.minimize();
            break;
        case 'toggle-maximize':
            if (typeof win.isFullScreen === 'function' && win.isFullScreen()) {
                if (typeof win.setFullScreen === 'function') {
                    win.setFullScreen(false);
                }
                else {
                    win.unmaximize();
                }
            }
            else if (win.isMaximized()) {
                win.unmaximize();
            }
            else {
                win.maximize();
            }
            break;
        case 'close':
            win.close();
            break;
    }
    return { success: true };
}
function getPopupWindowOptions(isBlank) {
    return {
        width: isBlank ? 800 : 1280,
        height: isBlank ? 600 : 800,
        title: isBlank ? 'Print Receipt' : 'Flo - Kitchen Display',
        autoHideMenuBar: isBlank,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    };
}
function getKdsWindowOptions() {
    return {
        width: 1200,
        height: 800,
        title: 'Flo - Kitchen Display',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    };
}
function createKdsWindow(BrowserWindowConstructor) {
    return new BrowserWindowConstructor(getKdsWindowOptions());
}
function createLocalWindowOpenHandler(isAllowedLocalWindowUrl, getServerPort, getLocalIP) {
    return ({ url }) => {
        const isBlank = url === 'about:blank' || url === '';
        if (!isAllowedLocalWindowUrl(url, getServerPort(), getLocalIP()))
            return null;
        return {
            action: 'allow',
            overrideBrowserWindowOptions: getPopupWindowOptions(isBlank),
        };
    };
}
//# sourceMappingURL=window-options.js.map