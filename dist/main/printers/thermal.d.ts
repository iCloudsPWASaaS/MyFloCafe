import { PrinterCutMode } from './profiles';
import { type FloErrorCode } from '../errors';
import { type ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
export type PrintResult = {
    ok: boolean;
    code?: FloErrorCode;
    correlationId: string;
    stage: 'prepare' | 'dispatch';
    detail?: string;
    failureClass?: PrintFailureClass;
    platformErrorCode?: number;
    jobId?: number;
    driverName?: string;
    printerStatus?: number;
    warnings?: PrintWarning[];
};
export type PrintWarning = {
    field: string;
    text: string;
    message: string;
    kind?: 'line' | 'financial' | 'configuration';
};
export declare function hasFinancialPrintWarning(warnings: readonly PrintWarning[]): boolean;
export declare function makeFinancialPrintRefusalMessage(warnings: readonly PrintWarning[]): string;
/** Low-level dispatch result — carries the actual OS/driver reason, not just ok/fail. */
export type DispatchResult = {
    ok: boolean;
    detail?: string;
    failureClass?: PrintFailureClass;
    platformErrorCode?: number;
    jobId?: number;
    driverName?: string;
    printerStatus?: number;
    warnings?: PrintWarning[];
};
export type PrintFailureClass = 'not_configured' | 'offline' | 'queue_unavailable' | 'spooler_error' | 'driver_error' | 'permission_denied' | 'timeout' | 'write_error' | 'unsupported' | 'unknown';
/** Stable, privacy-safe classification for fleet telemetry. */
export declare function classifyPrintFailure(detail?: string): PrintFailureClass;
export type PrinterColumnWidth = 36 | 42 | 48;
export interface PrinterInfo {
    name: string;
    make: string;
    model: string;
    connectionType: 'usb' | 'network' | 'bluetooth';
    deviceUri: string;
    driver?: string;
    status: 'idle' | 'printing' | 'offline';
    isDefault: boolean;
    ipAddress?: string;
    port?: number;
    paperWidth?: string;
    profileId?: string;
}
export declare function detectConnectedPrinters(signal?: AbortSignal): Promise<PrinterInfo[]>;
export declare function initPrinter(): Promise<void>;
export declare function printReceipt(order: any, bill: any, business?: any, template?: string, useUnicode?: boolean, isReprint?: boolean, signal?: AbortSignal, arabicShapingOverride?: boolean, language?: string, additionalLanguage?: string): Promise<DispatchResult>;
export declare function printKOT(order: any, items: any[], stationName: string, useUnicode?: boolean, targetPrinter?: any, signal?: AbortSignal, arabicShapingOverride?: boolean, language?: string): Promise<DispatchResult>;
/** Typed adapters used by API callers while legacy boolean callers migrate. */
export declare function printReceiptDetailed(...args: Parameters<typeof printReceipt>): Promise<PrintResult>;
export declare function printKOTDetailed(...args: Parameters<typeof printKOT>): Promise<PrintResult>;
export declare function prepareReceipt(order: any, bill: any, business?: any, template?: string, useUnicode?: boolean, isReprint?: boolean, arabicShapingOverride?: boolean, language?: string, additionalLanguage?: string): {
    printer: any;
    data: Buffer;
    warnings: PrintWarning[];
    columns: number;
};
export declare function formatReceipt(order: any, bill: any, business?: any, template?: string, cols?: number, useUnicode?: boolean, isReprint?: boolean, cutMode?: PrinterCutMode, warnings?: PrintWarning[], arabicShaping?: boolean, language?: string, additionalLanguage?: string, capabilities?: ThermalPrinterCapabilities): Buffer;
export declare function normalizeReceiptTemplate(template?: string): 'classic' | 'compact';
export declare function appendPoweredByFooter(lines: string[]): void;
/**
 * Compact thermal receipt (#443): builds a PrintDocument from normalized
 * print data and renders it through the document pipeline (document-compact).
 */
export declare function formatCompactReceipt(order: any, bill: any, biz: any, cols?: number, useUnicode?: boolean, isReprint?: boolean, cutMode?: PrinterCutMode, warnings?: PrintWarning[], arabicShaping?: boolean, lang?: string, additionalLanguage?: string, capabilities?: ThermalPrinterCapabilities): Buffer;
/**
 * Classic thermal receipt (#443): builds a PrintDocument from normalized
 * print data and renders it through the document pipeline (document-classic).
 * Token-line emission stays an implementation detail of the ESC/POS renderer.
 */
export declare function formatClassicReceipt(order: any, bill: any, biz: any, cols?: number, useUnicode?: boolean, isReprint?: boolean, cutMode?: PrinterCutMode, warnings?: PrintWarning[], arabicShaping?: boolean, lang?: string, additionalLanguage?: string, capabilities?: ThermalPrinterCapabilities): Buffer;
export declare function itemNameWidth(cols: number, amtLen: number): number;
export declare function itemAmountWidth(order: {
    items?: Array<{
        total?: number;
        addons?: unknown;
    }>;
} | null | undefined, prefix: string, locale: string, trimDecimals: boolean, cols: number, fractionDigits?: number): number;
export declare function itemRows(item: any, nameLen: number, amtLen: number, cols: number, prefix: string, locale?: string, trimDecimals?: boolean, language?: string, fractionDigits?: number, capabilities?: ThermalPrinterCapabilities): string[];
export declare function addonRows(addon: any, nameLen: number, amtLen: number, cols: number, prefix: string, locale?: string, trimDecimals?: boolean, language?: string, fractionDigits?: number, capabilities?: ThermalPrinterCapabilities): string[];
export declare function financialRows(label: string, value: string, cols: number, _language?: string, capabilities?: ThermalPrinterCapabilities): string[];
export declare function formatCurrency(amount: number, prefix: string, locale?: string, trimDecimals?: boolean, fractionDigits?: number): string;
export declare function rightAlign(text: string, width?: number): string;
export declare function truncate(text: string, length: number, _language?: string, capabilities?: ThermalPrinterCapabilities): string;
export declare function truncateShapedLine(text: string, length: number, arabicShaping: boolean, language?: string, capabilities?: ThermalPrinterCapabilities): string;
/**
 * Receipt label language resolution (#440). Unknown or ungenerated languages
 * fall back to English so receipts always render real labels.
 */
export declare function normalizePrintLanguage(language?: string): string;
/** Ported from web-print.ts (#440): known methods localize; unknown keep the capitalize fallback. */
export declare function resolvePaymentMethodLabel(method: string, lang: string): string;
/** pos.tableLabel carries an ICU {name} placeholder; backend rendering swaps it inline. */
export declare function formatTableLabel(tableName: string, lang: string): string;
export declare function wrapText(text: string, cols: number): string[];
export declare function pushWrapped(lines: string[], text: string, cols: number, _language?: string, capabilities?: ThermalPrinterCapabilities): void;
export declare function pushCenteredWrapped(lines: string[], text: string, cols: number, _language?: string, capabilities?: ThermalPrinterCapabilities): void;
/**
 * Kitchen order ticket (#443): builds a KotDocument (single-language policy
 * resolved by the caller through the kernel) and renders it via the document
 * pipeline (document-kot).
 */
export declare function formatKOT(order: any, items: any[], stationName: string, cols?: number, useUnicode?: boolean, cutMode?: PrinterCutMode, locale?: string, tzOptions?: any, warnings?: PrintWarning[], arabicShaping?: boolean, language?: string, capabilities?: ThermalPrinterCapabilities): Buffer;
export declare function buildTestPage(paperWidth?: string, cutMode?: PrinterCutMode, language?: string, timezone?: string): Buffer;
export declare function normalizeThermalText(text: string, capabilities?: ThermalPrinterCapabilities): string;
export declare function resolveCurrencyPrefix(symbol: string, useUnicode: boolean, capabilities?: ThermalPrinterCapabilities): string;
export declare function appendCashDrawerPulse(data: Buffer): Buffer;
/**
 * Build ESC/POS bytes and classify unsupported financial rows for the receipt
 * transport guard. Receipt renderers mark amount-bearing lines with the
 * internal {FINANCIAL} token; it is stripped before bytes are emitted.
 */
export declare function buildEscPos(lines: string[], _useUnicode?: boolean, options?: {
    cutMode?: PrinterCutMode;
    arabicShaping?: boolean;
    columns?: number;
    language?: string;
    capabilities?: ThermalPrinterCapabilities;
}, warnings?: PrintWarning[]): Buffer;
/** Convert the command subset emitted by buildEscPos() into a paperless text preview. */
export declare function escPosToText(data: Buffer | Uint8Array): string;
export declare function printViaNetwork(ip: string, port: number, data: Buffer, signal?: AbortSignal): Promise<DispatchResult>;
export declare function printViaUSB(data: Buffer, printerName?: string, signal?: AbortSignal): Promise<DispatchResult>;
export declare function getPrinterStatus(): {
    connected: boolean;
    printer: any;
};
//# sourceMappingURL=thermal.d.ts.map