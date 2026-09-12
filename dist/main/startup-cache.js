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
Object.defineProperty(exports, "__esModule", { value: true });
exports.STALE_RENDER_CACHE_DIRS = void 0;
exports.clearStaleRenderCachesOnVersionChange = clearStaleRenderCachesOnVersionChange;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// A large Electron version jump (e.g. 31 -> 43) can leave V8 Code Cache and
// GPU shader cache entries in userData that were built for a different
// Chromium ABI. When the new Chromium replays that stale state, it can
// produce a malformed internal message; Chromium's IPC validator rejects it
// as a bad Mojo message on content.mojom.ChildProcessHost and force-kills
// the renderer (bad_message.cc, reason 123). Because the crash recovery path
// immediately recreates the window, it replays the same stale cache and
// crashes again — an infinite "Renderer process gone: killed" loop.
//
// Stamping the running Electron version per userData profile and wiping
// these caches whenever it doesn't match what's recorded avoids replaying
// cache built for a different engine build. A *missing* marker is treated
// the same as a mismatch (not skipped): it's what every profile that
// predates this check looks like on its first launch under the new code —
// exactly the upgrade path this exists to fix. Clearing is harmless when
// there's nothing to clear (rmSync with force:true is a no-op on paths that
// don't exist).
exports.STALE_RENDER_CACHE_DIRS = [
    'Code Cache',
    'GPUCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'Shader Cache',
];
const VERSION_MARKER_FILENAME = '.electron-version';
function clearStaleRenderCachesOnVersionChange(userDataPath, currentElectronVersion, logger = console, fsOps = fs) {
    const versionFile = path.join(userDataPath, VERSION_MARKER_FILENAME);
    let previousVersion = null;
    try {
        previousVersion = fsOps.readFileSync(versionFile, 'utf8').toString().trim();
    }
    catch {
        // No marker yet: either a brand-new profile (nothing to clear) or an
        // existing profile from before this check existed (needs clearing).
        // Fall through and let the mismatch branch below handle both.
    }
    if (previousVersion !== currentElectronVersion) {
        let allCleared = true;
        for (const dir of exports.STALE_RENDER_CACHE_DIRS) {
            try {
                fsOps.rmSync(path.join(userDataPath, dir), { recursive: true, force: true });
            }
            catch (err) {
                allCleared = false;
                logger.warn(`[Flo] Failed to clear stale cache dir "${dir}":`, err.message);
            }
        }
        if (!allCleared) {
            // Leave the marker as it was so the next launch retries the
            // directories that failed to clear, instead of silently giving up.
            return;
        }
        logger.debug(`[Flo] Electron version marker ${previousVersion ?? '(none)'} -> ${currentElectronVersion}; cleared render caches to avoid a stale-cache crash loop.`);
    }
    try {
        fsOps.mkdirSync(userDataPath, { recursive: true });
        fsOps.writeFileSync(versionFile, currentElectronVersion, 'utf8');
    }
    catch (err) {
        logger.warn('[Flo] Failed to write Electron version marker:', err.message);
    }
}
//# sourceMappingURL=startup-cache.js.map