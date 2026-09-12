/**
 * Refund processing (#278): bill-level cash-back and item-level "already
 * prepared, must be pulled off a paid bill" refunds.
 *
 * Item-level refunds mirror the existing in-progress item-void mechanism
 * (main/routes/index.ts, PATCH /api/orders/:orderId/items/:itemId/cancel)
 * but for a bill that already has payment on it, which that endpoint always
 * blocks. Inventory is deliberately not restored — it was already consumed
 * when the item was prepared, same rule as the existing void path.
 */
import { getDatabase } from '../db';
type Database = ReturnType<typeof getDatabase>;
export declare const TERMINAL_ITEM_STATUSES: string[];
export declare function getTenantCurrency(db?: Database): string;
export interface RefundRequest {
    billId: string | number;
    orderItemId?: number | null;
    amountCents?: number;
    method?: string;
    reason?: string | null;
    shiftId?: string | null;
    overridePin: string;
    managerId?: string | null;
    createdByUserId: string;
    clientIp: string;
    checkPinRateLimit: (key: string) => boolean;
    idempotencyKey?: string | null;
    requestHash?: string;
}
export interface RefundResult {
    refund: any;
    bill: any;
}
/**
 * Returns the refundable balance for a bill in integer minor units.
 * `refunds.amount_cents` stores integer minor units scaled by `minorFactor`
 * (e.g. factor 1 for JPY, 100 for USD/INR, 1000 for KWD). Historical rows
 * originated exclusively under 2-decimal currencies where cents = minor units.
 */
export declare function getRefundableBalance(db: Database, billId: string | number, currency?: string): {
    paidCents: number;
    refundedCents: number;
    refundableCents: number;
};
/**
 * Validates, authorizes, and persists a refund. Must be called from inside
 * the caller's withTxn — mirrors applyPaymentBatch's caller contract, where
 * the whole function (idempotency lookup included) runs inside one
 * transaction (main/routes/bills.ts).
 */
export declare function createRefund(db: Database, req: RefundRequest): RefundResult;
export {};
//# sourceMappingURL=refund.d.ts.map