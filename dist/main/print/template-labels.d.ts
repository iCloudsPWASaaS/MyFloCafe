/**
 * Semantic label ids accepted on the optional payload-root `labels` map of
 * the `escpos-line-template-v1` compliance contract (#445, epic #438).
 *
 * These are stable PUBLIC identifiers for pack authors — deliberately NOT
 * internal i18n keys, which are not public API. Each id maps to exactly one
 * concept in the canonical print-labels catalog (#440), which supplies the
 * localized built-in default when a pack ships no override.
 *
 * Stability: once shipped, a semantic id never changes meaning or mapping;
 * unsupported ids are rejected at install time so authors get an immediate,
 * clear error instead of silently ignored copy.
 */
export declare const TEMPLATE_LABEL_IDS: {
    /** Receipt title when no tax applies. */
    readonly invoice: "print.invoiceTitle";
    /** Receipt title when tax applies (compliance "tax invoice"). */
    readonly taxInvoice: "print.taxInvoiceTitle";
    readonly subtotal: "pos.subtotal";
    readonly discount: "pos.discount";
    readonly tax: "pos.tax";
    /** Bold grand-total row label. */
    readonly total: "print.grandTotal";
    /** Persisted service-charge row label. */
    readonly serviceCharge: "receipt.serviceCharge";
    /** Persisted delivery-charge row label. */
    readonly deliveryCharge: "pos.delivery";
    /** Persisted packaging-charge row label. */
    readonly packagingCharge: "pos.packaging";
    /** Tax-inclusive pricing note (reserved; mapped to receipt.taxIncluded). */
    readonly taxIncluded: "receipt.taxIncluded";
    /** Default footer message when no configured footer note applies. */
    readonly footerThanks: "print.thankYouShort";
};
export type TemplateLabelId = keyof typeof TEMPLATE_LABEL_IDS;
/** Explicit charge-row capabilities in the v1 country-pack template contract. */
export declare const TEMPLATE_CHARGE_ROW_IDS: readonly ["serviceCharge", "deliveryCharge", "packagingCharge"];
export type TemplateChargeRowId = typeof TEMPLATE_CHARGE_ROW_IDS[number];
/** Install-time caps for the `labels` map (#445): fail closed on misuse. */
export declare const TEMPLATE_LABELS_MAX_ENTRIES = 64;
export declare const TEMPLATE_LABELS_MAX_VALUE_LENGTH = 120;
/**
 * Strip reserved printer tokens from template label text (#445 review F1).
 * Applied to every label resolved through this module before it reaches the
 * renderer; trusted catalog defaults contain no tokens, so this is a no-op
 * for built-in fallbacks and byte-compatible EN output is preserved.
 */
export declare function sanitizeTemplateLabelText(text: string): string;
/**
 * Sanitize a template label and clamp it to the selected width profile's
 * printable column count (#445 review F2, 32-48 columns). Over-long labels
 * are truncated with the codebase's `..` ellipsis convention so row-label
 * alignment math (`rightAlign(amount, cols - label.length)`) can never
 * overflow the physical receipt width.
 */
export declare function fitTemplateLabel(text: string, columns: number): string;
/**
 * Validate the optional `totals.chargeRows` capability declaration of an
 * `escpos-line-template-v1` payload at install time.
 *
 * Absent/null declarations pass (the field is additive and optional).
 * Structural misuse — non-array values, unsupported or duplicate ids — throws
 * with a clear rejection message that surfaces through pack install. The
 * renderer version stays 1: this is validation only, never a schema bump.
 */
export declare function validateTemplateChargeRows(rows: unknown): void;
/**
 * Resolve the declared rows in the contract's stable legal order. The array
 * declares capability; its order never changes country/legal output order.
 */
export declare function declaredTemplateChargeRows(rows: unknown): TemplateChargeRowId[];
/**
 * Validate the optional payload-root `labels` map of an
 * `escpos-line-template-v1` payload at install time (#445).
 *
 * Absent/null maps pass (the field is additive and optional). Structural
 * misuse — non-object maps, unknown semantic ids, more than
 * TEMPLATE_LABELS_MAX_ENTRIES entries, or non-string/empty/oversized values —
 * throws with a clear rejection message that surfaces through pack install.
 * The renderer version stays 1: this is validation only, never a schema bump.
 */
export declare function validateTemplateLabelsMap(labels: unknown): void;
/**
 * Resolve one template label at render time: a valid pack-supplied `labels`
 * entry wins; otherwise the localized built-in default resolves through the
 * canonical catalog using the receipt language. Non-string or empty entries
 * are ignored at render time (install already rejects them), so a partially
 * damaged payload still renders real labels, never raw keys. Resolved labels
 * are always sanitized against reserved printer tokens; when the selected
 * width profile's column count is supplied, they are additionally clamped to
 * fit within it.
 */
export declare function resolveTemplateLabel(labels: unknown, id: TemplateLabelId, lang: string, columns?: number): string;
//# sourceMappingURL=template-labels.d.ts.map