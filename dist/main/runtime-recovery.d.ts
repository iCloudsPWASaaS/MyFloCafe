export type RuntimeState = 'starting' | 'ready' | 'stopping' | 'failed';
export type RuntimeServices = {
    main: boolean;
    kds: boolean;
    serverApp: boolean;
};
export type RuntimeActivationAction = 'show' | 'create' | 'wait' | 'relaunch' | 'ignore';
export declare function isRuntimeHealthy(state: RuntimeState, services: RuntimeServices, shutdownRequested: boolean): boolean;
export declare function decideRuntimeActivationAction(input: {
    state: RuntimeState;
    hasWindow: boolean;
    services: RuntimeServices;
    shutdownRequested: boolean;
}): RuntimeActivationAction;
export declare function createRelaunchGate(onRelaunch: (reason: string) => void): (reason: string) => boolean;
/**
 * createRelaunchGate() only bounds relaunches within a single process's
 * lifetime — a relaunched process gets a fresh gate on module load. This
 * checks whether the CURRENT process's own argv already carries the marker
 * a prior relaunch attempt appended, so a persistent failure (e.g. a
 * permanently occupied port) degrades to a clear dialog after one relaunch
 * instead of looping indefinitely across process restarts.
 */
export declare function hasRelaunchAttemptFlag(argv: readonly string[], attemptFlag: string): boolean;
/**
 * Bounds hasRelaunchAttemptFlag() to the window between process start and the
 * runtime's first successful recovery, rather than the whole process
 * lifetime. Without this, a process that carries the attempt marker (because
 * it is itself the result of a relaunch) would treat every later relaunch
 * request as a second failed attempt forever — even hours after that relaunch
 * succeeded and the runtime ran healthy — and show the manual-restart dialog
 * instead of trying to recover from a new, unrelated failure.
 */
export declare function createRelaunchAttemptGuard(processCarriesAttemptFlag: boolean): {
    hasExhaustedAttempt: () => boolean;
    markRuntimeRecovered: () => void;
};
//# sourceMappingURL=runtime-recovery.d.ts.map