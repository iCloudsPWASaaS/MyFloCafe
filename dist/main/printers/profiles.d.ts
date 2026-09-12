import { type ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
export type PrinterCommandSet = 'escpos';
export type PrinterCutMode = 'full' | 'partial';
export interface SupportedPrinterProfile {
    id: string;
    make: string;
    model: string;
    aliases: string[];
    commandSet: PrinterCommandSet;
    defaultPaperWidth: 'cols-32' | 'cols-36' | 'cols-40' | 'cols-42' | 'cols-44' | 'cols-48' | '58mm' | '58mm-36' | '80mm-42' | '80mm';
    defaultPort: number;
    fontAColumns: number;
    fontBColumns: number;
    printWidthMm?: number;
    cutMode: PrinterCutMode;
    /**
     * Legacy stored override for the profile-owned Arabic shaping capability.
     * @deprecated Use capabilities.shaping.arabic. Kept for stored profile compatibility.
     */
    arabicShaping?: boolean;
    /** Text encoding, shaping, representability, transliteration, and warning policy. */
    capabilities: ThermalPrinterCapabilities;
    notes?: string;
}
export declare const SUPPORTED_PRINTER_PROFILES: SupportedPrinterProfile[];
export declare function getSupportedPrinterProfiles(): SupportedPrinterProfile[];
export declare function matchSupportedPrinterProfile(...parts: Array<string | null | undefined>): SupportedPrinterProfile | null;
export declare function resolvePrinterProfile(printer: any): SupportedPrinterProfile;
export declare function getPrinterCapabilities(profile: SupportedPrinterProfile, arabicShapingOverride?: boolean): ThermalPrinterCapabilities;
//# sourceMappingURL=profiles.d.ts.map