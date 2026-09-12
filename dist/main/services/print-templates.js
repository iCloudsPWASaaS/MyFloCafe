"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CORE_BILL_TEMPLATES = void 0;
exports.isCoreBillTemplate = isCoreBillTemplate;
exports.parseBillTemplateSelection = parseBillTemplateSelection;
exports.serializeBillTemplateSelection = serializeBillTemplateSelection;
exports.upgradeBillTemplateValue = upgradeBillTemplateValue;
exports.listInstalledPrintTemplates = listInstalledPrintTemplates;
exports.loadInstalledPrintTemplate = loadInstalledPrintTemplate;
exports.isAvailableBillTemplate = isAvailableBillTemplate;
const db_1 = require("../db");
const merchant_print_templates_1 = require("./merchant-print-templates");
exports.CORE_BILL_TEMPLATES = ['classic', 'compact'];
function isCoreBillTemplate(value) {
    return exports.CORE_BILL_TEMPLATES.includes(value);
}
/** Shape check only; availability is a separate concern. */
function parseStructuredSelection(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const { source, id } = record;
    if (typeof id !== 'string' || id.length === 0)
        return null;
    if (source !== 'core' && source !== 'pack' && source !== 'merchant')
        return null;
    return { source, id };
}
/**
 * Resolve ANY persisted `bill_template` value into a structured selection:
 * accepts the structured object, its JSON-string encoding, and every legacy
 * bare-string form. Returns null for values that resolve to nothing.
 *
 * Legacy resolution order mirrors history: core names first, then pack
 * template ids. Merchant ids are uuids that never collide with either.
 */
function parseBillTemplateSelection(rawValue) {
    // Structured object form.
    const direct = parseStructuredSelection(rawValue);
    if (direct)
        return direct;
    // Structured JSON-string form.
    let value = rawValue;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                const parsed = parseStructuredSelection(JSON.parse(trimmed));
                if (parsed)
                    return parsed;
            }
            catch {
                // Not JSON after all — fall through to legacy string handling.
            }
        }
        value = trimmed;
    }
    if (typeof value !== 'string' || value.length === 0)
        return null;
    // Legacy bare strings.
    const normalized = value.toLowerCase();
    if (exports.CORE_BILL_TEMPLATES.includes(normalized)) {
        return { source: 'core', id: normalized };
    }
    if (loadInstalledPrintTemplate(value))
        return { source: 'pack', id: value };
    if ((0, merchant_print_templates_1.loadMerchantPrintTemplateRow)(value))
        return { source: 'merchant', id: value };
    return null;
}
/** Canonical persistence form for a selection (stored in settings). */
function serializeBillTemplateSelection(selection) {
    return JSON.stringify({ source: selection.source, id: selection.id });
}
/**
 * Upgrade any accepted input to its canonical structured form when it is
 * resolvable; returns null for unresolvable values (caller decides policy).
 */
function upgradeBillTemplateValue(rawValue) {
    const selection = parseBillTemplateSelection(rawValue);
    return selection ? serializeBillTemplateSelection(selection) : null;
}
function listInstalledPrintTemplates() {
    try {
        return (0, db_1.getDatabase)().prepare(`
      SELECT template.*
      FROM installed_print_templates AS template
      JOIN country_pack_versions AS version ON version.id = template.pack_version_id
      JOIN country_packs AS pack ON pack.id = template.pack_id
      WHERE version.status NOT IN ('revoked', 'incompatible')
        AND pack.status IN ('active', 'installed')
      ORDER BY template.country, template.display_name, template.template_id
    `).all();
    }
    catch {
        return [];
    }
}
function loadInstalledPrintTemplate(templateId) {
    try {
        const row = (0, db_1.getDatabase)().prepare(`
      SELECT template.*
      FROM installed_print_templates AS template
      JOIN country_pack_versions AS version ON version.id = template.pack_version_id
      JOIN country_packs AS pack ON pack.id = template.pack_id
      WHERE template.template_id = ?
        AND version.status NOT IN ('revoked', 'incompatible')
        AND pack.status IN ('active', 'installed')
      LIMIT 1
    `).get(templateId);
        return row || null;
    }
    catch {
        return null;
    }
}
/**
 * Extended for #447: accepts both the structured `{ source, id }` forms and
 * every legacy bare-string value; merchant templates qualify while they have
 * an ACTIVE row (drafts and archived rows are not selectable).
 */
function isAvailableBillTemplate(value) {
    const selection = parseBillTemplateSelection(value);
    if (!selection)
        return false;
    switch (selection.source) {
        case 'core':
            return isCoreBillTemplate(selection.id);
        case 'pack':
            return Boolean(loadInstalledPrintTemplate(selection.id));
        case 'merchant': {
            const row = (0, merchant_print_templates_1.loadMerchantPrintTemplateRow)(selection.id);
            return Boolean(row) && row.status === 'active';
        }
    }
}
//# sourceMappingURL=print-templates.js.map