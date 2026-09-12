"use strict";
/**
 * Shared print kernel — language policy resolution & validation (#441).
 * Pure functions only. Registry facts are injected, never imported.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RECEIPT_LANGUAGES = void 0;
exports.resolvePrimaryLanguage = resolvePrimaryLanguage;
exports.resolveReceiptLanguages = resolveReceiptLanguages;
exports.resolveKotLanguage = resolveKotLanguage;
exports.parsePrintLanguagePolicy = parsePrintLanguagePolicy;
exports.parseKotLanguagePolicy = parseKotLanguagePolicy;
exports.defaultPrintLanguagePolicy = defaultPrintLanguagePolicy;
/** Maximum total languages per receipt document in v1 (primary + 1). */
exports.MAX_RECEIPT_LANGUAGES = 2;
/**
 * Resolve the effective primary language for a policy.
 * `inherit` yields the caller-supplied store/UI language; `fixed` yields the
 * configured language. Empty/whitespace store languages are returned as-is:
 * English fallback is a renderer concern (#440 owns label fallbacks), not a
 * kernel decision about specific codes.
 */
function resolvePrimaryLanguage(primary, storeLanguage) {
    return primary.mode === 'inherit' ? storeLanguage : primary.language;
}
/**
 * Resolve the ordered language list for a receipt: resolved primary first,
 * then any additional language. Duplicates (additional === resolved primary)
 * collapse so a document never renders the same language twice. The result
 * length never exceeds {@link MAX_RECEIPT_LANGUAGES}.
 */
function resolveReceiptLanguages(policy, storeLanguage) {
    const primary = resolvePrimaryLanguage(policy.primary, storeLanguage);
    const [additional] = policy.additional;
    if (additional === undefined || additional === primary) {
        return [primary];
    }
    return [primary, additional];
}
/** Resolve the single primary language for a KOT policy. */
function resolveKotLanguage(policy, storeLanguage) {
    return resolvePrimaryLanguage(policy.primary, storeLanguage);
}
function parsePrimarySelection(raw, facts) {
    if (typeof raw !== 'object' || raw === null) {
        return { ok: false, error: 'policy.primary must be an object' };
    }
    const mode = raw.mode;
    if (mode === 'inherit')
        return { ok: true, value: { mode: 'inherit' } };
    if (mode === 'fixed') {
        const language = raw.language;
        if (typeof language !== 'string' || language.length === 0) {
            return { ok: false, error: 'policy.primary.language must be a non-empty string when mode is "fixed"' };
        }
        if (!facts.isSelectableLanguage(language)) {
            return { ok: false, error: `policy.primary.language "${language}" is not a registered selectable language` };
        }
        return { ok: true, value: { mode: 'fixed', language } };
    }
    return { ok: false, error: 'policy.primary.mode must be "inherit" or "fixed"' };
}
function parseAdditional(raw, maxEntries, facts) {
    if (raw === null) {
        return { ok: false, error: 'policy.additional must be an array' };
    }
    if (!Array.isArray(raw)) {
        return { ok: false, error: 'policy.additional must be an array' };
    }
    if (raw.length > maxEntries) {
        return { ok: false, error: `policy.additional supports at most ${maxEntries} entr${maxEntries === 1 ? 'y' : 'ies'} in v1` };
    }
    const seen = new Set();
    for (const entry of raw) {
        if (typeof entry !== 'string' || entry.length === 0) {
            return { ok: false, error: 'policy.additional entries must be non-empty strings' };
        }
        if (!facts.isSelectableLanguage(entry)) {
            return { ok: false, error: `policy.additional entry "${entry}" is not a registered selectable language` };
        }
        if (seen.has(entry)) {
            return { ok: false, error: `policy.additional entries must be deduped (duplicate "${entry}")` };
        }
        seen.add(entry);
    }
    return { ok: true, value: Object.freeze([...raw]) };
}
function parsePolicyBody(raw, maxAdditional, facts) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { ok: false, error: 'policy must be a JSON object' };
    }
    const shape = raw;
    for (const key of Object.keys(shape)) {
        if (key !== 'primary' && key !== 'additional') {
            return { ok: false, error: `unknown policy key "${key}"` };
        }
    }
    if (shape.primary === undefined) {
        return { ok: false, error: 'policy.primary is required' };
    }
    const primary = parsePrimarySelection(shape.primary, facts);
    if (!primary.ok)
        return primary;
    const additional = parseAdditional(shape.additional === undefined ? [] : shape.additional, maxAdditional, facts);
    if (!additional.ok)
        return additional;
    if (primary.value.mode === 'fixed'
        && additional.value.includes(primary.value.language)) {
        return { ok: false, error: `policy.additional duplicates the fixed primary "${primary.value.language}"` };
    }
    return { ok: true, primary: primary.value, additional: additional.value };
}
/**
 * Validate and normalize an untrusted receipt language policy payload.
 * Enforces: known keys only, valid primary mode, registered+selectable
 * languages (via injected facts), dedupe, and ≤1 additional entry (max-2
 * documents in v1). Frozen result — safe to persist verbatim.
 */
function parsePrintLanguagePolicy(raw, facts) {
    const body = parsePolicyBody(raw, 1, facts);
    if (!body.ok)
        return body;
    const policy = body.additional.length === 0
        ? { primary: body.primary, additional: [] }
        : { primary: body.primary, additional: [body.additional[0]] };
    return { ok: true, policy: Object.freeze(policy) };
}
/**
 * Validate and normalize an untrusted KOT language policy payload.
 * Single-primary for v1: `additional` must be absent or empty.
 */
function parseKotLanguagePolicy(raw, facts) {
    const body = parsePolicyBody(raw, 0, facts);
    if (!body.ok)
        return body;
    const policy = { primary: body.primary, additional: [] };
    return { ok: true, policy: Object.freeze(policy) };
}
/** Canonical stored form for a freshly defaulted policy (inherit / none). */
function defaultPrintLanguagePolicy() {
    const policy = { primary: { mode: 'inherit' }, additional: [] };
    return Object.freeze(policy);
}
//# sourceMappingURL=policy.js.map