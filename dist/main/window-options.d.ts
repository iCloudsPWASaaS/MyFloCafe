import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
/** How the main window's caption controls are supplied. */
export type TitleBarMode = 'native-overlay' | 'html-fallback';
/** The single narrow window-control verb set exposed over IPC. */
export type WindowControlAction = 'minimize' | 'toggle-maximize' | 'close';
export type BrowserWindowConstructor = new (options: BrowserWindowConstructorOptions) => BrowserWindow;
export declare const MAC_TRAFFIC_LIGHT_POSITION: {
    readonly x: 16;
    readonly y: 14;
};
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
export declare function resolveTitleBarMode(probe: {
    platform: NodeJS.Platform;
    electronVersion: string;
    overlayApiPresent: boolean;
}): TitleBarMode;
export declare function createMainWindow(BrowserWindowConstructor: BrowserWindowConstructor, preload: string, platform?: NodeJS.Platform, isDarkOrTitleBarMode?: boolean | TitleBarMode, titleBarMode?: TitleBarMode): BrowserWindow;
/** Minimal window surface needed to service a window-control action. */
export type WindowControlTarget = Pick<BrowserWindow, 'isDestroyed' | 'minimize' | 'isMaximized' | 'maximize' | 'unmaximize' | 'close'> & {
    isFullScreen?: () => boolean;
    setFullScreen?: (flag: boolean) => void;
};
/**
 * Applies one validated window-control action. 'close' intentionally goes
 * through `win.close()` so it fires the same 'close' event as the native
 * caption button, preserving close-to-tray semantics.
 */
export declare function applyWindowControlAction(win: WindowControlTarget, action: unknown): {
    success: true;
} | {
    error: string;
};
export declare function getPopupWindowOptions(isBlank: boolean): BrowserWindowConstructorOptions;
export declare function getKdsWindowOptions(): BrowserWindowConstructorOptions;
export declare function createKdsWindow(BrowserWindowConstructor: BrowserWindowConstructor): BrowserWindow;
type LocalWindowUrlChecker = (rawUrl: string, port: number, localIp?: string) => boolean;
export declare function createLocalWindowOpenHandler(isAllowedLocalWindowUrl: LocalWindowUrlChecker, getServerPort: () => number, getLocalIP: () => string): (details: {
    url: string;
}) => {
    action: 'allow';
    overrideBrowserWindowOptions: BrowserWindowConstructorOptions;
} | null;
export {};
//# sourceMappingURL=window-options.d.ts.map