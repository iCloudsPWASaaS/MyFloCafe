import { BrowserWindow } from 'electron';
/**
 * The only window permitted to invoke privileged IPC is the main POS renderer,
 * which the embedded server serves from localhost/127.0.0.1. The KDS window is
 * LAN-served HTTP content and must not reach these handlers, so non-PIN-gated
 * handlers verify the sender's origin before doing anything.
 */
export declare function isTrustedSender(event: Pick<Electron.IpcMainInvokeEvent, 'sender'>): boolean;
type MainWindowGetter = () => BrowserWindow | null;
export declare function registerIpcHandlers(shutdownSignal?: AbortSignal, getMainWindow?: MainWindowGetter, showMainWindow?: (window: BrowserWindow) => boolean, getCurrentEffectiveIsDark?: () => boolean): void;
export {};
//# sourceMappingURL=ipc.d.ts.map