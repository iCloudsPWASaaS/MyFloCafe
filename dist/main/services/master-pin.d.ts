export declare function isMasterPinAvailable(): boolean;
export declare function isMasterPinSet(): boolean;
/** Sets the master PIN for the first time (first-run setup). */
export declare function setMasterPin(pin: string): void;
/**
 * Overwrites the master PIN. Used both by first-run setup and by an
 * already-authenticated owner who forgot their PIN — the owner's normal
 * login session is the credential here, not the old PIN.
 */
export declare function resetMasterPin(pin: string): void;
export declare function verifyMasterPin(pin: string): boolean;
export declare function isMasterPinRateLimited(key: string): boolean;
export declare function recordMasterPinFailedAttempt(key: string): boolean;
export declare function resetMasterPinRateLimit(key: string): void;
export declare function checkMasterPinRateLimit(key: string): boolean;
export type MasterPinAuthResult = {
    ok: true;
    status?: undefined;
    error?: undefined;
} | {
    ok: false;
    status: number;
    error: string;
};
/**
 * Single authorization entry point for both the Express middleware and the
 * ipcMain handlers, so lockout/verification logic lives in exactly one place.
 */
export declare function authorizeMasterPin(pin: string | undefined, rateLimitKey: string): MasterPinAuthResult;
//# sourceMappingURL=master-pin.d.ts.map