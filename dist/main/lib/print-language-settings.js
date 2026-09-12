"use strict";
/**
 * Receipt/KOT language policy settings (#441, epic #438).
 *
 * Bridges the neutral shared print kernel to the tenant settings store.
 * The kernel stays registry-independent: this module injects the backend's
 * registry-derived view — the generated print-label language table
 * (main/print/print-labels.generated.ts). The print-label generation workflow
 * owns that backend view; no language union is hardcoded here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LANGUAGE_POLICY_SETTING_KEYS = exports.KOT_LANGUAGE_POLICY_KEY = exports.BILL_LANGUAGE_POLICY_KEY = void 0;
exports.defaultLanguagePolicySettingJson = defaultLanguagePolicySettingJson;
exports.validateLanguagePolicySetting = validateLanguagePolicySetting;
exports.parseStoredLanguagePolicy = parseStoredLanguagePolicy;
const print_labels_generated_1 = require("../print/print-labels.generated");
const print_1 = require("../../shared/print");
exports.BILL_LANGUAGE_POLICY_KEY = 'bill_language_policy';
exports.KOT_LANGUAGE_POLICY_KEY = 'kot_language_policy';
exports.LANGUAGE_POLICY_SETTING_KEYS = new Set([
    exports.BILL_LANGUAGE_POLICY_KEY,
    exports.KOT_LANGUAGE_POLICY_KEY,
]);
/** Backend registry view: languages with generated print labels. */
const SELECTABLE_PRINT_LANGUAGES = new Set(print_labels_generated_1.PRINT_LABEL_LANGUAGES);
const REGISTRY_FACTS = {
    isSelectableLanguage: (code) => SELECTABLE_PRINT_LANGUAGES.has(code),
};
/** Canonical JSON stored when a tenant has not customized the policy. */
function defaultLanguagePolicySettingJson() {
    return JSON.stringify((0, print_1.defaultPrintLanguagePolicy)());
}
/**
 * Validate an untrusted policy value for a language-policy settings key.
 * Accepts a JSON string or an already-parsed object; returns the canonical
 * JSON to persist. Invalid payloads are rejected with a reason.
 */
function validateLanguagePolicySetting(key, value) {
    if (typeof value === 'string') {
        let parsed;
        try {
            parsed = JSON.parse(value);
        }
        catch {
            return { ok: false, error: `${key} must be valid policy JSON` };
        }
        return validateLanguagePolicySetting(key, parsed);
    }
    if (key === exports.BILL_LANGUAGE_POLICY_KEY) {
        const result = (0, print_1.parsePrintLanguagePolicy)(value, REGISTRY_FACTS);
        return result.ok
            ? { ok: true, stored: JSON.stringify(result.policy) }
            : { ok: false, error: `Invalid ${key}: ${result.error}` };
    }
    if (key === exports.KOT_LANGUAGE_POLICY_KEY) {
        const result = (0, print_1.parseKotLanguagePolicy)(value, REGISTRY_FACTS);
        return result.ok
            ? { ok: true, stored: JSON.stringify(result.policy) }
            : { ok: false, error: `Invalid ${key}: ${result.error}` };
    }
    return { ok: false, error: `${key} is not a language policy key` };
}
/**
 * Lenient read-side parse of a stored policy. Malformed or invalid stored
 * values fall back to the inherit/none default so a bad row can never break
 * printing; writers are the strict path.
 */
function parseStoredLanguagePolicy(key, stored) {
    const fallback = (0, print_1.defaultPrintLanguagePolicy)();
    if (!stored)
        return fallback;
    try {
        const parsed = JSON.parse(stored);
        if (key === exports.KOT_LANGUAGE_POLICY_KEY) {
            const result = (0, print_1.parseKotLanguagePolicy)(parsed, REGISTRY_FACTS);
            return result.ok ? result.policy : fallback;
        }
        const result = (0, print_1.parsePrintLanguagePolicy)(parsed, REGISTRY_FACTS);
        return result.ok ? result.policy : fallback;
    }
    catch {
        return fallback;
    }
}
//# sourceMappingURL=print-language-settings.js.map