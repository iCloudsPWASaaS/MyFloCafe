export interface DisplayTaxComponent {
    title: string;
    rate: number | null;
    amount: number;
}
interface TaxSource {
    tax_snapshot?: unknown;
    tax_breakdown?: unknown;
}
interface TaxDocument extends TaxSource {
    tax_amount?: unknown;
    items?: Array<TaxSource & {
        status?: string | null;
    }>;
}
/**
 * Resolves receipt/report tax components without double-counting mixed orders.
 * A valid item snapshot (including an exempt snapshot with zero components)
 * is authoritative for that item; uncategorized items retain their legacy
 * tax_breakdown. Split bills use their marked child snapshot, then add only
 * document-level legacy residuals that are not already represented.
 */
export declare function resolveTaxComponents(document: TaxDocument): DisplayTaxComponent[];
export declare function aggregateTaxComponents(documents: TaxDocument[]): DisplayTaxComponent[];
export {};
//# sourceMappingURL=tax-components.d.ts.map