import { getDatabase } from '../db';
export declare function getTenantCurrency(): string;
type BillLoyaltyRow = {
    [key: string]: unknown;
    id: number;
    customer_id?: number | string | null;
};
export declare function addBillLoyaltyFields(db: ReturnType<typeof getDatabase>, bill: BillLoyaltyRow | null | undefined): BillLoyaltyRow | null | undefined;
type ChildItemAllocation = {
    weights: number[];
    index: number;
};
export declare function projectOrderItems(order: any, rawItemRows: any[], allocations?: any[], childItemAllocations?: Map<number, ChildItemAllocation>, minorFactor?: number): any[];
export declare function getOrderWithItems(db: ReturnType<typeof getDatabase>, orderId: number, billId?: number): any;
export declare function getOrdersWithItemsForBills(db: ReturnType<typeof getDatabase>, bills: any[]): Map<number, any>;
export declare function allocateMinorUnits(sourceMinor: number, weights: number[]): number[];
export declare function allocateSignedMinorUnits(sourceMinor: number, weights: number[]): number[];
export declare function allocateTaxSnapshots(sourceRaw: unknown, weights: number[], snapshotWeights?: Array<number[] | null>, minorFactor?: number): (string | null)[];
interface OrderBillSyncValues {
    subtotal: number;
    taxAmount: number;
    taxBreakdown: string | null;
    taxSnapshot: string | null;
    discountAmount: number;
    deliveryCharge: number;
    packagingCharge: number;
    serviceCharge: number;
    total: number;
}
export declare function syncUnpaidBillsForOrder(db: ReturnType<typeof getDatabase>, orderId: number | string, source: OrderBillSyncValues, country: string): void;
export declare function paymentAmountMinorUnits(value: unknown, currency: string, label?: string): number;
export declare function paymentAmountCents(value: unknown, label?: string): number;
export declare const billRoutes: import("express-serve-static-core").Router;
export {};
//# sourceMappingURL=bills.d.ts.map