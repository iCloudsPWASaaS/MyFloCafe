export declare const CORE_BILL_TEMPLATES: readonly ["classic", "compact"];
export type CoreBillTemplate = typeof CORE_BILL_TEMPLATES[number];
export interface InstalledPrintTemplate {
    template_id: string;
    pack_id: string;
    pack_version_id: string;
    country: string;
    jurisdiction: string;
    display_name: string;
    paper_widths_json: string;
    renderer_json: string;
    template_payload_json: string;
    status: string;
    created_at: string;
}
export declare function isCoreBillTemplate(value: string): value is CoreBillTemplate;
/**
 * A structured bill-template selection persisted in the `bill_template`
 * setting as `{ source: 'core' | 'pack' | 'merchant', id }` JSON. Legacy bare
 * string values (`classic`, `compact`, `<pack-template-id>`) keep resolving
 * during the transition and are upgraded transparently on the next save.
 */
export type BillTemplateSource = 'core' | 'pack' | 'merchant';
export interface BillTemplateSelection {
    source: BillTemplateSource;
    id: string;
}
/**
 * Resolve ANY persisted `bill_template` value into a structured selection:
 * accepts the structured object, its JSON-string encoding, and every legacy
 * bare-string form. Returns null for values that resolve to nothing.
 *
 * Legacy resolution order mirrors history: core names first, then pack
 * template ids. Merchant ids are uuids that never collide with either.
 */
export declare function parseBillTemplateSelection(rawValue: unknown): BillTemplateSelection | null;
/** Canonical persistence form for a selection (stored in settings). */
export declare function serializeBillTemplateSelection(selection: BillTemplateSelection): string;
/**
 * Upgrade any accepted input to its canonical structured form when it is
 * resolvable; returns null for unresolvable values (caller decides policy).
 */
export declare function upgradeBillTemplateValue(rawValue: unknown): string | null;
export declare function listInstalledPrintTemplates(): InstalledPrintTemplate[];
export declare function loadInstalledPrintTemplate(templateId: string): InstalledPrintTemplate | null;
/**
 * Extended for #447: accepts both the structured `{ source, id }` forms and
 * every legacy bare-string value; merchant templates qualify while they have
 * an ACTIVE row (drafts and archived rows are not selectable).
 */
export declare function isAvailableBillTemplate(value: unknown): boolean;
//# sourceMappingURL=print-templates.d.ts.map