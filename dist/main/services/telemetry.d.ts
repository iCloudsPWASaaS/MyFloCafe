/**
 * Anonymous usage telemetry — independent of cloud sync (sends whether or
 * not this store has cloud sync configured, since it's a separate concern).
 * Enabled by default for new installs. The owner can switch it off at any
 * time in Settings > Privacy. Tier 2 store diagnostics is a separate,
 * explicit opt-in and is never bundled into this stream.
 *
 * anon_id is a random UUID persisted locally (see db.ensureTelemetryAnonId),
 * never a store id, device id, or anything else that ties back to a business.
 * See specs/floadmin.md § Anonymous telemetry for the endpoint contract.
 */
export declare const TELEMETRY_URL = "https://telemetry.flopos.com/collect";
export declare function sendEvent(eventType: string, payload?: Record<string, unknown>): Promise<boolean>;
export declare const telemetry: {
    start(): void;
    stop(): Promise<void>;
};
//# sourceMappingURL=telemetry.d.ts.map