/**
 * PrintDocument v1 → classic thermal receipt renderer (#442, epic #438).
 *
 * This is the first document-driven consumer of the shared PrintDocument
 * model: it maps `shared/print` blocks onto the SAME ESC/POS token lines the
 * legacy classic layout (`formatClassicReceipt`) produces, so the preview
 * pipeline can switch to `data → document → lines → bytes` without changing
 * printed semantics.
 *
 * Layering: this module lives in `main/` (it touches transport token syntax
 * and the generated label catalog); all SEMANTICS come from the document —
 * no bill/order row is read here beyond the caller's normalization step
 * (`buildBillPrintData`). Since #443 the classic receipt surface (preview AND
 * actual printing) renders through this pipeline; `formatClassicReceipt`
 * delegates here.
 */
import type { PrinterCutMode } from './profiles';
import type { ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { PrintWarning } from './thermal';
import { type PrintContext, type PrintData, type PrintDocument, type TextDirection } from '../../shared/print';
/**
 * Derive a language's base direction from its own generated label strings.
 * Registry-derived fact injection: the kernel never hardcodes language
 * unions, and this backend view reads only the generated print-label table.
 */
export declare function detectPrintLanguageDirection(lang: string): TextDirection;
/**
 * Normalize the raw bill/order/business rows into authoritative PrintData.
 * This is the ONLY step allowed to touch raw rows; it resolves display tax
 * components (persisted snapshots/breakdowns — no recomputation of totals)
 * and parses stored JSON so builders stay pure.
 */
export declare function buildBillPrintData(order: any, bill: any, business: any, isReprint: boolean): PrintData;
/**
 * Build the PrintContext for a classic receipt: paper columns, resolved
 * languages, registry-derived direction, and locale-formatting prefs from
 * the existing regionalization helpers.
 */
export declare function buildBillPrintContext(opts: {
    columns: number;
    /** Receipt language (already resolved from settings/policy by the caller). */
    language: string;
    /** Optional second receipt language from the resolved policy (max 2, v1). */
    additionalLanguage?: string;
    business: any;
}): PrintContext;
/** Renderer options: physical/locale presentation only, no business data. */
export interface ClassicDocumentRenderOptions {
    readonly columns: number;
    /** Primary receipt language for labels (resolved by the caller). */
    readonly language: string;
    readonly locale: string;
    readonly timezone?: string;
    /** Currency prefix preference (symbol + unicode mode). */
    readonly currencySymbol: string;
    readonly currency?: string;
    readonly trimDecimals: boolean;
    readonly useUnicode: boolean;
    readonly arabicShaping: boolean;
    readonly cutMode: PrinterCutMode;
    readonly capabilities?: ThermalPrinterCapabilities;
}
/**
 * Map a PrintDocument onto the legacy classic token-line layout. Pure with
 * respect to business data: everything rendered comes from the document.
 */
export declare function renderBillDocumentToClassicLines(document: PrintDocument, options: ClassicDocumentRenderOptions): string[];
export interface ClassicDocumentPreviewResult {
    readonly document: PrintDocument;
    readonly lines: string[];
    readonly data: Buffer;
    readonly warnings: PrintWarning[];
}
/**
 * Full document-driven classic preview pipeline:
 * authoritative rows → PrintData/PrintContext → buildBillDocument →
 * classic token lines → buildEscPos. Used by the print-bill preview branch;
 * actual printing keeps the legacy path this issue.
 */
export declare function renderClassicReceiptViaDocument(order: any, bill: any, business: any, opts: {
    columns: number;
    language: string;
    additionalLanguage?: string;
    isReprint: boolean;
    useUnicode: boolean;
    arabicShaping: boolean;
    cutMode: PrinterCutMode;
    capabilities?: import('../../shared/print/thermal-capabilities').ThermalPrinterCapabilities;
}): ClassicDocumentPreviewResult;
//# sourceMappingURL=document-classic.d.ts.map