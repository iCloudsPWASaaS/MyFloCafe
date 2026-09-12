/**
 * Shared print kernel — language policy resolution & validation (#441).
 * Pure functions only. Registry facts are injected, never imported.
 */
import type { KotLanguagePolicy, LanguageRegistryFacts, PrimaryLanguageSelection, PrintLanguageCode, PrintLanguagePolicy, ReceiptLanguagePolicy, ResolvedPrintLanguages } from './types';
/** Maximum total languages per receipt document in v1 (primary + 1). */
export declare const MAX_RECEIPT_LANGUAGES = 2;
/**
 * Resolve the effective primary language for a policy.
 * `inherit` yields the caller-supplied store/UI language; `fixed` yields the
 * configured language. Empty/whitespace store languages are returned as-is:
 * English fallback is a renderer concern (#440 owns label fallbacks), not a
 * kernel decision about specific codes.
 */
export declare function resolvePrimaryLanguage(primary: PrimaryLanguageSelection, storeLanguage: PrintLanguageCode): PrintLanguageCode;
/**
 * Resolve the ordered language list for a receipt: resolved primary first,
 * then any additional language. Duplicates (additional === resolved primary)
 * collapse so a document never renders the same language twice. The result
 * length never exceeds {@link MAX_RECEIPT_LANGUAGES}.
 */
export declare function resolveReceiptLanguages(policy: ReceiptLanguagePolicy, storeLanguage: PrintLanguageCode): ResolvedPrintLanguages;
/** Resolve the single primary language for a KOT policy. */
export declare function resolveKotLanguage(policy: KotLanguagePolicy, storeLanguage: PrintLanguageCode): PrintLanguageCode;
export type PrintLanguagePolicyParseResult<P> = {
    readonly ok: true;
    readonly policy: P;
} | {
    readonly ok: false;
    readonly error: string;
};
/**
 * Validate and normalize an untrusted receipt language policy payload.
 * Enforces: known keys only, valid primary mode, registered+selectable
 * languages (via injected facts), dedupe, and ≤1 additional entry (max-2
 * documents in v1). Frozen result — safe to persist verbatim.
 */
export declare function parsePrintLanguagePolicy(raw: unknown, facts: LanguageRegistryFacts): PrintLanguagePolicyParseResult<ReceiptLanguagePolicy>;
/**
 * Validate and normalize an untrusted KOT language policy payload.
 * Single-primary for v1: `additional` must be absent or empty.
 */
export declare function parseKotLanguagePolicy(raw: unknown, facts: LanguageRegistryFacts): PrintLanguagePolicyParseResult<KotLanguagePolicy>;
/** Canonical stored form for a freshly defaulted policy (inherit / none). */
export declare function defaultPrintLanguagePolicy(): PrintLanguagePolicy<readonly []>;
//# sourceMappingURL=policy.d.ts.map