/**
 * Outbound-only cloud bridge for FloCafe POS.
 *
 * The POS never opens a public listener. It registers with Blue over HTTPS,
 * pushes local events to an outbox endpoint, and polls a signed command queue
 * for whitelisted read-only requests such as reports and live orders.
 */
export declare const DEFAULT_CLOUD_SERVER_URL = "https://blue.flopos.com/";
export type SupportTicketInput = {
    client_ticket_id: string;
    subject: string;
    severity?: 'low' | 'normal' | 'high' | 'urgent';
    event_code?: string;
    correlation_id?: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    message: string;
    diagnostics?: Record<string, unknown> | null;
};
/**
 * Tier 2 store-attributed diagnostics (specs/floadmin.md § 6.2). No names,
 * phones, addresses, or order payloads belong in message/metadata — this is
 * "which typed error, on which store," not a log dump.
 */
export type DiagnosticEventInput = {
    event_id: string;
    event_code: string;
    severity: 'debug' | 'info' | 'warn' | 'error' | 'critical';
    correlation_id?: string;
    message?: string;
    metadata?: Record<string, unknown>;
    occurred_at: string;
};
export declare function normalizeCloudServerUrl(raw?: string | null): string;
export declare class CloudSyncService {
    private heartbeatTimer;
    private outboxTimer;
    private supportOutboxTimer;
    private diagnosticsOutboxTimer;
    private commandTimer;
    private settings;
    private flushing;
    private outboxFlushPromise;
    private pollingCommands;
    private relaySocket;
    private relayPingTimer;
    private relayAwaitingPong;
    private relayHeartbeatFrameTimer;
    private relayReconnectTimer;
    private relayReconnectAttempts;
    private httpFallbackActive;
    private relayMode;
    private supportFlushing;
    private supportFlushPromise;
    private diagnosticsFlushing;
    private diagnosticsFlushPromise;
    private cloudDeletionInProgress;
    private cloudNetworkOperations;
    private cloudNetworkIdleWaiters;
    private backgroundPromises;
    private relayCommandPromises;
    private commandPollPromises;
    private commandPollAbortController;
    private shutdownPromise;
    private shutdownRequested;
    private shutdownController;
    private autoRegisterTimer;
    private autoRegisterAttempts;
    private autoRegisterInFlight;
    private runtimeStarted;
    start(): void;
    reload(): void;
    resumeAfterMaintenance(): void;
    stop(): void;
    shutdown(): Promise<void>;
    private waitForBackgroundWork;
    private withDatabaseRequest;
    private teardownRelay;
    /**
     * Email preferences are an optional cloud-account feature. Keep callers
     * from attempting an outbound request when this install has no usable
     * cloud account or the owner explicitly stopped cloud services.
     */
    isCloudAccountAvailable(): boolean;
    getStatus(): {
        cloud_server_url: string;
        cloud_pos_hash: string | null;
        cloud_pos_id: string | null;
        cloud_sync_enabled: boolean;
        cloud_orders_enabled: boolean;
        cloud_reports_enabled: boolean;
        cloud_command_polling_enabled: boolean;
        cloud_registration_status: string;
        cloud_services_disabled_by_user: boolean;
        cloud_connected: boolean;
        cloud_last_sync: string | null;
        cloud_last_heartbeat: string | null;
        cloud_last_error: string | null;
        cloud_deletion_status: string;
        cloud_deletion_outcome: string;
        cloud_deletion_blocked: boolean;
        cloud_relay_mode: "websocket" | "http_fallback" | "disconnected";
        outbox_pending: number;
        outbox_failed: number;
        loaded: boolean;
    };
    register(signal?: AbortSignal): Promise<Record<string, unknown>>;
    testConnection(signal?: AbortSignal): Promise<Record<string, unknown>>;
    getEmailPreferences(signal?: AbortSignal): Promise<Record<string, unknown>>;
    updateEmailPreferences(preferences: {
        product_updates?: boolean;
        marketing?: boolean;
    }, signal?: AbortSignal): Promise<Record<string, unknown>>;
    requestEmailVerification(preferences?: {
        product_updates?: boolean;
        marketing?: boolean;
        source?: string;
    }, signal?: AbortSignal): Promise<Record<string, unknown>>;
    stopAllCloudServices(signal?: AbortSignal): Promise<Record<string, unknown>>;
    deleteCloudData(signal?: AbortSignal): Promise<Record<string, unknown>>;
    getDeletionRequestStatus(options?: {
        allowRemote?: boolean;
        signal?: AbortSignal;
    }): Promise<Record<string, unknown> | null>;
    cancelDeletionRequest(signal?: AbortSignal): Promise<Record<string, unknown>>;
    /**
     * Tells FloAdmin the merchant's current Tier 2 diagnostics choice, so
     * `stores.diagnostics_consent` server-side matches the local toggle in both
     * directions (on AND off) — not just inferred from "an event arrived."
     * Best-effort: if the POS is offline or unregistered right now, the very
     * next reportDiagnostic() call (when back online) is gated locally anyway,
     * and the next successful call here will still bring the server in sync.
     */
    setDiagnosticsConsent(enabled: boolean, signal?: AbortSignal): Promise<void>;
    /** Queue a support request durably; the caller can be offline. */
    queueSupportTicket(input: SupportTicketInput, signal?: AbortSignal): Promise<{
        queued: boolean;
        client_ticket_id: string;
    }>;
    private flushSupportTicketOutbox;
    /**
     * Queue a Tier 2 store-attributed diagnostic event durably. No-ops silently
     * when the merchant hasn't given the separate diagnostics_consent opt-in —
     * callers should not need to check this themselves before every call site.
     */
    reportDiagnostic(input: DiagnosticEventInput): void;
    private flushDiagnosticsOutbox;
    /**
     * Generate (or, with revoke=true, explicitly rotate) the RevFlo pairing
     * code for this store. revoke=true also disconnects every already-paired
     * device — only the explicit "Generate new code" action in Settings should
     * pass it; a plain cache-miss refetch must not silently kick anyone off.
     * See specs/floadmin.md § Device pairing.
     */
    generatePairingCode(revoke: boolean): Promise<{
        code: string;
        expires_at: string;
    }>;
    /** Devices (RevFlo installs) currently paired to this store. */
    listPairedDevices(): Promise<Record<string, unknown>[]>;
    recordOrderChanged(orderId: number | string, eventType?: string): void;
    sendOrderStatus(orderflowOrderId: string, status: string, note?: string): void;
    private buildHeartbeatPayload;
    /** HTTP fallback path — used only while the WSS relay is unavailable. */
    private sendHeartbeat;
    /** Primary path — heartbeat carried as a frame on the open relay connection. */
    private sendRelayHeartbeat;
    private enqueueEvent;
    private flushOutbox;
    private failSendingRows;
    private pollCommands;
    private executeCommand;
    /** Same as executeCommand, but for a command pushed over the relay socket — result goes back as a frame, not a POST. */
    private executeRelayCommand;
    private trackRelayCommand;
    private trackCommandPoll;
    /**
     * Register on every boot so FloAdmin receives refreshed store metadata
     * (name, contact, country, version) after setup changes. The server's
     * create-or-find endpoint preserves the installation identity and API key.
     */
    private maybeAutoRegister;
    /** Refresh FloAdmin after setup or store-profile settings change. */
    refreshRegistrationProfile(): void;
    private attemptAutoRegister;
    private maybeStartRelay;
    private connectRelay;
    private onRelayOpen;
    private onRelayMessage;
    private onRelayClosed;
    private scheduleRelayReconnect;
    /** Degraded mode — same HTTP command-poll/heartbeat behavior the POS shipped with before the relay existed. */
    private startHttpFallback;
    private stopHttpFallback;
    /**
     * Only reload when a flag actually *changes* — Blue may reasonably send `features` on every
     * heartbeat_ack (not just when something changed), and reloading unconditionally would tear
     * down and reopen the relay connection every heartbeat cycle, which itself immediately re-sends
     * a heartbeat and can spiral into a reconnect storm.
     */
    private applyFeatures;
    private runCommand;
    private healthPayload;
    private liveOrders;
    private getOrder;
    private salesReport;
    private dashboardReport;
    private hourlyReport;
    private itemsReport;
    private paymentsReport;
    private paymentBreakdown;
    private buildOrderSnapshot;
    private decorateOrder;
    /** Shared HMAC signing used by every signed HTTP call and the relay WS handshake — see floadmin.md § Identity & request signing. */
    private buildSignedHeaders;
    private signedFetch;
    private runBackground;
    private trackedFetch;
    private drainResponse;
    private waitForCloudNetworkIdle;
    private loadSettings;
    private readSettings;
    private upsertSettings;
    private countOutbox;
    private markError;
}
export declare const cloudSync: CloudSyncService;
//# sourceMappingURL=cloud-sync.d.ts.map