"use strict";
/**
 * Order notes validation functions.
 *
 * Separated from orders.ts so they can be imported by tests without
 * pulling in Electron, Express, or other heavy dependencies.
 *
 * Both functions accept a `db` parameter (any object with a `.prepare().get()`
 * interface) to stay dependency-free and testable with node:sqlite or better-sqlite3.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateOrderNotes = validateOrderNotes;
exports.validateItemNotes = validateItemNotes;
exports.validateProductQuantity = validateProductQuantity;
const DEFAULT_MAX_ORDER_NOTES_LENGTH = 200;
const DEFAULT_MAX_ITEM_NOTES_LENGTH = 100;
function validateNoteLength(db, settingKey, defaultLimit, notes, label) {
    if (!notes)
        return;
    const rawValue = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey)?.value;
    const parsed = parseInt(rawValue || '', 10);
    const maxLength = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultLimit;
    if (notes.length > maxLength) {
        throw new Error(`${label} exceed maximum length of ${maxLength} characters`);
    }
}
function validateOrderNotes(db, notes) {
    validateNoteLength(db, 'max_order_notes_length', DEFAULT_MAX_ORDER_NOTES_LENGTH, notes, 'Order notes');
}
function validateItemNotes(db, notes) {
    validateNoteLength(db, 'max_item_notes_length', DEFAULT_MAX_ITEM_NOTES_LENGTH, notes, 'Item notes');
}
function validateProductQuantity(product, quantity) {
    const productName = product.name || 'product';
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
        throw Object.assign(new Error(`Invalid quantity for ${productName}: must be a positive number`), { statusCode: 400 });
    }
    if (Number.isInteger(quantity))
        return;
    if (!['kg', 'g', 'lb'].includes(product.sale_unit || 'each') || Number(product.allow_fractional_quantity) !== 1) {
        throw Object.assign(new Error(`Invalid quantity for ${productName}: fractional quantities are not allowed`), { statusCode: 400 });
    }
    const precision = Number.isInteger(product.weight_precision)
        ? Math.min(Math.max(Number(product.weight_precision), 0), 4)
        : 3;
    const scale = 10 ** precision;
    if (Math.abs(quantity * scale - Math.round(quantity * scale)) > 1e-8) {
        throw Object.assign(new Error(`Invalid quantity for ${productName}: use at most ${precision} decimal places`), { statusCode: 400 });
    }
}
//# sourceMappingURL=orders-validation.js.map