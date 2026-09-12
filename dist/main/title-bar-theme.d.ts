import type { NativeTheme } from 'electron';
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
export declare const TITLE_BAR_HEIGHT = 40;
export interface TitleBarOverlayColors {
    readonly color: string;
    readonly symbolColor: string;
}
export declare const TITLE_BAR_OVERLAY_COLORS: Readonly<Record<'light' | 'dark', TitleBarOverlayColors>>;
export declare function resolveTitleBarOverlayColors(isDark: boolean): TitleBarOverlayColors;
/**
 * Runtime theme updates are supported on Windows and macOS. Linux may expose
 * `BrowserWindow.setTitleBarOverlay` for native-overlay window creation, but
 * dynamic overlay updates intentionally no-op there because window-manager
 * support is inconsistent across Linux environments.
 */
export declare function supportsTitleBarOverlay(platform: NodeJS.Platform): boolean;
type OverlayCapableWindow = {
    setTitleBarOverlay?: (options: {
        color: string;
        symbolColor: string;
        height?: number;
    }) => void;
};
/**
 * Applies the overlay colors for the given theme mode. Returns true when the
 * call was attempted successfully, false when unsupported or rejected.
 */
export declare function applyTitleBarOverlayTheme(win: unknown, isDark: boolean, platform?: NodeJS.Platform): boolean;
type ThemeLike = Pick<NativeTheme, 'shouldUseDarkColors'> & {
    on(event: 'updated', listener: () => void): unknown;
};
/**
 * Optional future-integration helper: subscribes to OS theme changes so a
 * caller can keep a window's title-bar overlay following light/dark at
 * runtime. Returns an unsubscribe function. No-ops on platforms where the
 * overlay cannot be updated. The current main window intentionally pins the
 * light palette until the renderer implements dark-theme behavior.
 */
export declare function attachTitleBarThemeSync(nativeTheme: ThemeLike, getWindow: () => OverlayCapableWindow | null | undefined, platform?: NodeJS.Platform): () => void;
export type ThemeMode = 'light' | 'dark' | 'system';
export declare function isThemeMode(value: unknown): value is ThemeMode;
/** Absent, null, or unrecognized values resolve to 'system'. */
export declare function resolveThemeMode(value: string | null | undefined): ThemeMode;
/** Initial window darkness: explicit modes win; 'system' defers to the OS signal. */
export declare function resolveInitialIsDark(mode: ThemeMode, systemPrefersDark: boolean): boolean;
/**
 * Adds the current palette to standalone-window URLs (KDS/popup windows have
 * no preload and a different origin, so their pre-paint script learns the
 * theme from this param — gh-513 §8).
 */
export declare function appendThemeQueryParam(url: string, isDark: boolean): string;
export {};
//# sourceMappingURL=title-bar-theme.d.ts.map