/**
 * Unified Print Receipt Service
 *
 * Logs print actions (receipt/reprint) to the print_logs table
 * and updates the bill's printed_at timestamp.
 */
export type PrintType = 'receipt' | 'reprint';
export declare function printReceipt(billId: number, userId: string, printType: PrintType): Promise<{
    success: boolean;
    printLogId?: number;
}>;
//# sourceMappingURL=receipt.d.ts.map