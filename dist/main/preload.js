"use strict";
const { contextBridge, ipcRenderer } = require('electron');
const { randomUUID } = require('node:crypto');
const documentNonce = randomUUID();
ipcRenderer.sendSync('window-document', documentNonce);
contextBridge.exposeInMainWorld('electronAPI', {
    backupDatabase: (pin) => ipcRenderer.invoke('backup-database', pin),
    restoreBackup: (pin, backupPath) => ipcRenderer.invoke('restore-backup', pin, backupPath),
    dbHealthCheck: () => ipcRenderer.invoke('db-health-check'),
    dbApplySafeFixes: (findingIds) => ipcRenderer.invoke('db-apply-safe-fixes', findingIds),
    dbInitialize: (pin, confirmationPhrase) => ipcRenderer.invoke('db-initialize', { pin, confirmationPhrase }),
    getMasterPinStatus: () => ipcRenderer.invoke('master-pin-status'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
    // Effective-theme push (gh-513): renderer resolves the user's theme_mode
    // and tells main so the native titleBarOverlay can follow. Narrow verb,
    // boolean-only, fire-and-forget on the renderer side.
    setThemeEffective: (isDark) => ipcRenderer.invoke('set-theme-effective', isDark),
    getKdsInfo: () => ipcRenderer.invoke('get-kds-info'),
    openKdsWindow: () => ipcRenderer.invoke('open-kds-window'),
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    getStatus: () => ipcRenderer.invoke('get-status'),
    windowReady: (payload) => ipcRenderer.invoke('window-ready', { ...payload, documentNonce }),
    // Narrow window-control surface for the renderer title bar's HTML fallback
    // controls and the POS topbar's native window-state toggle.
    windowAction: (action) => ipcRenderer.invoke('window-action', action),
    getWindowState: () => ipcRenderer.invoke('get-window-state'),
    onWindowStateChanged: (callback) => {
        const handler = (_event, state) => callback(state);
        ipcRenderer.on('window-state-changed', handler);
        return () => { ipcRenderer.removeListener('window-state-changed', handler); };
    },
    getPrinters: () => ipcRenderer.invoke('get-printers'),
    savePrinter: (printer) => ipcRenderer.invoke('save-printer', printer),
    getDailySummary: () => ipcRenderer.invoke('get-daily-summary'),
    getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
    getBetaChannel: () => ipcRenderer.invoke('updates:get-beta-channel'),
    setBetaChannel: (enabled) => ipcRenderer.invoke('updates:set-beta-channel', enabled),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    restartAndInstall: (pin) => ipcRenderer.invoke('restart-and-install', pin),
    onUpdateStatus: (callback) => {
        const handler = (_event, status) => callback(status);
        ipcRenderer.on('update-status', handler);
        return () => { ipcRenderer.removeListener('update-status', handler); };
    },
    onMenuAction: (callback) => {
        const channels = [
            'new-order', 'quick-search', 'backup-database', 'restore-backup',
            'view-orders', 'report-daily', 'report-sales', 'report-x', 'report-z',
            'settings-business', 'settings-tax', 'settings-printer', 'settings-kitchen',
            'menu-db-health-check', 'menu-db-initialize', 'menu-master-pin',
        ];
        const handlers = [];
        channels.forEach((channel) => {
            const handler = () => callback(channel);
            ipcRenderer.on(channel, handler);
            handlers.push(() => ipcRenderer.removeListener(channel, handler));
        });
        return () => { handlers.forEach((remove) => remove()); };
    },
    platform: process.platform,
});
//# sourceMappingURL=preload.js.map