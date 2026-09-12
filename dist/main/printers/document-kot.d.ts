/**
 * PrintDocument v1 → kitchen order ticket renderer (#443, epic #438).
 *
 * Maps a `buildKotDocument` KOT document onto the shared ESC/POS token-line
 * layout, so kitchen tickets flow through `data → document → lines → bytes`.
 *
 * Layering: this module lives in `main/` (transport token syntax + generated
 * label catalog); all SEMANTICS come from the document — no order row is
 * read here beyond the caller's normalization step. The KOT language policy
 * is single-primary (kernel `kot_language_policy`) and is resolved by the
 * caller before reaching this renderer.
 */
import type { PrinterCutMode } from './profiles';
import type { ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { PrintWarning } from './thermal';
import { type KotDocument, type KotPrintData, type PrintContext } from '../../shared/print';
/**
 * Normalize raw order/items/station rows into an authoritative KOT snapshot.
 * This is the ONLY step allowed to touch raw rows so the builder stays pure.
 */
export declare function buildKotPrintData(order: any, items: any[], stationName: string): KotPrintData;
/**
 * Build the PrintContext for a kitchen ticket. The language arrives already
 * resolved from `kot_language_policy` through the kernel by the caller.
 */
export declare function buildKotPrintContext(opts: {
    columns: number;
    /** KOT label language (already resolved from the kitchen policy). */
    language: string;
    /** Store timezone for business-local ticket time formatting. */
    timezone?: string;
}): PrintContext;
/** Renderer options: physical/locale presentation only, no business data. */
export interface KotDocumentRenderOptions {
    readonly columns: number;
    readonly language: string;
    readonly locale?: string;
    readonly timezone?: string;
    readonly useUnicode: boolean;
    readonly arabicShaping: boolean;
    readonly cutMode: PrinterCutMode;
    readonly capabilities?: ThermalPrinterCapabilities;
}
/**
 * Map a KotDocument onto the legacy KOT token-line layout. Pure with
 * respect to business data: everything rendered comes from the document.
 */
export declare function renderKotDocumentToLines(document: KotDocument, options: KotDocumentRenderOptions): string[];
export interface KotDocumentRenderResult {
    readonly document: KotDocument;
    readonly lines: string[];
    readonly data: Buffer;
    readonly warnings: PrintWarning[];
}
/**
 * Full document-driven KOT pipeline: authoritative rows → KotPrintData /
 * PrintContext → buildKotDocument → KOT token lines → buildEscPos.
 */
export declare function renderKotViaDocument(order: any, items: any[], stationName: string, opts: {
    columns: number;
    /** KOT label language, resolved from `kot_language_policy` by the caller. */
    language: string;
    locale?: string;
    timezone?: string;
    useUnicode: boolean;
    arabicShaping: boolean;
    cutMode: PrinterCutMode;
    capabilities?: import('../../shared/print/thermal-capabilities').ThermalPrinterCapabilities;
}): KotDocumentRenderResult;
//# sourceMappingURL=document-kot.d.ts.map