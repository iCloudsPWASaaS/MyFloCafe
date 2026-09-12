import { type TaxIdFormat } from '../countries';
interface TenantInfo {
    country: string;
    business_type: string;
    state_code: string;
    currency?: string;
    taxes_enabled: boolean;
}
interface Product {
    id?: string | number;
    tax_type: string;
    tax_rate: number;
    tax_category?: string;
    tax_category_id?: string;
    tax_behavior?: 'country_default' | 'inclusive' | 'exclusive' | 'exempt';
}
interface Customer {
    taxRegistrationNumber?: string;
    customer_state_code?: string;
}
interface TaxResult {
    tax_amount: number;
    tax_breakdown: TaxBreakdown[];
    tax_type: string;
    tax_snapshot?: Record<string, unknown> | null;
}
export interface TaxBreakdown {
    title: string;
    rate: number;
    amount: number;
}
export type ChargeTaxKind = 'packaging' | 'delivery' | 'service_charge';
export interface ChargeTaxCategorySelection {
    categoryId: string;
    overrideId?: string;
}
export interface ChargeTaxContext {
    packaging_charge?: number | string | null;
    delivery_charge?: number | string | null;
    service_charge?: number | string | null;
    packaging_tax_category_id?: string | null;
    delivery_tax_category_id?: string | null;
    service_charge_tax_category_id?: string | null;
}
export interface ChargeTaxSummary {
    taxAmount: number;
    exclusiveTaxAmount: number;
    breakdowns: TaxBreakdown[][];
    snapshotJson: string[];
}
export interface TaxRollup {
    taxAmount: number;
    exclusiveTaxAmount: number;
    breakdowns: TaxBreakdown[][];
    snapshotJson: string | null;
}
import type { CountryPack } from '../tax-packs/types';
export declare function getActiveCountryPack(country: string): CountryPack;
export declare function isTaxModuleActiveForCountry(country: string): boolean;
export declare function resolveTaxIdFormat(country: string): TaxIdFormat | null;
export declare const MAX_TAX_ID_LENGTH = 24;
export declare function validateTaxRegistrationNumber(country: string, value: string): {
    valid: boolean;
    format: TaxIdFormat | null;
};
export declare function previewCategoryRate(pack: CountryPack, businessType: string, categoryId: string): {
    percent: number;
    label: string;
} | null;
export declare function hasConfiguredTaxCategories(pack: CountryPack, businessType: string): boolean;
export declare function calculateItemTax(tenant: TenantInfo, product: Product, taxableAmount: number, customer: Customer | null): TaxResult;
export declare function getConfiguredChargeTaxCategories(country: string): Partial<Record<ChargeTaxKind, ChargeTaxCategorySelection>>;
export declare function normalizeChargeAmount(value: unknown, kind: ChargeTaxKind): number;
export declare function calculateConfiguredChargeTaxes(tenant: TenantInfo, context: ChargeTaxContext, customer: Customer | null): ChargeTaxSummary;
export declare function aggregateTaxBreakdown(itemBreakdowns: TaxBreakdown[][], minorFactor?: number): TaxBreakdown[];
export declare function aggregateTaxSnapshots(itemSnapshotsJson: (string | null | undefined)[]): string | null;
export declare function invertTaxSnapshot(raw: string | null | undefined): string | null;
export declare function invertTaxBreakdown(raw: string | null | undefined): string | null;
export declare function scaleTaxBreakdowns(breakdowns: any[], ratio: number, targetTaxAmount: number, minorFactor?: number): any[];
export declare function scaleTaxSnapshots(snapshotsJson: (string | null | undefined)[], ratio: number, minorFactor?: number): string[];
export declare function combineItemAndChargeTaxes(args: {
    itemTaxAmount: number;
    itemExclusiveTaxAmount: number;
    itemBreakdowns: any[];
    itemSnapshots: (string | null | undefined)[];
    itemTaxRatio: number;
    chargeTaxes: ChargeTaxSummary;
    minorFactor?: number;
}): TaxRollup;
export declare function calculateTaxPreview(req: any, res: any): Promise<void>;
export {};
//# sourceMappingURL=tax.d.ts.map