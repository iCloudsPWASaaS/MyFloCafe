"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAutoUpdaterErrorHandler = createAutoUpdaterErrorHandler;
exports.createRestartAndInstallHandler = createRestartAndInstallHandler;
const update_state_1 = require("./update-state");
function createAutoUpdaterErrorHandler({ getPhase, setPhase, isInstallReady, isInstallingUpdate, setUpdateStatus, onInstallFailure, logInfo, }) {
    return (error) => {
        const errorPhase = getPhase();
        const classified = (0, update_state_1.classifyUpdateError)(error, errorPhase);
        setPhase('check');
        logInfo(`[Update] Updater error classified as ${classified.state}` +
            `/${classified.reason}:`, classified.detail);
        if (isInstallingUpdate()) {
            logInfo('[Update] Installation failed after shutdown; relaunching the current version');
            onInstallFailure(error);
            return;
        }
        if (isInstallReady()) {
            logInfo('[Update] Preserving ready-to-install status while staged update awaits installation');
            return;
        }
        setUpdateStatus({
            status: classified.state,
            reason: classified.reason,
            error: classified.detail
        });
    };
}
function createRestartAndInstallHandler({ isInstallReady, authorize, runCleanup, quitAndInstall, updateState, onInstallFailure, warn, error, }) {
    return async (_event, pin) => {
        if (!isInstallReady()) {
            warn('[Update] Ignoring install request before an update is downloaded');
            return { success: false, error: 'No downloaded update is ready to install.' };
        }
        const auth = authorize(typeof pin === 'string' ? pin : undefined);
        if (!auth.ok) {
            warn(`[Update] Restart-to-install denied by Master PIN gate: ${auth.error}`);
            return { success: false, error: auth.error };
        }
        updateState.setInstallingUpdate(true);
        updateState.setQuitting(true);
        try {
            await runCleanup();
        }
        catch (cleanupError) {
            error('[Update] Pre-install cleanup failed (proceeding with install):', cleanupError);
        }
        try {
            quitAndInstall(false, true);
            return { success: true };
        }
        catch (installError) {
            error('[Update] quitAndInstall failed:', installError);
            onInstallFailure(installError);
            return { success: false, error: installError instanceof Error ? installError.message : String(installError) };
        }
    };
}
//# sourceMappingURL=updater-shutdown.js.map