import { type StoredUpdateStatus, type UpdateErrorPhase } from './update-state';
export type UpdateShutdownState = {
    setInstallingUpdate: (value: boolean) => void;
    setQuitting: (value: boolean) => void;
};
type UpdateAuthorizationResult = {
    ok: true;
} | {
    ok: false;
    error: string;
};
type RestartAndInstallResult = {
    success: true;
} | {
    success: false;
    error: string;
};
type RestartAndInstallOptions = {
    isInstallReady: () => boolean;
    authorize: (pin: string | undefined) => UpdateAuthorizationResult;
    runCleanup: () => Promise<void>;
    quitAndInstall: (isSilent: boolean, isForceRunAfter: boolean) => void;
    updateState: UpdateShutdownState;
    onInstallFailure: (error: unknown) => void;
    warn: (message: string) => void;
    error: (message: string, error: unknown) => void;
};
type AutoUpdaterErrorHandlerOptions = {
    getPhase: () => UpdateErrorPhase;
    setPhase: (phase: UpdateErrorPhase) => void;
    isInstallReady: () => boolean;
    isInstallingUpdate: () => boolean;
    setUpdateStatus: (next: StoredUpdateStatus) => void;
    onInstallFailure: (error: unknown) => void;
    logInfo: (message: string, detail?: unknown) => void;
};
export declare function createAutoUpdaterErrorHandler({ getPhase, setPhase, isInstallReady, isInstallingUpdate, setUpdateStatus, onInstallFailure, logInfo, }: AutoUpdaterErrorHandlerOptions): (error: unknown) => void;
export declare function createRestartAndInstallHandler({ isInstallReady, authorize, runCleanup, quitAndInstall, updateState, onInstallFailure, warn, error, }: RestartAndInstallOptions): (event: unknown, pin?: unknown) => Promise<RestartAndInstallResult>;
export {};
//# sourceMappingURL=updater-shutdown.d.ts.map