/**
 * Merchant template → classic thermal receipt renderer (#447, epic #438).
 *
 * Resolves an ACTIVE merchant template through the PrintDocument pipeline:
 * authoritative rows → PrintData/PrintContext → buildBillDocument →
 * applyMerchantTemplate (semantic block selection/order/label variants) →
 * classic token lines → bytes. Because the template is applied at the
 * SEMANTIC layer, every renderer that consumes the applied document produces
 * the same content — the parity harness asserts this byte-equivalence in
 * merchant-template mode.
 *
 * v1 renders merchant receipt documents through the classic layout pipeline;
 * compact/KOT adoption of merchant docs belongs to their owning issues.
 */
import { type PrintWarning } from './thermal';
import type { PrinterCutMode } from './profiles';
import type { ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
export interface MerchantDocumentRenderResult {
    readonly data: Buffer;
    readonly lines: string[];
    readonly warnings: PrintWarning[];
    /** True when the stored payload failed validation and classic was used. */
    readonly fellBackToClassic: boolean;
}
type RawPrintRecord = Record<string, unknown>;
/**
 * Render a bill through a merchant template row. Fail-closed on render too:
 * if the stored payload no longer validates against this build's schema
 * (e.g. written by a newer version), a warning is recorded and the plain
 * classic document is rendered instead of garbage or nothing.
 */
export declare function renderMerchantReceiptViaDocument(order: RawPrintRecord, bill: RawPrintRecord, business: RawPrintRecord, templateId: string, opts: {
    columns: number;
    language: string;
    /** Optional second receipt language from the resolved policy (max 2, v1). */
    additionalLanguage?: string;
    isReprint: boolean;
    useUnicode: boolean;
    arabicShaping: boolean;
    cutMode: PrinterCutMode;
    capabilities?: ThermalPrinterCapabilities;
}): MerchantDocumentRenderResult;
export {};
//# sourceMappingURL=document-merchant.d.ts.map