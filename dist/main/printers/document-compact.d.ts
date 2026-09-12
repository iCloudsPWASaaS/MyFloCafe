/**
 * PrintDocument v1 → compact thermal receipt renderer (#443, epic #438).
 *
 * Maps `shared/print` blocks onto the SAME ESC/POS token lines the legacy
 * compact layout (`formatCompactReceipt`) produces, byte for byte, so the
 * compact surface renders through `data → document → lines → bytes` without
 * changing printed semantics.
 *
 * Layering: this module lives in `main/` (transport token syntax + generated
 * label catalog); all SEMANTICS come from the document — no bill/order row
 * is read here beyond the caller's normalization step (`buildBillPrintData`,
 * reused from the classic pipeline).
 */
import type { PrinterCutMode } from './profiles';
import type { ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { PrintWarning } from './thermal';
import { type PrintDocument } from '../../shared/print';
/** Renderer options: physical/locale presentation only, no business data. */
export interface CompactDocumentRenderOptions {
    readonly columns: number;
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
 * Map a PrintDocument onto the legacy compact token-line layout. Pure with
 * respect to business data: everything rendered comes from the document.
 */
export declare function renderBillDocumentToCompactLines(document: PrintDocument, options: CompactDocumentRenderOptions): string[];
export interface CompactDocumentRenderResult {
    readonly document: PrintDocument;
    readonly lines: string[];
    readonly data: Buffer;
    readonly warnings: PrintWarning[];
}
/**
 * Full document-driven compact pipeline: authoritative rows → PrintData /
 * PrintContext → buildBillDocument → compact token lines → buildEscPos.
 */
export declare function renderCompactReceiptViaDocument(order: any, bill: any, business: any, opts: {
    columns: number;
    language: string;
    additionalLanguage?: string;
    isReprint: boolean;
    useUnicode: boolean;
    arabicShaping: boolean;
    cutMode: PrinterCutMode;
    capabilities?: import('../../shared/print/thermal-capabilities').ThermalPrinterCapabilities;
}): CompactDocumentRenderResult;
//# sourceMappingURL=document-compact.d.ts.map