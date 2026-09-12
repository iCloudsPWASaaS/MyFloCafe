"use strict";
/**
 * Unified Print Receipt Service
 *
 * Logs print actions (receipt/reprint) to the print_logs table
 * and updates the bill's printed_at timestamp.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.printReceipt = printReceipt;
const db_1 = require("../db");
async function printReceipt(billId, userId, printType) {
    const db = (0, db_1.getDatabase)();
    // Log the print action and update bill timestamp atomically
    const result = (0, db_1.withTxn)(() => {
        const bill = db.prepare('SELECT id FROM bills WHERE id = ?').get(billId);
        if (!bill) {
            throw new Error('Bill not found');
        }
        const insertResult = db.prepare('INSERT INTO print_logs (bill_id, user_id, print_type, printed_at) VALUES (?, ?, ?, ?)').run(billId, userId, printType, (0, db_1.now)());
        // Update bill's printed_at timestamp
        db.prepare('UPDATE bills SET printed_at = ?, updated_at = ? WHERE id = ?')
            .run((0, db_1.now)(), (0, db_1.now)(), billId);
        return insertResult;
    });
    return { success: true, printLogId: result.lastInsertRowid };
}
//# sourceMappingURL=receipt.js.map