"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TITLE_BAR_OVERLAY_COLORS = exports.TITLE_BAR_HEIGHT = void 0;
exports.resolveTitleBarOverlayColors = resolveTitleBarOverlayColors;
exports.supportsTitleBarOverlay = supportsTitleBarOverlay;
exports.applyTitleBarOverlayTheme = applyTitleBarOverlayTheme;
exports.attachTitleBarThemeSync = attachTitleBarThemeSync;
exports.isThemeMode = isThemeMode;
exports.resolveThemeMode = resolveThemeMode;
exports.resolveInitialIsDark = resolveInitialIsDark;
exports.appendThemeQueryParam = appendThemeQueryParam;
/**
 * Title-bar palette tokens and optional helpers for the native-controls title
 * bar (Refs #457; dark-theme follow-up in #513).
 *
 * The overlay colors mirror the renderer CSS custom properties defined in
 * `frontend/src/app/globals.css` so callers can keep the native Window
 * Controls Overlay visually continuous with the `.flo-title-bar` surface:
 * - light: `--background` oklch(1 0 0) -> #ffffff and `--foreground`
 *   oklch(0.145 0 0) -> #0a0a0a.
 * - dark: `--background` oklch(0.145 0 0) -> #0a0a0a and `--foreground`
 *   oklch(0.985 0 0) -> #fafafa.
 *
 * Keep this module free of Electron runtime imports so the color resolution
 * stays unit-testable without launching Electron.
 */
exports.TITLE_BAR_HEIGHT = 40;
exports.TITLE_BAR_OVERLAY_COLORS = {
    light: { color: '#ffffff', symbolColor: '#0a0a0a' },
    dark: { color: '#0a0a0a', symbolColor: '#fafafa' },
};
function resolveTitleBarOverlayColors(isDark) {
    return isDark ? exports.TITLE_BAR_OVERLAY_COLORS.dark : exports.TITLE_BAR_OVERLAY_COLORS.light;
}
/**
 * Runtime theme updates are supported on Windows and macOS. Linux may expose
 * `BrowserWindow.setTitleBarOverlay` for native-overlay window creation, but
 * dynamic overlay updates intentionally no-op there because window-manager
 * support is inconsistent across Linux environments.
 */
function supportsTitleBarOverlay(platform) {
    return platform === 'darwin' || platform === 'win32';
}
/**
 * Applies the overlay colors for the given theme mode. Returns true when the
 * call was attempted successfully, false when unsupported or rejected.
 */
function applyTitleBarOverlayTheme(win, isDark, platform = process.platform) {
    if (!supportsTitleBarOverlay(platform))
        return false;
    const candidate = win;
    if (!candidate || typeof candidate.setTitleBarOverlay !== 'function')
        return false;
    try {
        candidate.setTitleBarOverlay({ ...resolveTitleBarOverlayColors(isDark), height: exports.TITLE_BAR_HEIGHT });
        return true;
    }
    catch {
        // Some window-manager combinations reject runtime overlay changes even
        // when the API exists; keep the last applied colors instead of crashing.
        return false;
    }
}
/**
 * Optional future-integration helper: subscribes to OS theme changes so a
 * caller can keep a window's title-bar overlay following light/dark at
 * runtime. Returns an unsubscribe function. No-ops on platforms where the
 * overlay cannot be updated. The current main window intentionally pins the
 * light palette until the renderer implements dark-theme behavior.
 */
function attachTitleBarThemeSync(nativeTheme, getWindow, platform = process.platform) {
    if (!supportsTitleBarOverlay(platform))
        return () => { };
    const onUpdated = () => {
        applyTitleBarOverlayTheme(getWindow(), nativeTheme.shouldUseDarkColors, platform);
    };
    nativeTheme.on('updated', onUpdated);
    return () => {
        nativeTheme.off?.('updated', onUpdated);
    };
}
function isThemeMode(value) {
    return value === 'light' || value === 'dark' || value === 'system';
}
/** Absent, null, or unrecognized values resolve to 'system'. */
function resolveThemeMode(value) {
    return isThemeMode(value) ? value : 'system';
}
/** Initial window darkness: explicit modes win; 'system' defers to the OS signal. */
function resolveInitialIsDark(mode, systemPrefersDark) {
    return mode === 'dark' || (mode === 'system' && systemPrefersDark);
}
/**
 * Adds the current palette to standalone-window URLs (KDS/popup windows have
 * no preload and a different origin, so their pre-paint script learns the
 * theme from this param — gh-513 §8).
 */
function appendThemeQueryParam(url, isDark) {
    try {
        const parsed = new URL(url);
        parsed.searchParams.set('theme', isDark ? 'dark' : 'light');
        return parsed.toString();
    }
    catch {
        return url;
    }
}
//# sourceMappingURL=title-bar-theme.js.map