/**
 * Order notes validation functions.
 *
 * Separated from orders.ts so they can be imported by tests without
 * pulling in Electron, Express, or other heavy dependencies.
 *
 * Both functions accept a `db` parameter (any object with a `.prepare().get()`
 * interface) to stay dependency-free and testable with node:sqlite or better-sqlite3.
 */
export declare function validateOrderNotes(db: any, notes: string | null | undefined): void;
export declare function validateItemNotes(db: any, notes: string | null | undefined): void;
export declare function validateProductQuantity(product: {
    name?: string;
    sale_unit?: string;
    allow_fractional_quantity?: boolean | number;
    weight_precision?: number;
}, quantity: unknown): asserts quantity is number;
//# sourceMappingURL=orders-validation.d.ts.map