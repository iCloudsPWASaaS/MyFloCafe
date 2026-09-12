/**
 * Capability policy shared by the backend ESC/POS and WebUSB encoders.
 *
 * This module deliberately describes text-only thermal output. Raster output,
 * broad script shaping, and locale-specific policy do not belong here.
 */
export type ThermalCodePage = 'ascii' | 'cp437' | 'cp850' | 'cp858' | 'windows1252';
export type ThermalScript = 'ascii' | 'latin' | 'arabic';
export type UnsupportedTextPolicy = 'skip';
export type FinancialTextPolicy = 'refuse';
export type OrderTypeFallbackPolicy = 'ascii';
export interface ThermalPrinterCapabilities {
    encoding: {
        codePages: readonly ThermalCodePage[];
        preferredCodePage: ThermalCodePage;
    };
    shaping: {
        arabic: boolean;
    };
    representability: {
        scripts: readonly ThermalScript[];
    };
    transliteration: {
        enabled: boolean;
    };
    warnings: {
        unsupportedText: UnsupportedTextPolicy;
        financialText: FinancialTextPolicy;
        orderTypeFallback: OrderTypeFallbackPolicy;
    };
}
export declare const GENERIC_THERMAL_CAPABILITIES: ThermalPrinterCapabilities;
export declare function normalizeThermalText(text: string, capabilities: ThermalPrinterCapabilities): string;
export declare function hasArabicScript(text: string): boolean;
export declare function isArabicShapingSafeLine(text: string): boolean;
export declare function selectThermalCodePage(text: string, capabilities: ThermalPrinterCapabilities): ThermalCodePage | null;
export declare function isThermalTextRepresentable(text: string, capabilities: ThermalPrinterCapabilities): boolean;
export declare function thermalTextFallback(value: string, fallback: string, capabilities: ThermalPrinterCapabilities): string;
export declare function shouldUseOrderTypeFallback(localizedText: string, capabilities: ThermalPrinterCapabilities): boolean;
export declare function escPosCodePageId(codePage: ThermalCodePage): number;
export declare function mergeThermalCapabilities(capabilities: ThermalPrinterCapabilities | undefined, arabicShapingOverride?: boolean): ThermalPrinterCapabilities;
//# sourceMappingURL=thermal-capabilities.d.ts.map