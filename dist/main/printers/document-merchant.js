"use strict";
/**
 * Merchant template → classic thermal receipt renderer (#447, epic #438).
 *
 * Resolves an ACTIVE merchant template through the PrintDocument pipeline:
 * authoritative rows → PrintData/PrintContext → buildBillDocument →
 * applyMerchantTemplate (semantic block selection/order/label variants) →
 * classic token lines → bytes. Because the template is applied at the
 * SEMANTIC layer, every renderer that consumes the applied document produces
 * the same content — the parity harness asserts this byte-equivalence in
 * merchant-template mode.
 *
 * v1 renders merchant receipt documents through the classic layout pipeline;
 * compact/KOT adoption of merchant docs belongs to their owning issues.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMerchantReceiptViaDocument = renderMerchantReceiptViaDocument;
const merchant_print_templates_1 = require("../services/merchant-print-templates");
const print_1 = require("../../shared/print");
const print_2 = require("../../shared/print");
const document_classic_1 = require("./document-classic");
const thermal_1 = require("./thermal");
/**
 * Render a bill through a merchant template row. Fail-closed on render too:
 * if the stored payload no longer validates against this build's schema
 * (e.g. written by a newer version), a warning is recorded and the plain
 * classic document is rendered instead of garbage or nothing.
 */
function renderMerchantReceiptViaDocument(order, bill, business, templateId, opts) {
    const warnings = [];
    const printContext = (0, document_classic_1.buildBillPrintContext)({
        columns: opts.columns,
        language: opts.language,
        ...(opts.additionalLanguage !== undefined ? { additionalLanguage: opts.additionalLanguage } : {}),
        business,
    });
    const baseOptions = {
        columns: opts.columns,
        language: printContext.languages[0],
        locale: printContext.locale,
        ...(printContext.timezone !== undefined ? { timezone: printContext.timezone } : {}),
        currencySymbol: printContext.currencySymbol,
        currency: String(business?.currency || 'INR'),
        trimDecimals: printContext.trimDecimals,
        useUnicode: opts.useUnicode,
        arabicShaping: opts.arabicShaping,
        cutMode: opts.cutMode,
        capabilities: opts.capabilities,
    };
    const finish = (lines, fellBackToClassic) => {
        const data = (0, thermal_1.buildEscPos)(lines, opts.useUnicode, {
            cutMode: opts.cutMode,
            arabicShaping: opts.arabicShaping,
            columns: opts.columns,
            language: opts.language,
            capabilities: opts.capabilities,
        }, warnings);
        return { data, lines, warnings, fellBackToClassic };
    };
    const row = (0, merchant_print_templates_1.loadActiveMerchantPrintTemplate)(templateId);
    if (!row) {
        warnings.push({
            field: 'bill_template',
            text: templateId,
            message: `Merchant template ${templateId} is not active; rendered with the classic layout.`,
        });
        return finish((0, document_classic_1.renderBillDocumentToClassicLines)((0, print_2.buildBillDocument)((0, document_classic_1.buildBillPrintData)(order, bill, business, opts.isReprint), printContext), baseOptions), true);
    }
    let parsed;
    try {
        parsed = JSON.parse(row.payload_json);
    }
    catch {
        parsed = null;
    }
    const validation = (0, print_1.validateMerchantTemplate)(parsed);
    const printData = (0, document_classic_1.buildBillPrintData)(order, bill, business, opts.isReprint);
    if (!validation.ok) {
        // Fail closed: unknown future schema or corrupt payload must never reach
        // a renderer. Warn loudly and fall back to the unmodified classic doc.
        warnings.push({
            field: 'bill_template',
            text: templateId,
            message: `Merchant template ${templateId} failed validation (${validation.errors[0]}); rendered with the classic layout.`,
        });
        return finish((0, document_classic_1.renderBillDocumentToClassicLines)((0, print_2.buildBillDocument)(printData, printContext), baseOptions), true);
    }
    const document = (0, print_2.applyMerchantTemplate)((0, print_2.buildBillDocument)(printData, printContext), validation.payload);
    return finish((0, document_classic_1.renderBillDocumentToClassicLines)(document, baseOptions), false);
}
//# sourceMappingURL=document-merchant.js.map