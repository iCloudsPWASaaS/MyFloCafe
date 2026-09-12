/**
 * Merchant print templates service (#447, epic #438).
 *
 * CRUD + lifecycle for tenant-owned semantic receipt templates stored in the
 * dedicated `merchant_print_templates` table. This table is deliberately
 * SEPARATE from `installed_print_templates` (signed compliance-pack
 * artifacts): merchant rows are ordinary editable documents and must never
 * touch the pack trust model.
 *
 * Lifecycle: draft -> active -> archived, with single-step rollback via
 * `previous_payload_json`. Every write revalidates the payload against the
 * shared kernel validator (fail-closed) and recomputes `checksum`
 * (sha256 of the exact persisted payload text). Rollback verifies the
 * current checksum first so tampering is detected before a swap.
 *
 * Provenance: `origin` distinguishes created | imported | cloned; a cloned
 * row may carry `derived_from` pointing at a compliance-pack template id for
 * USER INFORMATION ONLY — no compliance trust transfers (see #447).
 */
export interface MerchantPrintTemplateRow {
    id: string;
    business_id: string;
    name: string;
    origin: 'created' | 'imported' | 'cloned';
    derived_from: string | null;
    document_type: string;
    schema_version: number;
    payload_json: string;
    status: 'draft' | 'active' | 'archived';
    previous_payload_json: string | null;
    checksum: string;
    created_by: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
}
/** Structured provenance reference (stored as JSON in derived_from). */
export interface DerivedFromRef {
    /** Provenance class of the source. Compliance clones stay informational.
     *  `offline-import` (#448) records a portable transfer file as the source. */
    type: 'compliance-pack-template' | 'merchant-template' | 'offline-import';
    /** For offline imports: sha256 hex of the EXACT imported envelope text —
     *  a stable identity of the source artifact (not of any tenant row). */
    templateId: string;
    /** For offline imports only: sanitized source file name, informational. */
    fileName?: string;
}
export declare class MerchantTemplateError extends Error {
    readonly statusCode: number;
    readonly details?: readonly string[];
    constructor(message: string, statusCode?: number, details?: readonly string[]);
}
export declare function listMerchantPrintTemplates(): MerchantPrintTemplateRow[];
export declare function loadMerchantPrintTemplateRow(id: string): MerchantPrintTemplateRow | null;
/** Active template payload for the render path, or null when unavailable. */
export declare function loadActiveMerchantPrintTemplate(id: string): MerchantPrintTemplateRow | null;
export declare function createMerchantPrintTemplate(input: {
    name: unknown;
    payload: unknown;
    origin?: unknown;
    derivedFrom?: unknown;
}, actorId: string | null): MerchantPrintTemplateRow;
/**
 * Update name and/or payload. Draft rows are freely editable; editing an
 * ACTIVE row snapshots its current payload into `previous_payload_json`
 * (single-step rollback) before applying the change.
 */
export declare function updateMerchantPrintTemplate(id: string, input: {
    name?: unknown;
    payload?: unknown;
}, actorId: string | null): MerchantPrintTemplateRow;
export declare function activateMerchantPrintTemplate(id: string, actorId: string | null): MerchantPrintTemplateRow;
export declare function archiveMerchantPrintTemplate(id: string, actorId: string | null): MerchantPrintTemplateRow;
/**
 * Single-step rollback: restores `previous_payload_json` after verifying the
 * CURRENT row's checksum (tamper detection), then swaps payloads and clears
 * the rollback point. The restored payload is revalidated fail-closed so a
 * payload written by a newer schema version cannot sneak back in.
 */
export declare function rollbackMerchantPrintTemplate(id: string, actorId: string | null): MerchantPrintTemplateRow;
export interface MerchantTemplateExportFile {
    /** Sanitized, traversal-proof download filename. */
    fileName: string;
    /** Envelope JSON text (pretty-printed for human inspection). */
    json: string;
}
/**
 * Build the portable transfer envelope for a template. Exportable states are
 * `active` and `archived`; drafts are deliberately excluded (they have never
 * passed activation, which is the checksum-verified review point). The row's
 * checksum is verified BEFORE export so a tampered payload can never be
 * distributed as a trusted-looking file, and the serialized envelope is held
 * to the same byte cap import enforces, so an install can never mint a
 * transfer file it would refuse to read back.
 */
export declare function exportMerchantPrintTemplateFile(id: string): MerchantTemplateExportFile;
/**
 * Import a transfer file: full fail-closed validation pipeline, then land as
 * a NEW draft with `origin: 'imported'` and `derived_from` provenance
 * recording the source artifact (sha256 of the exact envelope text, plus the
 * sanitized file name when provided). Duplicate names are allowed — identity
 * is the fresh uuid, never the source id recorded in the envelope.
 */
export declare function importMerchantPrintTemplateFile(input: {
    file?: unknown;
    name?: unknown;
    fileName?: unknown;
}, actorId: string | null): MerchantPrintTemplateRow;
//# sourceMappingURL=merchant-print-templates.d.ts.map