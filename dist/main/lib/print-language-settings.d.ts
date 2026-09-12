/**
 * Receipt/KOT language policy settings (#441, epic #438).
 *
 * Bridges the neutral shared print kernel to the tenant settings store.
 * The kernel stays registry-independent: this module injects the backend's
 * registry-derived view — the generated print-label language table
 * (main/print/print-labels.generated.ts). The print-label generation workflow
 * owns that backend view; no language union is hardcoded here.
 */
import { type KotLanguagePolicy, type ReceiptLanguagePolicy } from '../../shared/print';
export declare const BILL_LANGUAGE_POLICY_KEY = "bill_language_policy";
export declare const KOT_LANGUAGE_POLICY_KEY = "kot_language_policy";
export declare const LANGUAGE_POLICY_SETTING_KEYS: ReadonlySet<string>;
/** Canonical JSON stored when a tenant has not customized the policy. */
export declare function defaultLanguagePolicySettingJson(): string;
export type LanguagePolicyValidation = {
    ok: true;
    stored: string;
} | {
    ok: false;
    error: string;
};
/**
 * Validate an untrusted policy value for a language-policy settings key.
 * Accepts a JSON string or an already-parsed object; returns the canonical
 * JSON to persist. Invalid payloads are rejected with a reason.
 */
export declare function validateLanguagePolicySetting(key: string, value: unknown): LanguagePolicyValidation;
export type StoredPrintLanguagePolicy = ReceiptLanguagePolicy | KotLanguagePolicy;
/**
 * Lenient read-side parse of a stored policy. Malformed or invalid stored
 * values fall back to the inherit/none default so a bad row can never break
 * printing; writers are the strict path.
 */
export declare function parseStoredLanguagePolicy(key: string, stored: string | undefined): StoredPrintLanguagePolicy;
//# sourceMappingURL=print-language-settings.d.ts.map