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
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const bonjour_service_1 = require("bonjour-service");
const db_1 = require("./db");
const update_channel_1 = require("./update-channel");
const catalog_1 = require("./tax-packs/catalog");
const server_1 = require("./server");
const cloud_sync_1 = require("./services/cloud-sync");
const telemetry_1 = require("./services/telemetry");
const google_drive_1 = require("./services/google-drive");
const kds_server_1 = require("./kds-server");
const server_app_1 = require("./server-app");
const thermal_1 = require("./printers/thermal");
const ipc_1 = require("./ipc");
const master_pin_1 = require("./services/master-pin");
const whatsapp_1 = require("./services/whatsapp");
const main_1 = __importDefault(require("electron-log/main"));
const electron_updater_1 = require("electron-updater");
const url_allowlist_1 = require("./security/url-allowlist");
const update_state_1 = require("./update-state");
const updater_shutdown_1 = require("./updater-shutdown");
const startup_cache_1 = require("./startup-cache");
const window_options_1 = require("./window-options");
const title_bar_theme_1 = require("./title-bar-theme");
const window_readiness_1 = require("./window-readiness");
const window_load_retry_1 = require("./window-load-retry");
const usb_device_permissions_1 = require("./usb-device-permissions");
const backend_health_1 = require("./backend-health");
const runtime_recovery_1 = require("./runtime-recovery");
const shutdown_1 = require("./shutdown");
// ── GPU compatibility ────────────────────────────────────────────────────────
// On Windows, some systems hit "GPU process exited unexpectedly" (exit code
// 0xC0000135 = STATUS_DLL_NOT_FOUND) because the GPU sandbox can't find
// required DLLs (outdated drivers, missing Vulkan, etc.).  Disabling the GPU
// sandbox lets the renderer fall back to software/Skia rendering which is
// slower but reliable.  This is a no-op on macOS/Linux.
//
// Trade-off: this removes Chromium's GPU isolation for ALL Windows users,
// not just those with the DLL crash.  For a local desktop POS app the attack
// surface is already large (server binds 0.0.0.0), so the practical risk is
// low.  A conditional approach (detect crash, store flag, re-launch with
// sandbox disabled) adds complexity for minimal security gain here.
if (process.platform === 'win32') {
    electron_1.app.commandLine.appendSwitch('disable-gpu-sandbox');
}
// Mac App Store builds: Electron sets process.mas = true inside the MAS sandbox.
// MAS_BUILD=1 is the build-time fallback (dev/CI).
const isMasBuild = process.env.MAS_BUILD === '1' ||
    process.mas === true;
// Microsoft Store (MSIX) builds: Electron has no process.msix equivalent.
// MSIX apps are always installed under C:\Program Files\WindowsApps\ so
// checking the executable path is the most reliable runtime detection.
const isMsixBuild = process.platform === 'win32' &&
    process.execPath.toLowerCase().includes('windowsapps');
// Either store build: skip third-party auto-updater entirely.
const isStoreBuild = isMasBuild || isMsixBuild;
const UNPACKED_DEV_MARKER = 'flo-unpacked-dev.marker';
main_1.default.initialize();
main_1.default.transports.file.level = 'info';
main_1.default.transports.console.level = 'debug';
const logPath = main_1.default.transports.file.getFile().path.replace(/[^\/\\]+$/, '');
console.log('[Log] Log files location:', logPath);
// Single persisted update state (#467): every transition (including one-shot
// startup states and failures) goes through here so a renderer reload can
// recover the truth via get-update-status instead of racing push events.
let storedUpdateStatus = (0, update_state_1.initialUpdateState)();
let updaterPhase = 'check';
let stagedUpdateReady = false;
let startupFailure = false;
let isInstallingUpdate = false;
let betaChannelTransitionTail = Promise.resolve();
// Beta-channel opt-in persistence (#463, decision #503). The preference lives
// in the same SQLite settings store as the rest of the app configuration so it
// survives restarts; failures degrade to "stable" (the safe default) instead
// of breaking the updater.
function readBetaChannelEnabled() {
    try {
        const row = (0, db_1.getDatabase)()
            .prepare('SELECT value FROM settings WHERE key = ?')
            .get(update_channel_1.BETA_CHANNEL_SETTING_KEY);
        const prerelease = electron_updater_1.autoUpdater.currentVersion.prerelease[0];
        const isBetaBuild = prerelease === 'beta';
        return (0, update_channel_1.parseStoredBetaChannelEnabled)(row?.value, isBetaBuild);
    }
    catch (error) {
        main_1.default.warn('[Update] Could not read beta-channel preference; using stable:', error);
        return false;
    }
}
function writeBetaChannelEnabled(enabled) {
    (0, db_1.getDatabase)()
        .prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run(update_channel_1.BETA_CHANNEL_SETTING_KEY, enabled ? 'true' : 'false', (0, db_1.now)());
}
function enqueueBetaChannelTransition(operation) {
    const transition = betaChannelTransitionTail.then(operation, operation);
    betaChannelTransitionTail = transition.then(() => undefined, () => undefined);
    return transition;
}
function configureAutoUpdaterChannel(betaOptInOverride) {
    const prerelease = electron_updater_1.autoUpdater.currentVersion.prerelease[0];
    const versionChannel = typeof prerelease === 'string' ? prerelease : null;
    const resolved = (0, update_channel_1.resolveUpdateChannel)({
        versionPrereleaseChannel: versionChannel,
        betaOptIn: betaOptInOverride ?? readBetaChannelEnabled(),
    });
    electron_updater_1.autoUpdater.channel = resolved.channel;
    electron_updater_1.autoUpdater.allowPrerelease = resolved.allowPrerelease;
    // Downgrade is only enabled for beta builds remaining on the beta feed;
    // opting out or running stable disables downgrades to safely graduate on
    // the next matching or newer stable release.
    electron_updater_1.autoUpdater.allowDowngrade = resolved.allowDowngrade;
    if (resolved.channel) {
        main_1.default.info(`[Update] Opted into ${resolved.channel} release channel`);
    }
    else if (versionChannel) {
        // Do not let an unsupported prerelease (nightly stamp, local alpha, ...)
        // accidentally subscribe an installation to an untracked channel (#503:
        // nightly releases are rejected; such installs get stable updates).
        main_1.default.warn(`[Update] Unsupported prerelease channel ${versionChannel}; using stable updates only`);
    }
}
function setUpdateStatus(next) {
    if (next.status !== storedUpdateStatus.status) {
        const reasonSuffix = next.reason ? ` (${next.reason})` : '';
        main_1.default.info(`[Update] Status change: ${storedUpdateStatus.status} -> ${next.status}${reasonSuffix}`);
    }
    storedUpdateStatus = next;
    mainWindow?.webContents.send('update-status', storedUpdateStatus);
}
function setupAutoUpdater() {
    electron_updater_1.autoUpdater.logger = main_1.default;
    configureAutoUpdaterChannel();
    // Downloading is harmless and lets the user see a ready-to-install build,
    // but installation must always be an explicit action. A POS may be closed
    // while a payment, printer job, or end-of-day workflow is still in flight.
    electron_updater_1.autoUpdater.autoDownload = true;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = false;
    electron_updater_1.autoUpdater.on('checking-for-update', () => {
        console.log('[Update] Checking for updates...');
        updaterPhase = 'check';
        setUpdateStatus({ status: 'checking' });
    });
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        // autoDownload is true, so electron-updater starts downloading right after
        // this fires on its own — no dialog, no manual download-update call needed.
        console.log('[Update] Update available, downloading silently:', info.version);
        updaterPhase = 'download';
        setUpdateStatus({
            status: 'available',
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes
        });
    });
    electron_updater_1.autoUpdater.on('update-not-available', () => {
        console.log('[Update] No updates available');
        setUpdateStatus({ status: 'up-to-date' });
    });
    electron_updater_1.autoUpdater.on('download-progress', (progress) => {
        console.log(`[Update] Download progress: ${progress.percent.toFixed(1)}%`);
        setUpdateStatus({
            status: 'downloading',
            percent: progress.percent,
            version: storedUpdateStatus.version
        });
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        // The renderer's update badge shows a "Restart Now" prompt. Because
        // autoInstallOnAppQuit is disabled, only that explicit action installs it.
        console.log('[Update] Download complete:', info.version);
        stagedUpdateReady = true;
        updaterPhase = 'check';
        setUpdateStatus({
            status: 'ready-to-install',
            version: info.version
        });
    });
    electron_updater_1.autoUpdater.on('error', (0, updater_shutdown_1.createAutoUpdaterErrorHandler)({
        getPhase: () => updaterPhase,
        setPhase: (phase) => { updaterPhase = phase; },
        isInstallReady: () => (0, update_state_1.isInstallReady)(storedUpdateStatus, stagedUpdateReady),
        isInstallingUpdate: () => isInstallingUpdate,
        setUpdateStatus,
        onInstallFailure: () => requestRuntimeRelaunchOnce('update-install-failed'),
        logInfo: (message, detail) => main_1.default.info(message, detail),
    }));
}
function checkForUpdates() {
    if ((0, update_state_1.isInstallReady)(storedUpdateStatus, stagedUpdateReady)) {
        main_1.default.info('[Update] Ignoring check while a staged update awaits installation');
        return;
    }
    if ((0, update_state_1.isUpdateCheckInFlight)(storedUpdateStatus, updaterPhase)) {
        main_1.default.info('[Update] Ignoring check while another update operation is in progress');
        return;
    }
    // Linux: only AppImage supports self-update via electron-updater (it sets
    // the APPIMAGE env var at launch). deb/rpm/snap are managed by their
    // package manager / the snap daemon instead — electron-updater can't
    // update those, so tell the renderer and stop instead of letting
    // "Check for Updates" sit there doing nothing forever when clicked.
    if (process.platform === 'linux' && !process.env.APPIMAGE) {
        main_1.default.info('[Update] Linux non-AppImage install — updates managed by package manager');
        setUpdateStatus((0, update_state_1.oneShotUpdateState)('linux-managed'));
        return;
    }
    if (isStoreBuild) {
        main_1.default.debug('[Update] Store build — updates handled by the platform store');
        setUpdateStatus((0, update_state_1.oneShotUpdateState)('store-managed'));
        return;
    }
    const isUpdaterDevelopmentArtifact = (0, update_state_1.isDevelopmentOrUnpackedArtifact)({
        defaultApp: process.defaultApp === true,
        packaged: electron_1.app.isPackaged,
        unpackedMarker: fs.existsSync(path.join(process.resourcesPath, UNPACKED_DEV_MARKER)),
    });
    const configPath = path.join(process.resourcesPath, 'app-update.yml');
    let configMissing = false;
    let configProbeFailed = false;
    let configProbeError;
    if (!isUpdaterDevelopmentArtifact) {
        try {
            fs.statSync(configPath);
        }
        catch (error) {
            if ((0, update_state_1.isMissingUpdateConfigError)(error)) {
                configMissing = true;
            }
            else {
                configProbeFailed = true;
                configProbeError = error;
            }
        }
    }
    const configDetail = `app-update.yml not found at ${configPath}`;
    if (isUpdaterDevelopmentArtifact) {
        main_1.default.debug('[Update] Skipping update check in dev mode');
        setUpdateStatus((0, update_state_1.oneShotUpdateState)('dev-mode'));
        return;
    }
    if (configProbeFailed) {
        const classified = (0, update_state_1.classifyUpdateError)(configProbeError, 'check');
        main_1.default.info(`[Update] Update configuration probe classified as ${classified.state}` +
            `/${classified.reason}:`, classified.detail);
        setUpdateStatus({
            status: classified.state,
            reason: classified.reason,
            error: classified.detail
        });
        return;
    }
    if (configMissing) {
        main_1.default.info('[Update] Packaged build is missing app-update.yml at', configPath);
        setUpdateStatus((0, update_state_1.missingUpdateConfigState)(false, configDetail));
        return;
    }
    updaterPhase = 'check';
    setUpdateStatus({ status: 'checking' });
    electron_updater_1.autoUpdater.checkForUpdates().catch((err) => {
        // The `error` event above records the honest classified state; this
        // catch only prevents an unhandled promise rejection.
        console.error('[Update] Check failed:', err);
    });
}
// Separate from the app self-updater above: tax packs are the only plugin
// type FloCafe currently supports, installed from the FloCafe-Plugins GitHub
// Releases catalog rather than through electron-updater. This is a
// best-effort, network-optional check — a store must keep working offline,
// so a failure here only logs and never blocks startup.
async function checkTaxPackUpdatesOnStartup() {
    try {
        const remote = await (0, catalog_1.fetchRemoteTaxPackCatalog)();
        const installedRows = (0, db_1.getDatabase)().prepare(`
      SELECT pack.id AS pack_id, pack.country, pack.publisher, version.version
      FROM country_packs AS pack
      JOIN country_pack_versions AS version ON version.id = pack.active_version_id
      WHERE pack.status = 'active'
    `).all();
        const updates = (0, catalog_1.computeTaxPackUpdates)(installedRows.map((row) => ({ packId: row.pack_id, country: row.country, publisher: row.publisher, version: row.version })), remote.catalog);
        if (updates.length > 0) {
            const summary = updates.map((update) => `${update.packId} ${update.currentVersion} -> ${update.latestVersion}`).join(', ');
            console.log(`[Tax Packs] ${updates.length} plugin update(s) available: ${summary}`);
        }
        else {
            console.log('[Tax Packs] Plugin update check: all installed tax packs are up to date');
        }
    }
    catch (error) {
        console.warn('[Tax Packs] Startup plugin update check skipped (offline or catalog unavailable):', error);
    }
}
let mainWindow = null;
let tray = null;
// createWindow() can run more than once per app lifetime after a renderer
// crash or window destruction. Activation and recovery are gated below so a
// new window is never created against a stopped runtime. Every window shares
// the same default session (no partition/session is set in webPreferences) —
// registering again on each call would stack duplicate 'select-usb-device'
// listeners on that shared session, firing multiple confirmation dialogs per
// request.
let usbDevicePermissionsRegistered = false;
// Title-bar capability reported to the renderer via get-status; updated each
// time the main window is created.
let resolvedTitleBarMode = 'native-overlay';
// Injected as a getter into ipc.ts — it cannot import ./index (load-time cycle).
let currentEffectiveIsDark = false;
let bonjour = null;
let isQuitting = false;
let runtimeState = 'starting';
let initializationPromise = null;
let activationPending = false;
let windowLoadRecoveryAttempted = false;
let windowRecoveryInProgress = false;
let runtimeRelaunchRequested = false;
const updateShutdownState = {
    setInstallingUpdate: (value) => { isInstallingUpdate = value; },
    setQuitting: (value) => {
        isQuitting = value;
        if (value) {
            runtimeState = 'stopping';
            main_1.default.info('[Lifecycle] Runtime is stopping');
        }
    },
};
function showMainWindow(expectedWindow) {
    if (isQuitting || isShutdownRequested())
        return false;
    if (expectedWindow && mainWindow !== expectedWindow)
        return false;
    if (!mainWindow || mainWindow.isDestroyed())
        return false;
    if (!(0, runtime_recovery_1.isRuntimeHealthy)(runtimeState, getRuntimeServices(), isShutdownRequested())) {
        void handleMainWindowActivation();
        return false;
    }
    if (isFailedWindowDocument(mainWindow)) {
        recoverFailedWindow(mainWindow);
        return false;
    }
    if ((!(0, window_readiness_1.isWindowRendererReady)() && !(0, window_readiness_1.isRendererReadinessFailSafeShown)()))
        return false;
    if (mainWindow.isMinimized())
        mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
    return true;
}
function getRuntimeServices() {
    return {
        main: (0, server_1.isServerRunning)(),
        kds: (0, kds_server_1.isKdsServerRunning)(),
        serverApp: (0, server_app_1.isServerAppRunning)(),
    };
}
function isFailedWindowDocument(window) {
    try {
        return window.webContents.getURL().startsWith('chrome-error://');
    }
    catch {
        return true;
    }
}
function recoverFailedWindow(failedWindow) {
    if (isQuitting || isShutdownRequested() || runtimeState === 'stopping')
        return;
    if (mainWindow !== failedWindow)
        return;
    if (!(0, runtime_recovery_1.isRuntimeHealthy)(runtimeState, getRuntimeServices(), isShutdownRequested())) {
        requestRuntimeRelaunchOnce('window-load-retry-exhausted');
        return;
    }
    if (windowLoadRecoveryAttempted) {
        requestRuntimeRelaunchOnce('window-load-recovery-failed');
        return;
    }
    windowLoadRecoveryAttempted = true;
    try {
        createWindow();
        if (!failedWindow.isDestroyed())
            failedWindow.destroy();
    }
    catch (error) {
        main_1.default.error('[Window] Window recreation failed:', error);
        requestRuntimeRelaunchOnce('window-load-recovery-create-failed');
    }
}
// createRelaunchGate() only bounds relaunches within a single process's
// lifetime — a relaunched process gets a fresh gate. Bound repeat relaunches
// across process restarts too (e.g. a permanently occupied port would
// otherwise make every new instance immediately detect the same failure and
// relaunch again): the relaunched process's own argv carries this flag, so a
// second failure shows a native dialog instead of looping.
const RUNTIME_RELAUNCH_ATTEMPT_FLAG = '--flo-runtime-relaunch-attempt';
function hasAlreadyAttemptedRuntimeRelaunch() {
    return (0, runtime_recovery_1.hasRelaunchAttemptFlag)(process.argv, RUNTIME_RELAUNCH_ATTEMPT_FLAG);
}
// Gates repeat relaunches across process restarts (see hasAlreadyAttemptedRuntimeRelaunch
// above), but only until this process's runtime first recovers — see
// createRelaunchAttemptGuard for why an outright process-lifetime check is wrong.
const relaunchAttemptGuard = (0, runtime_recovery_1.createRelaunchAttemptGuard)(hasAlreadyAttemptedRuntimeRelaunch());
function performAppRelaunch() {
    if (process.defaultApp || !electron_1.app.isPackaged) {
        const relaunchArgs = process.argv.slice(1).map((arg) => (arg === '.' ? process.cwd() : arg));
        // Playwright applies Chromium switches through app.commandLine, and its
        // Electron loader removes those injected switches from process.argv. Read
        // the effective command line so a Linux relaunch retains the sandbox flags
        // it needs to start under CI.
        if (electron_1.app.commandLine.hasSwitch('no-sandbox') && !relaunchArgs.includes('--no-sandbox')) {
            relaunchArgs.push('--no-sandbox');
        }
        if (electron_1.app.commandLine.hasSwitch('disable-gpu') && !relaunchArgs.includes('--disable-gpu')) {
            relaunchArgs.push('--disable-gpu');
        }
        if (electron_1.app.commandLine.hasSwitch('disable-dev-shm-usage') && !relaunchArgs.includes('--disable-dev-shm-usage')) {
            relaunchArgs.push('--disable-dev-shm-usage');
        }
        if (!relaunchArgs.includes(RUNTIME_RELAUNCH_ATTEMPT_FLAG))
            relaunchArgs.push(RUNTIME_RELAUNCH_ATTEMPT_FLAG);
        electron_1.app.relaunch({ execPath: process.execPath, args: relaunchArgs });
    }
    else {
        const relaunchArgs = process.argv.slice(1);
        if (!relaunchArgs.includes(RUNTIME_RELAUNCH_ATTEMPT_FLAG))
            relaunchArgs.push(RUNTIME_RELAUNCH_ATTEMPT_FLAG);
        electron_1.app.relaunch({ args: relaunchArgs });
    }
}
function requestRuntimeRelaunch(reason) {
    runtimeState = 'stopping';
    isQuitting = true;
    runtimeRelaunchRequested = true;
    main_1.default.error(`[Lifecycle] Runtime recovery relaunch requested: ${reason}`);
    if (process.env.FLO_E2E_PID_FILE)
        console.log('[Native E2E] runtime relaunch requested');
    const alreadyAttempted = relaunchAttemptGuard.hasExhaustedAttempt();
    const finishRelaunch = () => {
        try {
            if (alreadyAttempted) {
                main_1.default.error(`[Lifecycle] Runtime already relaunched once and failed again (${reason}); not relaunching again.`);
                electron_1.dialog.showErrorBox('Flo needs to restart', 'Flo could not recover automatically. Please quit and reopen the app.');
            }
            else {
                main_1.default.info('[Lifecycle] Runtime cleanup finished; relaunching Flo');
                performAppRelaunch();
            }
            electron_1.app.exit(0);
        }
        catch (error) {
            main_1.default.error('[Lifecycle] Runtime relaunch failed after cleanup:', error);
            electron_1.app.exit(1);
        }
    };
    void runCleanup().then(finishRelaunch, (error) => {
        main_1.default.error('[Lifecycle] Runtime recovery cleanup failed; proceeding anyway:', error);
        finishRelaunch();
    });
}
const requestRuntimeRelaunchOnce = (0, runtime_recovery_1.createRelaunchGate)(requestRuntimeRelaunch);
const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
let gotSingleInstanceLock = false;
// ── Single-instance lock ──────────────────────────────────────────────────────
// Prevent multiple instances of the app from running simultaneously.
// This is especially important on Linux where the AppImage can be launched
// multiple times without the OS preventing it.
if (process.env.FLO_E2E_USER_DATA_DIR) {
    // Native Playwright supplies a disposable profile so Electron's single
    // instance lock, caches, and session storage cannot collide with a user or
    // another test run. Normal launches retain their platform-specific paths.
    electron_1.app.setPath('userData', path.resolve(process.env.FLO_E2E_USER_DATA_DIR));
}
else if (process.platform === 'linux') {
    // Explicitly set app name and userData path to prevent Electron from
    // resolving them inside temporary mount paths (e.g. /tmp/.mount_FloXXXXXX)
    electron_1.app.name = 'flo-desktop';
    electron_1.app.setPath('userData', path.join(os.homedir(), '.config', 'flo-desktop'));
}
gotSingleInstanceLock = electron_1.app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    console.log('[Lock] Another instance is already running. Quitting.');
    electron_1.app.quit();
    process.exit(0);
}
if (gotSingleInstanceLock) {
    // Focus the existing window if a second launch is attempted.
    electron_1.app.on('second-instance', () => {
        void handleMainWindowActivation();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.focus();
            if (process.platform === 'linux') {
                mainWindow.setAlwaysOnTop(true);
                mainWindow.setAlwaysOnTop(false);
                electron_1.app.focus();
            }
        }
    });
}
function createWindow() {
    if (isQuitting || isShutdownRequested())
        return;
    if (!(0, runtime_recovery_1.isRuntimeHealthy)(runtimeState, getRuntimeServices(), isShutdownRequested())) {
        main_1.default.error('[Lifecycle] Refusing to create a POS window without a healthy runtime');
        requestRuntimeRelaunchOnce('create-window-without-healthy-runtime');
        return;
    }
    // Runs on every call, not just the initial one. Window recreation is routed
    // through handleMainWindowActivation(), which verifies the runtime before
    // allowing this function to create a new renderer.
    (0, startup_cache_1.clearStaleRenderCachesOnVersionChange)(electron_1.app.getPath('userData'), process.versions.electron, main_1.default);
    // Readiness lifecycle: register the fail-safe show path and begin the first
    // document epoch before anything loads. Every subsequent full-document
    // navigation re-begins via the did-start-navigation hook below.
    (0, window_readiness_1.initWindowReadiness)(() => {
        showMainWindow();
    });
    (0, window_readiness_1.beginRendererDocument)();
    // Decide once per window whether the native titleBarOverlay can be relied
    // on (platform + Electron >= 33 + the overlay API actually present). When
    // it cannot, the window ships without overlay options and the renderer
    // mounts HTML fallback controls so we never end up hidden-with-no-controls.
    resolvedTitleBarMode = (0, window_options_1.resolveTitleBarMode)({
        platform: process.platform,
        electronVersion: process.versions.electron,
        overlayApiPresent: typeof electron_1.BrowserWindow.prototype?.setTitleBarOverlay === 'function',
    });
    // Direct read: createWindow() runs before IPC handlers exist; re-read on
    // crash-recovery re-entry. Absent/invalid rows resolve to 'system'.
    let themeMode = 'system';
    try {
        const row = (0, db_1.getDatabase)()
            .prepare("SELECT value FROM settings WHERE key = 'theme_mode'")
            .get();
        themeMode = (0, title_bar_theme_1.resolveThemeMode)(row?.value);
    }
    catch {
        // No DB yet (first boot edge) → 'system'.
    }
    const initialIsDark = (0, title_bar_theme_1.resolveInitialIsDark)(themeMode, electron_1.nativeTheme.shouldUseDarkColors);
    currentEffectiveIsDark = initialIsDark;
    const createdWindow = (0, window_options_1.createMainWindow)(electron_1.BrowserWindow, path.join(__dirname, 'preload.js'), process.platform, initialIsDark, resolvedTitleBarMode);
    mainWindow = createdWindow;
    mainWindow.once('ready-to-show', () => {
        if (isDev) {
            mainWindow?.webContents.openDevTools();
        }
    });
    // Begin epochs before the new document's preload runs. Unlike
    // did-start-loading, did-start-navigation exposes whether a navigation is
    // same-document, so Next.js pushState route changes keep the current
    // readiness report while reloads and full navigations invalidate it.
    mainWindow.webContents.on('did-start-navigation', (_event, _url, isSameDocument, isMainFrame) => {
        if ((0, window_readiness_1.isFullDocumentMainFrameNavigation)({ isSameDocument, isMainFrame })) {
            (0, window_readiness_1.beginRendererDocument)();
        }
    });
    // Always load from the embedded Express server (serves static Next.js export).
    // This avoids file:// protocol issues and keeps dev/prod behaviour identical.
    mainWindow.loadURL(`http://localhost:${(0, server_1.getServerPort)()}`);
    // Allow target="_blank" links to open new windows for local URLs (e.g. the KDS page)
    // and blank popup windows (e.g. browser print popups). External URLs are sent to the system browser.
    const localWindowOpenHandler = (0, window_options_1.createLocalWindowOpenHandler)(url_allowlist_1.isAllowedLocalWindowUrl, server_1.getServerPort, server_1.getLocalIP);
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        const localWindowResponse = localWindowOpenHandler({ url });
        if (localWindowResponse)
            return localWindowResponse;
        if ((0, url_allowlist_1.isSafeExternalUrl)(url)) {
            electron_1.shell.openExternal(url).catch((err) => console.warn('[Flo] Failed to open external URL:', err?.message || err));
        }
        else {
            console.warn('[Flo] Blocked unsafe external URL scheme:', url);
        }
        return { action: 'deny' };
    });
    // Intercept all renderer downloads and show a save dialog instead of
    // auto-saving to Downloads — required for MAS sandbox compliance.
    mainWindow.webContents.session.on('will-download', (_event, item) => {
        item.setSaveDialogOptions({
            defaultPath: path.join(electron_1.app.getPath('documents'), item.getFilename()),
        });
    });
    // Required for the renderer's WebUSB printer flow (PrinterService.connect())
    // to resolve at all — see usb-device-permissions.ts. Registered at most
    // once per app lifetime; see usbDevicePermissionsRegistered above.
    if (!usbDevicePermissionsRegistered) {
        (0, usb_device_permissions_1.registerUsbDevicePermissions)(mainWindow.webContents.session, `http://localhost:${(0, server_1.getServerPort)()}`);
        usbDevicePermissionsRegistered = true;
    }
    const sendWindowState = () => {
        if (!createdWindow || createdWindow.isDestroyed())
            return;
        try {
            createdWindow.webContents.send('window-state-changed', {
                isMaximized: createdWindow.isMaximized(),
                isFullScreen: createdWindow.isFullScreen(),
            });
        }
        catch {
            // Ignored if webContents destroyed
        }
    };
    createdWindow.on('maximize', sendWindowState);
    createdWindow.on('unmaximize', sendWindowState);
    createdWindow.on('enter-full-screen', sendWindowState);
    createdWindow.on('leave-full-screen', sendWindowState);
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });
    mainWindow.on('closed', () => {
        if (mainWindow === createdWindow)
            mainWindow = null;
    });
    mainWindow.webContents.once('did-finish-load', () => {
        windowLoadRecoveryAttempted = false;
    });
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        main_1.default.error('[Window] Renderer process gone:', details.reason);
        console.error('[Window] Renderer process gone:', details.reason);
        if (details.reason !== 'clean-exit' && mainWindow === createdWindow) {
            electron_1.dialog.showMessageBox({
                type: 'error',
                title: 'App Crashed',
                message: 'The app crashed and will restart.',
                detail: `Reason: ${details.reason}`,
                buttons: ['OK'],
            }).then(() => {
                if (mainWindow !== createdWindow)
                    return;
                windowRecoveryInProgress = true;
                try {
                    createdWindow.destroy();
                    if (mainWindow === createdWindow)
                        mainWindow = null;
                    void handleMainWindowActivation();
                }
                finally {
                    windowRecoveryInProgress = false;
                }
            }).catch((error) => {
                main_1.default.error('[Window] Renderer crash recovery failed:', error);
                if (!isQuitting && !isShutdownRequested()) {
                    requestRuntimeRelaunchOnce('renderer-crash-recovery-failed');
                }
            });
        }
    });
    (0, window_load_retry_1.setupWindowLoadRetry)(createdWindow, () => `http://localhost:${(0, server_1.getServerPort)()}`, {
        log: main_1.default,
        onRetryExhausted: ({ errorCode, errorDescription, validatedURL, retries }) => {
            main_1.default.error('[Window] Load retry exhaustion:', errorCode, errorDescription, validatedURL, `retries=${retries}`);
            recoverFailedWindow(createdWindow);
        },
    });
    mainWindow.webContents.on('unresponsive', () => {
        console.warn('[Window] Window became unresponsive');
    });
    mainWindow.webContents.on('responsive', () => {
        console.log('[Window] Window became responsive again');
    });
}
async function handleMainWindowActivation() {
    const services = getRuntimeServices();
    const hasWindow = Boolean(mainWindow && !mainWindow.isDestroyed());
    const action = (0, runtime_recovery_1.decideRuntimeActivationAction)({
        state: runtimeState,
        hasWindow,
        services,
        shutdownRequested: isQuitting || isShutdownRequested(),
    });
    main_1.default.info(`[Lifecycle] Activation action=${action} state=${runtimeState}`
        + ` services=${services.main ? 'main' : 'no-main'},${services.kds ? 'kds' : 'no-kds'},${services.serverApp ? 'server-app' : 'no-server-app'}`);
    if (action === 'show') {
        // getRuntimeServices() only checks isServerRunning()-style non-null
        // references, which stay true even if a server's HTTP listener died
        // silently (none of the three attach an 'error' listener) — exactly the
        // scenario issue #548 reported. Confirm the backend is actually
        // answering before trusting that check to show an existing window.
        const reallyHealthy = await (0, backend_health_1.probeBackendHealth)({
            server: (0, server_1.getServerPort)(),
            kds: (0, kds_server_1.getKdsPort)(),
            serverApp: (0, server_app_1.getServerAppPort)(),
        });
        // Shutdown or update installation may have started while the probe was
        // in flight — a stale failure must not request a relaunch mid-shutdown.
        if (isQuitting || isShutdownRequested())
            return;
        if (!reallyHealthy) {
            requestRuntimeRelaunchOnce('activation-health-probe-failed');
            return;
        }
        showMainWindow();
        return;
    }
    if (action === 'create') {
        createWindow();
        return;
    }
    if (action === 'wait') {
        if (!initializationPromise) {
            activationPending = true;
            return;
        }
        void initializationPromise.then(() => { void handleMainWindowActivation(); }, (error) => {
            main_1.default.error('[Lifecycle] Startup failed while activation was waiting:', error);
            requestRuntimeRelaunchOnce('activation-startup-failed');
        });
        return;
    }
    if (action === 'ignore')
        return;
    requestRuntimeRelaunchOnce(`activation-runtime-unavailable-${runtimeState}`);
}
// ── Sleep/wake repaint recovery ─────────────────────────────────────────────
// macOS/Chromium's GPU compositor can fail to repaint after the display goes
// to sleep and wakes back up, leaving the window fully white until the user
// force-quits it. No crash occurs — render-process-gone never fires because
// the renderer is still alive, it just stops painting. Nudging the window
// size by a pixel forces the native compositor to recompute and redraw
// without touching webContents (no reload, no loss of in-progress renderer
// state). Registered once; mainWindow is re-read from the module-level `let`
// on every resume, so it stays correct across window recreation.
function registerPowerMonitorRecovery() {
    electron_1.powerMonitor.on('resume', () => {
        console.log('[Window] System resumed from sleep, forcing repaint');
        // The display/GPU pipeline isn't necessarily back immediately on resume;
        // give it a moment before nudging so the repaint has something to show.
        setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())
                return;
            const [width, height] = mainWindow.getSize();
            mainWindow.setSize(width + 1, height);
            mainWindow.setSize(width, height);
        }, 1000);
    });
}
function createTray() {
    if (process.platform === 'linux') {
        // ── Linux system tray ────────────────────────────────────────────────────
        // On Linux the window close button hides the window (same as other
        // platforms), but there is no native macOS-style dock or Windows taskbar
        // integration to bring it back. A system-tray icon gives Linux users a
        // persistent, discoverable way to show the window or fully quit the app
        // (which triggers the existing quit handler that tears down DB, servers,
        // mDNS, etc.).
        const linuxIconPath = isDev
            ? path.join(__dirname, '../../assets/icon-512.png')
            : path.join(process.resourcesPath, 'assets/icon-512.png');
        try {
            const linuxIcon = electron_1.nativeImage.createFromPath(linuxIconPath);
            tray = new electron_1.Tray(linuxIcon.resize({ width: 22, height: 22 }));
            const linuxMenu = electron_1.Menu.buildFromTemplate([
                {
                    label: 'Show',
                    click: () => {
                        if (mainWindow) {
                            if (showMainWindow())
                                mainWindow.focus();
                        }
                    },
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    click: () => {
                        isQuitting = true;
                        // On Debian/AppIndicator, quitting while the context menu is open
                        // can cause a deadlock. Defer the teardown so the menu can close.
                        setTimeout(() => {
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.destroy();
                            }
                            // Explicitly destroy tray to release the AppIndicator lock
                            if (tray) {
                                tray.destroy();
                                tray = null;
                            }
                            // will-quit owns the same awaited cleanup sequence as every
                            // other Electron entrypoint. Do not force-exit while resources
                            // are still draining.
                            electron_1.app.quit();
                        }, 100);
                    },
                },
            ]);
            tray.setToolTip('Flo Cafe');
            tray.setContextMenu(linuxMenu);
            // Single-click also shows the window on Linux (no double-click standard).
            tray.on('click', () => {
                if (mainWindow) {
                    if (showMainWindow())
                        mainWindow.focus();
                }
            });
            console.log('[Tray] Linux tray created');
        }
        catch {
            console.log('[Tray] Linux icon not found, skipping tray');
        }
        return;
    }
    // ── macOS / Windows tray ─────────────────────────────────────────────────
    const iconPath = isDev
        ? path.join(__dirname, '../../assets/icon.png')
        : path.join(process.resourcesPath, 'assets/icon.png');
    try {
        const icon = electron_1.nativeImage.createFromPath(iconPath);
        tray = new electron_1.Tray(icon.resize({ width: 16, height: 16 }));
        const contextMenu = electron_1.Menu.buildFromTemplate([
            { label: 'Open Flo', click: () => { showMainWindow(); } },
            { type: 'separator' },
            { label: 'Quit', click: () => { isQuitting = true; electron_1.app.quit(); } },
        ]);
        tray.setToolTip('Flo');
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => { showMainWindow(); });
    }
    catch {
        console.log('[Tray] Icon not found, skipping tray');
    }
}
function startMdns() {
    try {
        bonjour = new bonjour_service_1.Bonjour();
        bonjour.publish({
            name: 'Flo',
            type: 'http',
            port: (0, server_1.getServerPort)(),
            host: 'flo', // resolves as flo.local on the LAN
            txt: { version: electron_1.app.getVersion(), kds: `/kds`, kds_port: String((0, kds_server_1.getKdsPort)()), server_app: '/server-standalone', server_app_port: String((0, server_app_1.getServerAppPort)()) },
        });
        const ip = (0, server_1.getLocalIP)();
        console.log(`[mDNS] Advertising flo.local:${(0, server_1.getServerPort)()}  (IP fallback: http://${ip}:${(0, server_1.getServerPort)()})`);
        console.log(`[mDNS] KDS available at http://flo.local:${(0, kds_server_1.getKdsPort)()}  (IP fallback: http://${ip}:${(0, kds_server_1.getKdsPort)()})`);
        console.log(`[mDNS] Server App available at http://flo.local:${(0, server_app_1.getServerAppPort)()}  (IP fallback: http://${ip}:${(0, server_app_1.getServerAppPort)()})`);
    }
    catch (err) {
        console.warn('[mDNS] Could not start Bonjour:', err);
    }
}
function stopMdns() {
    // Capture the instance before clearing the global reference. Bonjour invokes
    // this callback later, after unpublishAll has finished.
    const instance = bonjour;
    bonjour = null;
    if (!instance)
        return Promise.resolve();
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            finish(new Error(`Bonjour shutdown timed out after ${shutdown_1.SHUTDOWN_TIMEOUT_MS}ms`));
        }, shutdown_1.SHUTDOWN_TIMEOUT_MS);
        const finish = (unpublishError) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            try {
                instance.destroy();
            }
            catch (destroyError) {
                if (unpublishError) {
                    reject(new AggregateError([unpublishError, destroyError], 'Bonjour shutdown failed'));
                }
                else {
                    reject(destroyError);
                }
                return;
            }
            if (unpublishError)
                reject(unpublishError);
            else
                resolve();
        };
        try {
            instance.unpublishAll(() => finish());
        }
        catch (error) {
            finish(error);
        }
    });
}
function createMenu() {
    const template = [
        ...(process.platform === 'darwin' ? [{
                label: electron_1.app.getName(),
                submenu: [
                    { label: `About ${electron_1.app.getName()}`, click: () => showAbout() },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { label: 'Quit', accelerator: 'Cmd+Q', click: () => { isQuitting = true; electron_1.app.quit(); } },
                ],
            }] : []),
        {
            label: 'File',
            submenu: [
                { label: 'New Order', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('new-order') },
                { label: 'Quick Search', accelerator: 'CmdOrCtrl+K', click: () => mainWindow?.webContents.send('quick-search') },
                { type: 'separator' },
                { label: 'Backup Database', click: () => mainWindow?.webContents.send('backup-database') },
                { label: 'Restore Backup', click: () => mainWindow?.webContents.send('restore-backup') },
                { type: 'separator' },
                { label: 'Database Health Check', click: () => mainWindow?.webContents.send('menu-db-health-check') },
                { label: 'Initialize Database', click: () => mainWindow?.webContents.send('menu-db-initialize') },
                { label: 'Master PIN…', click: () => mainWindow?.webContents.send('menu-master-pin') },
                { type: 'separator' },
                { label: 'Exit', accelerator: process.platform === 'darwin' ? undefined : 'CmdOrCtrl+Q', click: () => { isQuitting = true; electron_1.app.quit(); } },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ],
        },
        {
            label: 'Orders',
            submenu: [
                { label: 'View All Orders', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('view-orders') },
            ],
        },
        {
            label: 'Reports',
            submenu: [
                { label: 'Daily Summary', click: () => mainWindow?.webContents.send('report-daily') },
                { label: 'Sales Report', click: () => mainWindow?.webContents.send('report-sales') },
                { label: 'X Report', click: () => mainWindow?.webContents.send('report-x') },
                { label: 'Z Report', click: () => mainWindow?.webContents.send('report-z') },
            ],
        },
        {
            label: 'Settings',
            submenu: [
                { label: 'Business Settings', click: () => mainWindow?.webContents.send('settings-business') },
                { label: 'Tax Settings', click: () => mainWindow?.webContents.send('settings-tax') },
                { label: 'Printer Setup', click: () => mainWindow?.webContents.send('settings-printer') },
                { label: 'Kitchen Stations', click: () => mainWindow?.webContents.send('settings-kitchen') },
            ],
        },
        {
            label: 'Window',
            submenu: [
                { label: 'Flo Cafe', click: () => { if (showMainWindow())
                        mainWindow?.focus(); } },
                { type: 'separator' },
                { role: 'minimize' },
                ...(process.platform === 'darwin' ? [
                    { role: 'zoom' },
                    { type: 'separator' },
                    { role: 'front' },
                ] : []),
            ],
        },
        {
            label: 'Help',
            submenu: [
                ...(process.platform !== 'darwin' ? [{ label: 'About Flo', click: () => showAbout() }] : []),
                ...(isStoreBuild
                    ? []
                    : [{ label: 'Check for Updates', click: () => checkForUpdates() }]),
                { label: 'Open Logs Folder', click: () => electron_1.shell.showItemInFolder(main_1.default.transports.file.getFile().path) },
            ],
        },
    ];
    if (isDev) {
        template.push({
            label: 'Developer',
            submenu: [
                { label: 'Toggle DevTools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
                { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
            ],
        });
    }
    const menu = electron_1.Menu.buildFromTemplate(template);
    electron_1.Menu.setApplicationMenu(menu);
}
function showAbout() {
    const ip = (0, server_1.getLocalIP)();
    const kdsPort = (0, kds_server_1.getKdsPort)();
    const serverAppPort = (0, server_app_1.getServerAppPort)();
    electron_1.dialog.showMessageBox({
        type: 'info',
        title: 'About Flo',
        message: 'Flo Cafe',
        detail: [
            `Version: ${electron_1.app.getVersion()}`,
            `Electron: ${process.versions.electron}`,
            `Node: ${process.versions.node}`,
            '',
            'A self-hosted, offline-first Point of Sale system.',
            'Your data stays yours.',
            '',
            `POS URL: http://flo.local:${(0, server_1.getServerPort)()}`,
            `KDS URL: http://flo.local:${kdsPort}`,
            `Server App URL: http://flo.local:${serverAppPort}`,
            '',
            `KDS IP fallback: http://${ip}:${kdsPort}`,
            `Server App IP fallback: http://${ip}:${serverAppPort}`,
        ].join('\n'),
    });
}
async function initialize() {
    runtimeState = 'starting';
    main_1.default.info('[Lifecycle] Runtime is starting');
    try {
        if (isShutdownRequested())
            return;
        console.log('[Flo] Initializing...');
        console.log('[Flo] Initializing database...');
        (0, db_1.initDatabase)();
        if (isShutdownRequested())
            return;
        console.log('[Flo] Starting local server...');
        await (0, server_1.startServer)();
        if (isShutdownRequested())
            return;
        cloud_sync_1.cloudSync.start();
        telemetry_1.telemetry.start();
        google_drive_1.googleDrive.start();
        console.log('[Flo] Starting KDS server on port 3002...');
        await (0, kds_server_1.startKdsServer)();
        if (isShutdownRequested())
            return;
        console.log('[Flo] Starting Server App on port 3003...');
        await (0, server_app_1.startServerApp)();
        if (isShutdownRequested())
            return;
        console.log('[Flo] Initializing WhatsApp service...');
        (0, whatsapp_1.initFromDb)();
        // Native E2E owns an offline fixture; optional LAN discovery must not
        // contend with a developer session or keep the test process alive.
        if (process.env.FLO_E2E_SKIP_OPTIONAL_NETWORK !== '1') {
            console.log('[Flo] Starting mDNS advertisement...');
            startMdns();
        }
        console.log('[Flo] Initializing printer...');
        await (0, thermal_1.initPrinter)();
        if (isShutdownRequested())
            return;
        console.log('[Flo] Registering IPC handlers...');
        (0, ipc_1.registerIpcHandlers)(shutdownSignal, () => mainWindow, showMainWindow, () => currentEffectiveIsDark);
        electron_1.ipcMain.handle('get-update-status', () => 
        // #467: return the real persisted state (including not-checked-yet and
        // one-shot states) so renderer reloads recover it.
        (0, update_state_1.toIpcUpdateStatus)(storedUpdateStatus, electron_1.app.getVersion()));
        electron_1.ipcMain.handle('check-for-updates', () => {
            checkForUpdates();
        });
        electron_1.ipcMain.handle('updates:get-beta-channel', () => 
        // Persisted preference only — whether beta releases are *offered* is
        // decided by resolveUpdateChannel at check time, so this stays honest
        // even if the running version forces a specific channel.
        (0, db_1.withDatabaseRequest)(() => readBetaChannelEnabled()));
        electron_1.ipcMain.handle('updates:set-beta-channel', (_event, enabled) => {
            if (typeof enabled !== 'boolean') {
                return { success: false, error: 'enabled must be a boolean' };
            }
            return enqueueBetaChannelTransition(() => (0, db_1.withDatabaseRequest)(async () => {
                // #467 honest-state model: never swap feeds underneath an in-flight or
                // staged update. The renderer surfaces the refusal as a real state
                // instead of silently masking what the updater is doing.
                if ((0, update_state_1.isInstallReady)(storedUpdateStatus, stagedUpdateReady)) {
                    return { success: false, error: 'A downloaded update is waiting to be installed — install it before switching channels' };
                }
                if ((0, update_state_1.isUpdateCheckInFlight)(storedUpdateStatus, updaterPhase)) {
                    return { success: false, error: 'An update check or download is in progress — try again once it finishes' };
                }
                try {
                    writeBetaChannelEnabled(enabled);
                }
                catch (error) {
                    main_1.default.error('[Update] Failed to persist beta-channel preference:', error);
                    return { success: false, error: 'Could not save the channel preference' };
                }
                main_1.default.info(`[Update] Beta channel ${enabled ? 'enabled' : 'disabled'} by user`);
                // Re-derive allowPrerelease/channel for the running install, then reset
                // to the real pre-check state and immediately re-check against the new
                // feed — the renderer sees genuine states, not a fabricated answer.
                configureAutoUpdaterChannel(enabled);
                setUpdateStatus((0, update_state_1.initialUpdateState)());
                checkForUpdates();
                return { success: true };
            }));
        });
        // #463: restarting to install takes the whole POS down (server, KDS,
        // printing) until the app comes back up, so it is gated behind manager or
        // owner PIN approval. The PIN check runs here in the main process — the
        // same authorizeMasterPin used by every other master-PIN-gated IPC
        // handler — so no renderer path can bypass the guard.
        //
        // Cleanup runs *before* quitAndInstall so the shutdown coordinator's
        // will-quit handler sees cleanupFinished=true and exits immediately,
        // allowing the platform installer hook (Squirrel.Mac / NSIS / AppImage)
        // to relaunch the new version. Without this ordering, the coordinator
        // calls event.preventDefault() on the first will-quit (blocking the
        // installer's relaunch), then calls app.quit() a second time as a plain
        // quit with no relaunch - the new version is never launched.
        electron_1.ipcMain.handle('restart-and-install', (0, updater_shutdown_1.createRestartAndInstallHandler)({
            isInstallReady: () => (0, update_state_1.isInstallReady)(storedUpdateStatus, stagedUpdateReady),
            authorize: (pin) => (0, master_pin_1.authorizeMasterPin)(pin, 'ipc:restart-and-install'),
            runCleanup,
            quitAndInstall: (isSilent, isForceRunAfter) => electron_updater_1.autoUpdater.quitAndInstall(isSilent, isForceRunAfter),
            updateState: updateShutdownState,
            onInstallFailure: () => requestRuntimeRelaunchOnce('update-install-failed'),
            warn: (message) => main_1.default.warn(message),
            error: (message, error) => main_1.default.error(message, error),
        }));
        electron_1.ipcMain.handle('get-status', () => {
            const mem = process.memoryUsage();
            return {
                server: (0, server_1.isServerRunning)() ? 'running' : 'stopped',
                kdsServer: (0, kds_server_1.isKdsServerRunning)() ? 'running' : 'stopped',
                serverApp: (0, server_app_1.isServerAppRunning)() ? 'running' : 'stopped',
                memory: {
                    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
                    rss: Math.round(mem.rss / 1024 / 1024),
                },
                uptime: process.uptime(),
                port: (0, server_1.getServerPort)(),
                titleBarMode: resolvedTitleBarMode,
                titleBarEpoch: (0, window_readiness_1.getRendererReadinessEpoch)(),
                titleBarDocumentNonce: (0, window_readiness_1.getRendererDocumentNonce)() ?? undefined,
                effectiveTheme: currentEffectiveIsDark ? 'dark' : 'light',
            };
        });
        runtimeState = 'ready';
        relaunchAttemptGuard.markRuntimeRecovered();
        main_1.default.info('[Lifecycle] Runtime is ready');
        electron_1.ipcMain.handle('set-theme-effective', (event, isDark) => {
            // gh-513 F8: validate the sender — the ipc.ts handle() wrapper applies
            // this guard to its registered handlers; this raw ipcMain.handle sits
            // outside that wrapper and would otherwise accept any LAN-rendered
            // sender. Same guard semantics (main/ipc.ts isTrustedSender).
            if (!(0, ipc_1.isTrustedSender)(event)) {
                return { success: false, error: 'Untrusted sender' };
            }
            if (typeof isDark !== 'boolean') {
                return { success: false, error: 'isDark must be boolean' };
            }
            currentEffectiveIsDark = isDark;
            if (mainWindow && !mainWindow.isDestroyed()) {
                (0, title_bar_theme_1.applyTitleBarOverlayTheme)(mainWindow, isDark, process.platform);
                // Background base matches the overlay tokens so resize/gap edges
                // never flash the wrong palette.
                mainWindow.setBackgroundColor((0, title_bar_theme_1.resolveTitleBarOverlayColors)(isDark).color);
            }
            return { success: true };
        });
        console.log('[Flo] Creating window...');
        createWindow();
        registerPowerMonitorRecovery();
        createTray();
        createMenu();
        // Auto-updater: wired up on every non-store platform, including Linux now
        // (#58) — checkForUpdates() itself decides whether Linux's build format
        // (AppImage vs deb/rpm/snap) actually supports self-update.
        if (!isStoreBuild) {
            if (process.env.FLO_E2E_SKIP_OPTIONAL_NETWORK !== '1') {
                setupAutoUpdater();
                setTimeout(() => checkForUpdates(), 5000);
            }
        }
        else {
            // Store builds skip electron-updater entirely; seed the persisted state
            // so the renderer shows honest "managed by the store" status from the
            // first load instead of a stale never-checked default (#467).
            setUpdateStatus((0, update_state_1.oneShotUpdateState)('store-managed'));
        }
        if (process.env.FLO_E2E_SKIP_OPTIONAL_NETWORK !== '1') {
            setTimeout(() => { void checkTaxPackUpdatesOnStartup(); }, 5000);
        }
        console.log('[Flo] Ready!');
    }
    catch (error) {
        runtimeState = 'failed';
        main_1.default.error('[Lifecycle] Runtime initialization failed:', error);
        console.error('[Flo] Initialization error:', error);
        const errorDetails = error;
        const expectedShutdownCancellation = errorDetails?.code === 'ERR_SHUTDOWN_ABORTED'
            || errorDetails?.code === 'ABORT_ERR'
            || errorDetails?.name === 'AbortError';
        if (!expectedShutdownCancellation)
            startupFailure = true;
        if (isShutdownRequested()) {
            try {
                await runCleanup();
            }
            catch (cleanupError) {
                console.error('[Flo] Cleanup after interrupted initialization failed:', cleanupError);
            }
            return;
        }
        electron_1.dialog.showErrorBox('Initialization Error', `Failed to start Flo: ${error}`);
        // Best-effort: report the fatal startup failure so support can see which
        // installs are stuck on a stale build without waiting for a user to
        // describe the error message themselves. The cleanup below remains safe
        // even when initialization failed before the database or listeners opened.
        try {
            const payload = {
                error_message: String(error instanceof Error ? error.message : error).slice(0, 500),
            };
            if (error instanceof db_1.SchemaVersionMismatchError) {
                payload.db_schema_version = error.dbVersion;
                payload.app_schema_version = error.appVersion;
            }
            await (0, telemetry_1.sendEvent)('startup_failed', payload);
        }
        catch (telemetryError) {
            console.error('[Flo] Failed to report startup error via telemetry:', telemetryError);
        }
        isQuitting = true;
        try {
            await runCleanup();
        }
        catch (cleanupError) {
            console.error('[Flo] Cleanup after initialization failure failed:', cleanupError);
        }
        // Cleanup has settled (or reported its bounded failure) before exiting.
        electron_1.app.exit(1);
    }
    finally {
        if (isShutdownRequested() && runtimeState === 'starting')
            runtimeState = 'stopping';
    }
}
electron_1.app.whenReady().then(() => {
    initializationPromise = initialize();
    void initializationPromise.then(() => {
        if (!activationPending)
            return;
        activationPending = false;
        void handleMainWindowActivation();
    }, (error) => {
        if (!activationPending)
            return;
        activationPending = false;
        main_1.default.error('[Lifecycle] Startup failed while activation was pending:', error);
        if (!isQuitting && !isShutdownRequested())
            requestRuntimeRelaunchOnce('activation-startup-failed');
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !windowRecoveryInProgress) {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    void handleMainWindowActivation();
});
if (process.env.NODE_ENV === 'test' && process.env.FLO_E2E_PID_FILE) {
    try {
        fs.writeFileSync(process.env.FLO_E2E_PID_FILE, String(process.pid));
    }
    catch (error) {
        main_1.default.error('[Native E2E] Could not write Electron PID:', error);
    }
}
// --- Cleanup function (idempotent — safe to call from every entrypoint) ---
const cleanupCoordinator = (0, shutdown_1.createShutdownCoordinator)(() => [
    {
        name: 'tray',
        run: () => {
            const currentTray = tray;
            tray = null;
            if (currentTray)
                currentTray.destroy();
        },
    },
    // The Server App can be forwarding an active request to the main API, so
    // drain it before closing the API listener it depends on.
    { name: 'Server App', run: () => (0, server_app_1.stopServerApp)(), blocksDatabase: true },
    { name: 'Main server', run: () => (0, server_1.stopServer)(), blocksDatabase: true },
    { name: 'KDS server', run: () => (0, kds_server_1.stopKdsServer)(), blocksDatabase: true },
    { name: 'cloud sync', run: () => cloud_sync_1.cloudSync.shutdown(), blocksDatabase: true },
    { name: 'telemetry', run: () => telemetry_1.telemetry.stop(), blocksDatabase: true },
    { name: 'Google Drive', run: () => google_drive_1.googleDrive.stop(), blocksDatabase: true },
    { name: 'WhatsApp', run: () => (0, whatsapp_1.shutdown)(), blocksDatabase: true },
    { name: 'Bonjour', run: () => stopMdns() },
    { name: 'HTTP handler cleanup', run: () => (0, shutdown_1.waitForHttpShutdownWork)(), blocksDatabase: true },
    { name: 'database admission', run: () => (0, db_1.beginDatabaseShutdown)(), blocksDatabase: true },
    { name: 'database requests', run: () => (0, db_1.waitForDatabaseRequests)(), blocksDatabase: true },
    // Database closure is deliberately last: all HTTP and WebSocket work must
    // have settled before handlers can lose access to SQLite.
    { name: 'database', run: () => (0, db_1.closeDatabase)(), databaseClose: true },
], {
    onFatalTimeout: () => {
        // When shutting down to install an update, do not force-kill the process
        // via app.exit(1) on a timeout; let runCleanup() reject and hand off to
        // autoUpdater.quitAndInstall() so the update can still proceed.
        if (!isInstallingUpdate && !runtimeRelaunchRequested) {
            electron_1.app.exit(1);
        }
    },
});
const { runCleanup, isShutdownRequested, shutdownSignal } = (0, shutdown_1.createShutdownEntrypoints)({
    app: electron_1.app,
    process: process,
    cleanup: async () => {
        main_1.default.info('[Lifecycle] Cleanup started');
        console.log('[Flo] Running cleanup...');
        try {
            await cleanupCoordinator();
            main_1.default.info('[Lifecycle] Cleanup completed');
            console.log('[Flo] Goodbye!');
        }
        catch (error) {
            main_1.default.error('[Lifecycle] Cleanup failed:', error);
            console.error('[Flo] Cleanup failed:', error);
            throw error;
        }
    },
    setQuitting: () => {
        isQuitting = true;
        runtimeState = 'stopping';
    },
    onShutdownRequested: whatsapp_1.requestShutdown,
    destroyWindow: () => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.destroy();
    },
    isInstallingUpdate: () => isInstallingUpdate,
    reportFailure: (context, error) => {
        console.error(`[Flo] Cleanup failed before ${context}:`, error);
    },
    getSignalExitCode: () => startupFailure ? 1 : 0,
    getQuitExitCode: () => startupFailure ? 1 : 0,
});
process.on('uncaughtException', (error) => {
    main_1.default.error('[Flo] Uncaught exception:', error);
    console.error('[Flo] Uncaught exception:', error);
});
process.on('unhandledRejection', (reason) => {
    main_1.default.error('[Flo] Unhandled rejection:', reason);
    console.error('[Flo] Unhandled rejection:', reason);
});
//# sourceMappingURL=index.js.map