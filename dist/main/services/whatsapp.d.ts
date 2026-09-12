export type WhatsAppConnectionState = 'disconnected' | 'connecting' | 'waiting_qr' | 'waiting_pairing' | 'connected' | 'cooldown';
export interface WhatsAppStatus {
    enabled: boolean;
    state: WhatsAppConnectionState;
    connectedPhone: string | null;
    lastError: string | null;
    cooldownUntil: string | null;
    /**
     * Stable reason code for the last error. Frontend translates via i18n.
     * Distinct from `lastError` (which may be a raw third-party string for
     * debugging). Known values: `logged_out`, `reconnecting`, `rate_limited`.
     */
    lastErrorReason?: string | null;
    qr?: string;
    pairingCode?: string;
}
interface QueuedSend {
    phoneE164: string;
    body: string;
    billId: number | null;
    customerId: number | null;
    kind: 'bill_receipt' | 'manual_reply' | 'auto_followup';
    userId: string | null;
    signal?: AbortSignal;
}
export declare function getStatus(): WhatsAppStatus;
export declare function enable(userId: string): Promise<{
    ok: boolean;
    error?: string;
}>;
export declare function disable(): void;
export declare function connectWithQr(requestSignal?: AbortSignal): Promise<{
    ok: boolean;
    qr?: string;
    error?: string;
}>;
export declare function connectWithPairingCode(phone: string, requestSignal?: AbortSignal): Promise<{
    ok: boolean;
    code?: string;
    error?: string;
}>;
export declare function disconnect(): void;
export interface SendResult {
    ok: boolean;
    messageId?: number;
    error?: string;
    reason?: 'feature_off' | 'no_phone' | 'blocked' | 'rate_limited' | 'cooldown' | 'not_connected' | 'not_on_whatsapp' | 'content_blocked' | 'send_failed';
}
export declare function sendMessage(req: QueuedSend): Promise<SendResult>;
export interface InboxMessage {
    id: number;
    phone_e164: string;
    body: string;
    status: string;
    queued_at: string;
}
export declare function listInbox(limit: number, offset: number): InboxMessage[];
export interface SentMessageRow {
    id: number;
    phone_e164: string;
    bill_id: number | null;
    customer_id: number | null;
    direction: 'inbound' | 'outbound';
    kind: 'bill_receipt' | 'manual_reply' | 'auto_followup';
    status: string;
    body: string;
    error: string | null;
    queued_at: string;
    seen_at: string | null;
    typing_at: string | null;
    sent_at: string | null;
    delivered_at: string | null;
    read_at: string | null;
    failed_at: string | null;
    created_by_user_id: string | null;
}
export declare function listMessages(opts: {
    direction?: 'inbound' | 'outbound';
    status?: string;
    phone?: string;
    billId?: number;
    limit: number;
    offset: number;
}): SentMessageRow[];
export interface BlocklistRow {
    phone_e164: string;
    reason: string | null;
    blocked_at: string;
    blocked_by_user_id: string | null;
}
export declare function listBlocklist(): BlocklistRow[];
export declare function addToBlocklist(phoneE164: string, reason: string, userId: string): void;
export declare function removeFromBlocklist(phoneE164: string): boolean;
export declare function initFromDb(): void;
export declare function shutdown(): Promise<void>;
export declare function requestShutdown(): void;
export {};
//# sourceMappingURL=whatsapp.d.ts.map