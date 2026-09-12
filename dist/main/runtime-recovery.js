"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRuntimeHealthy = isRuntimeHealthy;
exports.decideRuntimeActivationAction = decideRuntimeActivationAction;
exports.createRelaunchGate = createRelaunchGate;
exports.hasRelaunchAttemptFlag = hasRelaunchAttemptFlag;
exports.createRelaunchAttemptGuard = createRelaunchAttemptGuard;
function isRuntimeHealthy(state, services, shutdownRequested) {
    return state === 'ready'
        && !shutdownRequested
        && services.main
        && services.kds
        && services.serverApp;
}
function decideRuntimeActivationAction(input) {
    if (input.shutdownRequested || input.state === 'stopping')
        return 'ignore';
    if (input.state === 'failed')
        return 'relaunch';
    if (input.state === 'starting')
        return 'wait';
    if (!isRuntimeHealthy(input.state, input.services, input.shutdownRequested))
        return 'relaunch';
    return input.hasWindow ? 'show' : 'create';
}
function createRelaunchGate(onRelaunch) {
    let relaunchRequested = false;
    return (reason) => {
        if (relaunchRequested)
            return false;
        relaunchRequested = true;
        onRelaunch(reason);
        return true;
    };
}
/**
 * createRelaunchGate() only bounds relaunches within a single process's
 * lifetime — a relaunched process gets a fresh gate on module load. This
 * checks whether the CURRENT process's own argv already carries the marker
 * a prior relaunch attempt appended, so a persistent failure (e.g. a
 * permanently occupied port) degrades to a clear dialog after one relaunch
 * instead of looping indefinitely across process restarts.
 */
function hasRelaunchAttemptFlag(argv, attemptFlag) {
    return argv.includes(attemptFlag);
}
/**
 * Bounds hasRelaunchAttemptFlag() to the window between process start and the
 * runtime's first successful recovery, rather than the whole process
 * lifetime. Without this, a process that carries the attempt marker (because
 * it is itself the result of a relaunch) would treat every later relaunch
 * request as a second failed attempt forever — even hours after that relaunch
 * succeeded and the runtime ran healthy — and show the manual-restart dialog
 * instead of trying to recover from a new, unrelated failure.
 */
function createRelaunchAttemptGuard(processCarriesAttemptFlag) {
    let recovered = false;
    return {
        hasExhaustedAttempt: () => processCarriesAttemptFlag && !recovered,
        markRuntimeRecovered: () => { recovered = true; },
    };
}
//# sourceMappingURL=runtime-recovery.js.map