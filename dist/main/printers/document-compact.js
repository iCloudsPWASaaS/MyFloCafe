"use strict";
/**
 * PrintDocument v1 → compact thermal receipt renderer (#443, epic #438).
 *
 * Maps `shared/print` blocks onto the SAME ESC/POS token lines the legacy
 * compact layout (`formatCompactReceipt`) produces, byte for byte, so the
 * compact surface renders through `data → document → lines → bytes` without
 * changing printed semantics.
 *
 * Layering: this module lives in `main/` (transport token syntax + generated
 * label catalog); all SEMANTICS come from the document — no bill/order row
 * is read here beyond the caller's normalization step (`buildBillPrintData`,
 * reused from the classic pipeline).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderBillDocumentToCompactLines = renderBillDocumentToCompactLines;
exports.renderCompactReceiptViaDocument = renderCompactReceiptViaDocument;
const db_1 = require("../db");
const countries_1 = require("../countries");
const thermal_1 = require("./thermal");
const document_classic_1 = require("./document-classic");
const print_1 = require("../../shared/print");
function labelOf(label) {
    return label.primary;
}
/** Literal payment methods keep the legacy capitalize fallback. */
function paymentLabel(label) {
    return label.conceptId !== undefined ? label.primary : capitalize(label.primary);
}
function capitalize(text) {
    return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
/** Column header row, composed from the document's own header labels. */
function compactItemHeader(block, nameLen, amtLen, language, capabilities) {
    const qtyW = 4;
    const itemLabel = (0, thermal_1.normalizeThermalText)(labelOf(block.header.item), capabilities);
    const qtyLabel = (0, thermal_1.normalizeThermalText)(labelOf(block.header.quantity), capabilities);
    const amountLabel = (0, thermal_1.normalizeThermalText)(labelOf(block.header.amount), capabilities);
    const item = itemLabel.slice(0, nameLen).padEnd(nameLen);
    const qty = qtyLabel.slice(0, qtyW).padEnd(qtyW);
    const amount = amountLabel.slice(0, Math.max(1, amtLen - 1));
    return item + qty + ' '.repeat(amtLen - amount.length) + amount;
}
/**
 * Map a PrintDocument onto the legacy compact token-line layout. Pure with
 * respect to business data: everything rendered comes from the document.
 */
function renderBillDocumentToCompactLines(document, options) {
    const cols = options.columns;
    const lines = [];
    const header = (0, print_1.getBlock)(document, 'business-header');
    const meta = (0, print_1.getBlock)(document, 'document-meta');
    const customer = (0, print_1.getBlock)(document, 'customer');
    const items = (0, print_1.getBlock)(document, 'item-table');
    const breakdown = (0, print_1.getBlock)(document, 'tax-breakdown');
    const totals = (0, print_1.getBlock)(document, 'totals');
    const payments = (0, print_1.getBlock)(document, 'payments');
    const messages = (0, print_1.getBlock)(document, 'message');
    const prefix = (0, thermal_1.resolveCurrencyPrefix)(options.currencySymbol ?? '₹', options.useUnicode, options.capabilities);
    const fractionDigits = (0, countries_1.getCurrencyFractionDigits)(options.currency || 'INR');
    const trimDecimals = options.trimDecimals === true;
    const tzOptions = options.timezone ? { timeZone: options.timezone } : undefined;
    const bar = '='.repeat(cols);
    const dash = '-'.repeat(cols);
    const normalize = (text) => (0, thermal_1.normalizeThermalText)(text, options.capabilities);
    lines.push('{INIT}');
    // Reprint banner (MessageBlock).
    if (messages?.reprintBanner) {
        lines.push('{CENTER}{BOLD}{DOUBLE_HEIGHT}{DOUBLE_WIDTH}** ' + normalize(labelOf(messages.reprintBanner)) + ' **{/DOUBLE_WIDTH}{/DOUBLE_HEIGHT}{/BOLD}{/CENTER}');
    }
    // Online-order banner (#284, MessageBlock).
    if (messages?.onlineOrderBanner) {
        const banner = messages.onlineOrderBanner;
        lines.push('{CENTER}{BOLD}{DOUBLE_HEIGHT}{DOUBLE_WIDTH}** ' + normalize(labelOf(banner.label)) + ' **{/DOUBLE_WIDTH}{/DOUBLE_HEIGHT}{/BOLD}{/CENTER}');
        if (banner.platform.text)
            lines.push('{CENTER}' + normalize(banner.platform.text) + '{/CENTER}');
        if (banner.externalOrderId.text)
            lines.push('{CENTER}#' + normalize(banner.externalOrderId.text) + '{/CENTER}');
    }
    // Business header (store name only — compact keeps contact facts in the footer).
    if (header?.name)
        lines.push('{STORE_NAME}{CENTER}{BOLD}' + (0, thermal_1.truncateShapedLine)(header.name.text, cols, options.arabicShaping, options.language, options.capabilities) + '{/BOLD}{/CENTER}');
    lines.push(bar);
    // Document meta.
    if (meta) {
        lines.push(normalize(labelOf(meta.billNumberLabel) + ': ' + meta.invoiceNumber.text));
        const date = (0, db_1.parseDbTimestamp)(meta.timestamp.text);
        lines.push(normalize(labelOf(meta.dateLabel) + ': ' + date.toLocaleDateString(options.locale + '-u-nu-latn', tzOptions) + ' ' + date.toLocaleTimeString(options.locale + '-u-nu-latn', tzOptions)));
        if (meta.table) {
            lines.push((0, thermal_1.truncateShapedLine)(meta.table.label.primary.replace('{name}', meta.table.name.text), cols, options.arabicShaping, options.language, options.capabilities));
        }
    }
    if (customer?.name)
        lines.push((0, thermal_1.truncateShapedLine)(labelOf(customer.nameLabel) + ': ' + customer.name.text, cols, options.arabicShaping, options.language, options.capabilities));
    if (customer?.phone)
        lines.push(normalize(labelOf(customer.phoneLabel) + ': ' + customer.phone.text));
    if (customer?.address)
        (0, thermal_1.pushWrapped)(lines, customer.address.text, cols, options.language, options.capabilities);
    lines.push(dash);
    // Item table.
    if (items) {
        const amtLen = (0, thermal_1.itemAmountWidth)({ items: items.rows.map((row) => ({ total: row.amount, addons: row.addons.map((addon) => ({ price: addon.price })) })) }, prefix, options.locale, trimDecimals, cols, fractionDigits);
        const nameLen = (0, thermal_1.itemNameWidth)(cols, amtLen);
        lines.push(compactItemHeader(items, nameLen, amtLen, options.language, options.capabilities));
        lines.push(dash);
        for (const row of items.rows) {
            lines.push(...(0, thermal_1.itemRows)({ product_name: row.name.text, quantity: row.quantity, total: row.amount }, nameLen, amtLen, cols, prefix, options.locale, trimDecimals, options.language, fractionDigits, options.capabilities));
            for (const addon of row.addons) {
                lines.push(...(0, thermal_1.addonRows)({ name: addon.name.text, price: addon.price, quantity: addon.quantity }, nameLen, amtLen, cols, prefix, options.locale, trimDecimals, options.language, fractionDigits, options.capabilities));
            }
            if (row.specialInstructions) {
                lines.push(normalize('  ' + labelOf(items.noteLabel) + ': ' + (0, thermal_1.truncate)(row.specialInstructions.text, cols - 8, options.language, options.capabilities)));
            }
        }
    }
    lines.push(dash);
    // Totals (compact has no loyalty points section).
    if (totals) {
        lines.push(...(0, thermal_1.financialRows)(labelOf(totals.subtotal.label), (0, thermal_1.formatCurrency)(totals.subtotal.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
        if (totals.discount) {
            lines.push(...(0, thermal_1.financialRows)(labelOf(totals.discount.label), '-' + (0, thermal_1.formatCurrency)(totals.discount.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
        }
        if (breakdown && breakdown.lines.length > 0) {
            for (const line of breakdown.lines) {
                const rateSuffix = line.rate === null ? '' : ` @${line.rate}%`;
                const label = (0, thermal_1.truncate)(labelOf(line.label) + rateSuffix, cols - 12, options.language, options.capabilities);
                lines.push(...(0, thermal_1.financialRows)(label, (0, thermal_1.formatCurrency)(line.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
            }
        }
        else if (totals.tax) {
            lines.push(...(0, thermal_1.financialRows)(labelOf(totals.tax.label), (0, thermal_1.formatCurrency)(totals.tax.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
        }
        if (totals.serviceCharge) {
            lines.push(...(0, thermal_1.financialRows)(labelOf(totals.serviceCharge.label), (0, thermal_1.formatCurrency)(totals.serviceCharge.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
        }
        if (totals.deliveryCharge) {
            lines.push(...(0, thermal_1.financialRows)(labelOf(totals.deliveryCharge.label), (0, thermal_1.formatCurrency)(totals.deliveryCharge.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
        }
        if (totals.packagingCharge) {
            lines.push(...(0, thermal_1.financialRows)(labelOf(totals.packagingCharge.label), (0, thermal_1.formatCurrency)(totals.packagingCharge.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
        }
        lines.push(...(0, thermal_1.financialRows)(labelOf(totals.grandTotal.label), (0, thermal_1.formatCurrency)(totals.grandTotal.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities).map((line) => `{BOLD}${line}{/BOLD}`));
    }
    // Payments.
    if (payments && payments.lines.length > 0) {
        lines.push(dash);
        for (const line of payments.lines) {
            const methodLabel = (0, thermal_1.truncate)(paymentLabel(line.label), cols - 12, options.language, options.capabilities);
            lines.push(...(0, thermal_1.financialRows)(methodLabel, (0, thermal_1.formatCurrency)(line.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
        }
    }
    // Footer contact details.
    lines.push(bar);
    if (header?.address)
        (0, thermal_1.pushWrapped)(lines, header.address.text, cols, options.language, options.capabilities);
    if (header?.phone && header.phoneLabel)
        (0, thermal_1.pushWrapped)(lines, labelOf(header.phoneLabel) + ': ' + header.phone.text, cols, options.language, options.capabilities);
    if (header?.taxId)
        (0, thermal_1.pushWrapped)(lines, labelOf(header.taxId.label) + ': ' + header.taxId.value.text, cols, options.language, options.capabilities);
    if (messages?.footerNote)
        (0, thermal_1.pushCenteredWrapped)(lines, messages.footerNote.text, cols, options.language, options.capabilities);
    else
        lines.push('{CENTER}' + normalize(labelOf(messages.thankYou)) + '{/CENTER}');
    (0, thermal_1.appendPoweredByFooter)(lines);
    lines.push('{CUT}');
    return lines;
}
/**
 * Full document-driven compact pipeline: authoritative rows → PrintData /
 * PrintContext → buildBillDocument → compact token lines → buildEscPos.
 */
function renderCompactReceiptViaDocument(order, bill, business, opts) {
    const printData = (0, document_classic_1.buildBillPrintData)(order, bill, business, opts.isReprint);
    const printContext = (0, document_classic_1.buildBillPrintContext)({
        columns: opts.columns,
        language: opts.language,
        ...(opts.additionalLanguage !== undefined ? { additionalLanguage: opts.additionalLanguage } : {}),
        business,
    });
    const document = (0, print_1.buildBillDocument)(printData, printContext);
    const warnings = [];
    const lines = renderBillDocumentToCompactLines(document, {
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
    });
    const data = (0, thermal_1.buildEscPos)(lines, opts.useUnicode, { cutMode: opts.cutMode, arabicShaping: opts.arabicShaping, columns: opts.columns, language: opts.language, capabilities: opts.capabilities }, warnings);
    return { document, lines, data, warnings };
}
//# sourceMappingURL=document-compact.js.map