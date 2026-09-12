/**
 * Semantic merchant print template model v1 (#447, epic #438).
 *
 * A merchant template describes SEMANTIC STRUCTURE only: an ordered subset
 * of PrintDocument v1 blocks (see ./document.ts) with presentation options
 * (visibility, order, label variants). It never contains printer commands,
 * HTML, or renderer snippets — one template feeds every renderer by being
 * applied to a built {@link PrintDocument} before rendering.
 *
 * TRUST MODEL (#447): merchant templates are ordinary tenant-owned data,
 * deliberately separate from compliance templates in
 * `installed_print_templates` (signed country-pack artifacts). A
 * `derivedFrom` reference to a pack template is user information ONLY — no
 * compliance trust ever transfers. Required legal blocks in compliance
 * templates stay enforced by the compliance system itself; merchant copies
 * are freely editable documents.
 *
 * COMPATIBILITY POLICY: `schemaVersion` is major-versioned from day one.
 * Readers MUST fail closed on unknown major versions (this module rejects
 * anything other than major version 1 on write/import). Unknown fields and
 * unknown blocks are REJECTED here — stricter than render-time tolerance —
 * because write-time rejection keeps stored payloads forward-compatible and
 * auditable. Field names are stable semantic identifiers; internal i18n
 * translation keys are never exposed as template fields.
 *
 * Note: issue #445's `escpos-line-template-v1` payloads are the LEGACY
 * compliance-oriented line-template format for country packs. This model is
 * a different contract on purpose; do not converge them. See
 * docs/merchant-print-templates.md.
 *
 * OFFLINE TRANSFER (#448): templates travel as `.json` envelopes carrying the
 * validated payload plus integrity checksum and informational origin metadata.
 * Import treats every file as untrusted input: size-capped, single JSON
 * document, structurally validated envelope, then the SAME fail-closed
 * payload validator used on every write path, then checksum verification.
 * Imports always land as a NEW draft row (`origin: 'imported'`) — never as
 * an activation, never overwriting an existing identity.
 *
 * PURITY RULES (same contract as the rest of `shared/print/`, see README.md):
 * types + pure functions only — no Electron, DOM, Node built-ins, DB,
 * filesystem, network, or transport IO.
 */
import type { PrintDocument } from './document';
/** Discriminator stored inside every merchant template payload. */
export declare const MERCHANT_TEMPLATE_FORMAT = "flocafe-merchant-print-template";
/** Supported document types (v1 ships receipts only). */
export declare const MERCHANT_TEMPLATE_DOCUMENT_TYPES: readonly ["receipt"];
export type MerchantTemplateDocumentType = typeof MERCHANT_TEMPLATE_DOCUMENT_TYPES[number];
/** Current schema major version. Bumping this is a breaking contract change. */
export declare const MERCHANT_TEMPLATE_SCHEMA_VERSION = 1;
/** Hard payload size cap (~256 KB) enforced on write/import. */
export declare const MAX_MERCHANT_TEMPLATE_PAYLOAD_BYTES: number;
/** Same cap applied to the whole offline transfer ENVELOPE (#448). */
export declare const MAX_MERCHANT_TEMPLATE_ENVELOPE_BYTES: number;
/**
 * Discriminator of the offline transfer file format (#448, epic #438).
 *
 * The envelope is a self-describing portable wrapper around one validated
 * merchant template payload: `{ format, schemaVersion, exportedAt,
 * appVersion?, origin?, checksum, template }`. It is a PUBLIC CONTRACT
 * (documented in docs/merchant-print-templates.md): stable field names,
 * fail-closed on unknown majors, unknown fields rejected on import.
 */
export declare const MERCHANT_TEMPLATE_EXPORT_FORMAT = "flocafe-merchant-template";
/** Current transfer-envelope schema major version. Breaking when bumped. */
export declare const MERCHANT_TEMPLATE_EXPORT_SCHEMA_VERSION = 1;
/** Ordered union of every PrintDocument v1 block kind — the allowed set. */
export declare const MERCHANT_TEMPLATE_BLOCK_KINDS: readonly ["business-header", "customer", "document-meta", "item-table", "totals", "tax-breakdown", "payments", "message"];
export type MerchantTemplateBlockKind = (typeof MERCHANT_TEMPLATE_BLOCK_KINDS)[number];
/**
 * Whitelisted semantic label fields per block kind. Keys are STABLE semantic
 * identifiers of the label slot inside the rendered block — never internal
 * translation keys. Values are merchant-provided literal strings that replace
 * the resolved label text for every language variant.
 */
export declare const MERCHANT_TEMPLATE_LABEL_FIELDS: Readonly<Record<MerchantTemplateBlockKind, readonly string[]>>;
/** Optional informational provenance recorded inside an exported envelope. */
export interface MerchantTemplateEnvelopeOrigin {
    /** Merchant-template row id at export time (informational only; import
     *  always creates a NEW identity and never overwrites by id). */
    readonly sourceTemplateId?: string;
    /** Template name at export time; importers may reuse it as a label. */
    readonly sourceName?: string;
    /** Payload checksum at export time (sha256 hex of canonical payload text). */
    readonly sourceChecksum?: string;
}
/** Structural view of a validated envelope. Checksum VERIFICATION (hashing)
 * happens at the IO boundary: run {@link validateMerchantTemplate} on
 * `payload`, then compare `claimedChecksum` against the sha256 of
 * {@link serializeMerchantTemplatePayload}(payload) — the same canonical text
 * the service persists. */
export interface ValidatedMerchantTemplateEnvelope {
    readonly exportedAt: string;
    readonly appVersion?: string;
    readonly origin?: MerchantTemplateEnvelopeOrigin;
    /** Claimed integrity checksum (verified by the caller). */
    readonly claimedChecksum: string;
    readonly payload: MerchantPrintTemplatePayload;
}
export type MerchantTemplateEnvelopeValidation = {
    readonly ok: true;
    readonly envelope: ValidatedMerchantTemplateEnvelope;
} | {
    readonly ok: false;
    readonly errors: readonly string[];
};
/**
 * Structurally validate a PARSED offline transfer envelope (pure). Enforces
 * the #448 unknown-field-reject policy on the root and origin objects, the
 * format discriminator, the fail-closed envelope schema-major gate, and a
 * well-formed ISO-8601 `exportedAt`. The embedded TEMPLATE payload is NOT
 * validated here — run {@link validateMerchantTemplate} on it so exactly one
 * validator owns payload rules. Checksum equality is likewise verified by
 * the caller (it needs hashing); this function only checks its SHA-256 shape.
 */
export declare function validateMerchantTemplateEnvelope(value: unknown): MerchantTemplateEnvelopeValidation;
/** One block entry: which PrintDocument block to render, and how. */
export interface MerchantTemplateBlockSpec {
    /** Block kind from the PrintDocument v1 vocabulary. */
    readonly kind: MerchantTemplateBlockKind;
    /** Hide this block without removing it from the ordered list. Default true. */
    readonly visible?: boolean;
    /**
     * Label variants: replaces the RESOLVED label text of whitelisted semantic
     * slots with merchant literals (applied to every language variant).
     */
    readonly labels?: Readonly<Record<string, string>>;
}
/**
 * Versioned merchant template payload. Exactly these four root fields exist
 * in v1; anything else is rejected on write/import.
 */
export interface MerchantPrintTemplatePayload {
    readonly format: typeof MERCHANT_TEMPLATE_FORMAT;
    readonly documentType: MerchantTemplateDocumentType;
    readonly schemaVersion: typeof MERCHANT_TEMPLATE_SCHEMA_VERSION;
    /**
     * The complete block composition, in render order. A block absent from
     * this list is NOT rendered; visibility can additionally hide an entry.
     */
    readonly blocks: readonly MerchantTemplateBlockSpec[];
}
/** Discriminated validation result with actionable, pointer-carrying errors. */
export type MerchantTemplateValidation = {
    readonly ok: true;
    readonly payload: MerchantPrintTemplatePayload;
} | {
    readonly ok: false;
    readonly errors: readonly string[];
};
/**
 * Validate an already-parsed merchant template payload. Pure; returns every
 * violation found (not just the first) so import UIs can show actionable
 * errors. Unknown schema majors, unknown formats/document types, unknown
 * blocks, unknown fields, duplicate blocks, and wrong types all fail.
 */
export declare function validateMerchantTemplate(value: unknown): MerchantTemplateValidation;
/**
 * Validate a raw JSON TEXT payload: enforces the ~256 KB size cap, then
 * parses and validates. Use this on every write/import path.
 */
export declare function validateMerchantTemplateText(raw: string): MerchantTemplateValidation;
/**
 * Canonical JSON text of a VALIDATED payload: object keys recursively sorted,
 * array order untouched (block order is semantic), no insignificant
 * whitespace. This exact text is what the service persists and the only text
 * integrity checksums hash (table column + transfer envelope), so
 * whitespace/key-order reformatting of a payload never changes its digest.
 */
export declare function serializeMerchantTemplatePayload(payload: MerchantPrintTemplatePayload): string;
/**
 * Apply a validated merchant template to a built PrintDocument: selects the
 * configured blocks (in the template's order, honoring `visible`) and applies
 * label variants. Pure — returns a new frozen document; the input is untouched.
 */
export declare function applyMerchantTemplate(document: PrintDocument, payload: MerchantPrintTemplatePayload): PrintDocument;
//# sourceMappingURL=merchant-template.d.ts.map