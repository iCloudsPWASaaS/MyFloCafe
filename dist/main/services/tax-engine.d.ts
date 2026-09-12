import type { CountryPack, TaxBehavior, TaxLineKind } from '../tax-packs/types';
export interface TaxCustomer {
    registrationNumber?: string;
    stateCode?: string;
    exempt?: boolean;
}
export interface TaxEngineLine {
    lineId: string;
    kind: TaxLineKind;
    quantity: string;
    unitPrice: string;
    discount?: string;
    taxBehavior?: TaxBehavior;
    transactionCategoryId?: string;
    transactionExempt?: boolean;
    merchantCategoryId?: string;
    taxCategoryId?: string;
    productCategoryId?: string;
    parentProductCategoryId?: string;
    inheritParentCategory?: boolean;
}
export interface TaxEngineInput {
    pack: CountryPack;
    currency?: string;
    country: string;
    jurisdiction?: string;
    businessType?: string;
    storeStateCode?: string;
    transactionDate: string;
    customer?: TaxCustomer | null;
    lines: TaxEngineLine[];
}
export interface CategoryResolution {
    categoryId: string | null;
    source: 'transaction_exemption' | 'transaction_override' | 'merchant_override' | 'explicit' | 'parent' | 'charge_default' | 'unclassified';
}
export interface TaxComponentResult {
    ruleId: string;
    label: string;
    type: 'percent' | 'fixed';
    rate?: string;
    amountPer?: string;
    baseRuleIds: string[];
    amount: string;
    roundingRemainder: string;
}
export interface TaxLineResult {
    lineId: string;
    categoryId: string | null;
    categorySource: CategoryResolution['source'];
    taxBehavior: Exclude<TaxBehavior, 'country_default'>;
    grossAmount: string;
    taxableBase: string;
    taxAmount: string;
    components: TaxComponentResult[];
}
export interface TaxCalculation {
    packId: string;
    packVersion: string;
    lines: TaxLineResult[];
    subtotal: string;
    taxAmount: string;
    totalBeforePayableRounding: string;
    payableTotal: string;
    payableRoundingAdjustment: string;
    snapshot: {
        packId: string;
        packVersion: string;
        effectiveFrom: string;
        taxRounding: CountryPack['taxRounding'];
        payableRounding: CountryPack['payableRounding'];
        appliedRuleIds: string[];
        lines: TaxLineResult[];
    };
}
export declare function resolveTaxCategory(pack: CountryPack, line: TaxEngineLine): CategoryResolution;
export declare class TaxEngine {
    static calculate(input: TaxEngineInput): TaxCalculation;
}
export declare function applyPayableRounding(exactTotal: number, pack: CountryPack, currency?: string): {
    total: number;
    adjustment: number;
};
//# sourceMappingURL=tax-engine.d.ts.map