"use strict";
/**
 * PrintDocument v1 → classic thermal receipt renderer (#442, epic #438).
 *
 * This is the first document-driven consumer of the shared PrintDocument
 * model: it maps `shared/print` blocks onto the SAME ESC/POS token lines the
 * legacy classic layout (`formatClassicReceipt`) produces, so the preview
 * pipeline can switch to `data → document → lines → bytes` without changing
 * printed semantics.
 *
 * Layering: this module lives in `main/` (it touches transport token syntax
 * and the generated label catalog); all SEMANTICS come from the document —
 * no bill/order row is read here beyond the caller's normalization step
 * (`buildBillPrintData`). Since #443 the classic receipt surface (preview AND
 * actual printing) renders through this pipeline; `formatClassicReceipt`
 * delegates here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPrintLanguageDirection = detectPrintLanguageDirection;
exports.buildBillPrintData = buildBillPrintData;
exports.buildBillPrintContext = buildBillPrintContext;
exports.renderBillDocumentToClassicLines = renderBillDocumentToClassicLines;
exports.renderClassicReceiptViaDocument = renderClassicReceiptViaDocument;
const db_1 = require("../db");
const countries_1 = require("../countries");
const tax_components_1 = require("../services/tax-components");
const print_labels_generated_1 = require("../print/print-labels.generated");
const thermal_1 = require("./thermal");
const print_1 = require("../../shared/print");
// ---------------------------------------------------------------------------
// Direction facts (registry-derived, no language unions)
// ---------------------------------------------------------------------------
/** Concepts whose generated strings are stable enough to reveal script. */
const DIRECTION_PROBE_CONCEPTS = [
    'print.thankYouShort',
    'receipt.reprint',
    'pos.subtotal',
    'receipt.item',
    'print.grandTotal',
];
/**
 * Derive a language's base direction from its own generated label strings.
 * Registry-derived fact injection: the kernel never hardcodes language
 * unions, and this backend view reads only the generated print-label table.
 */
function detectPrintLanguageDirection(lang) {
    if (!(0, print_labels_generated_1.isGeneratedPrintLanguage)(lang))
        return 'ltr';
    const sample = DIRECTION_PROBE_CONCEPTS.map((conceptId) => (0, print_labels_generated_1.printLabel)(lang, conceptId)).join(' ');
    return (0, print_1.containsRtlScript)(sample) ? 'rtl' : 'ltr';
}
// ---------------------------------------------------------------------------
// PrintData / PrintContext normalization (caller-side, main-process layer)
// ---------------------------------------------------------------------------
function parsePaymentDetails(raw) {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(value))
        return [];
    return value
        .filter((entry) => Boolean(entry) && typeof entry === 'object')
        .map((entry) => ({
        method: String(entry.method ?? ''),
        amount: Number(entry.amount) || 0,
    }));
}
/**
 * Normalize the raw bill/order/business rows into authoritative PrintData.
 * This is the ONLY step allowed to touch raw rows; it resolves display tax
 * components (persisted snapshots/breakdowns — no recomputation of totals)
 * and parses stored JSON so builders stay pure.
 */
function buildBillPrintData(order, bill, business, isReprint) {
    const items = Array.isArray(order?.items) ? order.items : [];
    return {
        isReprint,
        order: {
            orderNumber: String(order?.order_number ?? ''),
            createdAt: String(order?.created_at ?? ''),
            tableName: String(order?.table?.name ?? ''),
            onlinePlatform: String(order?.online_platform ?? ''),
            externalOrderId: String(order?.external_order_id ?? ''),
            deliveryAddress: String(order?.type === 'delivery' ? order?.delivery_address ?? '' : ''),
            items: items.map((item) => ({
                productName: String(item?.product_name ?? ''),
                quantity: Number(item?.quantity) || 0,
                unitPrice: Number(item?.unit_price ?? item?.price ?? 0) || 0,
                total: Number(item?.total) || 0,
                addons: (Array.isArray(item?.addons) ? item.addons : []).map((addon) => {
                    const addonQuantity = (addon !== null && typeof addon === 'object' && 'quantity' in addon
                        && typeof addon.quantity === 'number' && addon.quantity) || 1;
                    return {
                        name: String(addon?.name ?? ''),
                        price: (Number(addon?.price) || 0) * addonQuantity * (Number(item?.quantity) || 0),
                        quantity: addonQuantity,
                    };
                }),
                specialInstructions: String(item?.special_instructions ?? ''),
            })),
        },
        bill: {
            billNumber: String(bill?.bill_number ?? ''),
            subtotal: Number(bill?.subtotal) || 0,
            discountAmount: Number(bill?.discount_amount) || 0,
            taxAmount: Number(bill?.tax_amount) || 0,
            total: Number(bill?.total) || 0,
            ...(Object.prototype.hasOwnProperty.call(bill || {}, 'service_charge')
                ? { serviceCharge: Number(bill?.service_charge) || 0 }
                : {}),
            deliveryCharge: Number(bill?.delivery_charge) || 0,
            packagingCharge: Number(bill?.packaging_charge) || 0,
            taxComponents: (0, tax_components_1.resolveTaxComponents)({ ...bill, items }),
            payments: parsePaymentDetails(bill?.payment_details),
            pointsEarned: Number(business?.points_earned) || 0,
            pointsRedeemed: Number(business?.points_redeemed) || 0,
            pointsBalance: business?.points_balance === null || business?.points_balance === undefined
                ? null
                : Number(business.points_balance) || 0,
        },
        business: {
            name: String(business?.name ?? ''),
            address: String(business?.address ?? ''),
            phone: String(business?.phone ?? ''),
            taxRegistrationNumber: String(business?.taxRegistrationNumber ?? ''),
            taxIdLabel: (0, countries_1.getCountryByCode)(String(business?.country ?? ''))?.taxIdLabel || '',
            instagramHandle: String(business?.instagram_handle ?? ''),
            footerNote: String(business?.footer_note ?? ''),
            customerName: String(business?.customer_name ?? ''),
            customerPhone: String(business?.customer_phone ?? ''),
            showName: business?.show_name !== false,
            showAddress: business?.show_address !== false,
            showPhone: business?.show_phone !== false,
            showTaxId: business?.show_tax_id === true ? 'force' : business?.show_tax_id === false ? 'never' : 'auto',
            showTaxBreakdown: business?.show_tax_breakdown === true,
            showTableNumber: business?.show_table_number !== false,
            showCustomerName: business?.show_customer_name !== false,
            showCustomerPhone: business?.show_customer_phone !== false,
        },
    };
}
/**
 * Build the PrintContext for a classic receipt: paper columns, resolved
 * languages, registry-derived direction, and locale-formatting prefs from
 * the existing regionalization helpers.
 */
function buildBillPrintContext(opts) {
    const lang = (0, thermal_1.normalizePrintLanguage)(opts.language);
    const languages = opts.additionalLanguage !== undefined
        && opts.additionalLanguage !== lang
        ? [lang, (0, thermal_1.normalizePrintLanguage)(opts.additionalLanguage)]
        : [lang];
    return {
        columns: opts.columns,
        languages,
        baseDirection: detectPrintLanguageDirection(lang),
        locale: (0, countries_1.getCountryByCode)(String(opts.business?.country ?? ''))?.locale ?? 'en-US',
        currencySymbol: String(opts.business?.currency_symbol || '₹'),
        trimDecimals: opts.business?.trim_decimals === true,
        ...(opts.business?.timezone ? { timezone: String(opts.business.timezone) } : {}),
        resolveLabel: (conceptId, language) => (0, print_labels_generated_1.printLabel)(language, conceptId),
    };
}
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
function classicItemHeader(block, nameLen, amtLen, language, capabilities) {
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
 * Map a PrintDocument onto the legacy classic token-line layout. Pure with
 * respect to business data: everything rendered comes from the document.
 */
function renderBillDocumentToClassicLines(document, options) {
    const cols = options.columns;
    const lines = [];
    const blocks = document.blocks;
    const breakdownIndex = blocks.findIndex((block) => block.kind === 'tax-breakdown');
    const totalsIndex = blocks.findIndex((block) => block.kind === 'totals');
    const prefix = (0, thermal_1.resolveCurrencyPrefix)(options.currencySymbol ?? '₹', options.useUnicode, options.capabilities);
    const fractionDigits = (0, countries_1.getCurrencyFractionDigits)(options.currency || 'INR');
    const trimDecimals = options.trimDecimals === true;
    const tzOptions = options.timezone ? { timeZone: options.timezone } : undefined;
    const dash = '-'.repeat(cols);
    const normalize = (text) => (0, thermal_1.normalizeThermalText)(text, options.capabilities);
    lines.push('{INIT}');
    const segments = new Map();
    const segmentOf = (kind) => {
        let segment = segments.get(kind);
        if (!segment) {
            segment = { pre: [], main: [], post: [] };
            segments.set(kind, segment);
        }
        return segment;
    };
    const renderGrandTotal = (block, target = segmentOf('totals')) => {
        target.main.push(...(0, thermal_1.financialRows)(labelOf(block.grandTotal.label), (0, thermal_1.formatCurrency)(block.grandTotal.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities).map((line) => `{BOLD}${line}{/BOLD}`));
    };
    const renderCharges = (block, target) => {
        if (block.serviceCharge) {
            target.main.push(...(0, thermal_1.financialRows)(labelOf(block.serviceCharge.label), (0, thermal_1.formatCurrency)(block.serviceCharge.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
        }
        if (block.deliveryCharge) {
            target.main.push(...(0, thermal_1.financialRows)(labelOf(block.deliveryCharge.label), (0, thermal_1.formatCurrency)(block.deliveryCharge.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
        }
        if (block.packagingCharge) {
            target.main.push(...(0, thermal_1.financialRows)(labelOf(block.packagingCharge.label), (0, thermal_1.formatCurrency)(block.packagingCharge.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
        }
    };
    for (const block of blocks) {
        switch (block.kind) {
            case 'business-header': {
                const segment = segmentOf('business-header');
                if (block.name)
                    segment.main.push('{STORE_NAME}{CENTER}{BOLD}{DOUBLE_HEIGHT}{DOUBLE_WIDTH}' + (0, thermal_1.truncateShapedLine)(block.name.text, Math.floor(cols / 2), options.arabicShaping, options.language, options.capabilities) + '{/DOUBLE_WIDTH}{/DOUBLE_HEIGHT}{/BOLD}{/CENTER}');
                // Contact/tax facts are header-owned content; they travel with
                // the header block's position in reordered compositions.
                const footerLines = [];
                if (block.address)
                    footerLines.push(block.address.text);
                if (block.phone && block.phoneLabel)
                    footerLines.push(normalize(labelOf(block.phoneLabel) + ': ' + block.phone.text));
                if (block.taxId)
                    footerLines.push(normalize(labelOf(block.taxId.label) + ': ' + block.taxId.value.text));
                if (block.instagramHandle)
                    footerLines.push(block.instagramHandle.text);
                if (footerLines.length > 0) {
                    segment.post.push(dash);
                    for (const footerLine of footerLines)
                        (0, thermal_1.pushCenteredWrapped)(segment.post, footerLine, cols, options.language, options.capabilities);
                }
                break;
            }
            case 'customer': {
                const segment = segmentOf('customer');
                if (block.name)
                    segment.main.push('{CENTER}{FONT_B}' + (0, thermal_1.truncateShapedLine)(block.name.text, cols, options.arabicShaping, options.language, options.capabilities) + '{/FONT_B}{/CENTER}');
                if (block.phone)
                    segment.main.push('{CENTER}' + block.phone.text + '{/CENTER}');
                if (block.address)
                    (0, thermal_1.pushCenteredWrapped)(segment.main, block.address.text, cols, options.language, options.capabilities);
                break;
            }
            case 'document-meta': {
                const segment = segmentOf('document-meta');
                segment.main.push(dash);
                const defaultTitle = block.title.conceptId === 'print.taxInvoiceTitle'
                    ? (0, print_labels_generated_1.printLabel)(options.language, 'print.taxInvoiceTitle')
                    : (0, print_labels_generated_1.printLabel)(options.language, 'print.invoiceTitle');
                if (labelOf(block.title) !== defaultTitle)
                    segment.main.push('{CENTER}' + normalize(labelOf(block.title)) + '{/CENTER}');
                segment.main.push('{CENTER}' + normalize(labelOf(block.invoiceNumberLabel) + ' ' + block.invoiceNumber.text) + '{/CENTER}');
                const date = (0, db_1.parseDbTimestamp)(block.timestamp.text);
                segment.main.push('{CENTER}' + date.toLocaleDateString(options.locale + '-u-nu-latn', tzOptions) + ' ' + date.toLocaleTimeString(options.locale + '-u-nu-latn', tzOptions) + '{/CENTER}');
                if (block.table) {
                    segment.main.push('{CENTER}' + (0, thermal_1.truncateShapedLine)(block.table.label.primary.replace('{name}', block.table.name.text), cols, options.arabicShaping, options.language, options.capabilities) + '{/CENTER}');
                }
                segment.main.push(dash);
                break;
            }
            case 'item-table': {
                const segment = segmentOf('item-table');
                const amtLen = (0, thermal_1.itemAmountWidth)({ items: block.rows.map((row) => ({ total: row.amount, addons: row.addons.map((addon) => ({ price: addon.price })) })) }, prefix, options.locale, trimDecimals, cols, fractionDigits);
                const nameLen = (0, thermal_1.itemNameWidth)(cols, amtLen);
                segment.main.push(classicItemHeader(block, nameLen, amtLen, options.language, options.capabilities));
                segment.main.push(dash);
                for (const row of block.rows) {
                    segment.main.push(...(0, thermal_1.itemRows)({ product_name: row.name.text, quantity: row.quantity, total: row.amount }, nameLen, amtLen, cols, prefix, options.locale, trimDecimals, options.language, fractionDigits, options.capabilities));
                    for (const addon of row.addons) {
                        segment.main.push(...(0, thermal_1.addonRows)({ name: addon.name.text, price: addon.price, quantity: addon.quantity }, nameLen, amtLen, cols, prefix, options.locale, trimDecimals, options.language, fractionDigits, options.capabilities));
                    }
                    if (row.specialInstructions) {
                        segment.main.push(normalize('  ' + labelOf(block.noteLabel) + ': ' + (0, thermal_1.truncate)(row.specialInstructions.text, cols - 8, options.language, options.capabilities)));
                    }
                }
                segment.main.push(dash);
                break;
            }
            case 'tax-breakdown': {
                const segment = segmentOf('tax-breakdown');
                for (const line of block.lines) {
                    const rateSuffix = line.rate === null ? '' : ` @${line.rate}%`;
                    const label = (0, thermal_1.truncate)(labelOf(line.label) + rateSuffix, cols - 12, options.language, options.capabilities);
                    segment.main.push(...(0, thermal_1.financialRows)(label, (0, thermal_1.formatCurrency)(line.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
                }
                // Explicit canonical tax/totals parity handling: when the
                // breakdown FOLLOWS the totals block (non-canonical order), the
                // bold grand total closes the breakdown segment instead.
                if (block.lines.length > 0
                    && totalsIndex >= 0
                    && breakdownIndex > totalsIndex) {
                    const totalsBlock = blocks[totalsIndex];
                    renderCharges(totalsBlock, segment);
                    renderGrandTotal(totalsBlock, segment);
                }
                break;
            }
            case 'totals': {
                const segment = segmentOf('totals');
                if (block.pointsRedeemed) {
                    const label = labelOf(block.pointsRedeemed.label);
                    segment.main.push(...(0, thermal_1.financialRows)(label, '-' + block.pointsRedeemed.points + ' pts', cols, options.language, options.capabilities));
                }
                segment.main.push(...(0, thermal_1.financialRows)(labelOf(block.subtotal.label), (0, thermal_1.formatCurrency)(block.subtotal.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
                if (block.discount) {
                    segment.main.push(...(0, thermal_1.financialRows)(labelOf(block.discount.label), '-' + (0, thermal_1.formatCurrency)(block.discount.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
                }
                const hasBreakdownLines = blocks.some((candidate) => candidate.kind === 'tax-breakdown'
                    && candidate.lines.length > 0);
                if (!hasBreakdownLines && block.tax) {
                    segment.main.push(...(0, thermal_1.financialRows)(labelOf(block.tax.label), (0, thermal_1.formatCurrency)(block.tax.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
                }
                if (!hasBreakdownLines || breakdownIndex < totalsIndex) {
                    renderCharges(block, segment);
                }
                if (!hasBreakdownLines) {
                    renderGrandTotal(block);
                }
                else if (breakdownIndex < totalsIndex) {
                    renderGrandTotal(block);
                }
                // Loyalty earned/balance is totals-owned content.
                if (block.pointsEarned || block.pointsBalance) {
                    segment.post.push(dash);
                    if (block.pointsEarned) {
                        const label = labelOf(block.pointsEarned.label);
                        segment.post.push(...(0, thermal_1.financialRows)(label, String(block.pointsEarned.points), cols, options.language, options.capabilities));
                    }
                    if (block.pointsBalance) {
                        const label = labelOf(block.pointsBalance.label);
                        segment.post.push(...(0, thermal_1.financialRows)(label, String(block.pointsBalance.points), cols, options.language, options.capabilities));
                    }
                }
                break;
            }
            case 'payments': {
                const segment = segmentOf('payments');
                for (const line of block.lines) {
                    const methodLabel = (0, thermal_1.truncate)(paymentLabel(line.label), cols - 12, options.language, options.capabilities);
                    segment.main.push(...(0, thermal_1.financialRows)(methodLabel, (0, thermal_1.formatCurrency)(line.amount, prefix, options.locale, trimDecimals, fractionDigits), cols, options.language, options.capabilities));
                }
                break;
            }
            case 'message': {
                const segment = segmentOf('message');
                if (block.reprintBanner) {
                    segment.pre.push('{CENTER}{BOLD}{DOUBLE_HEIGHT}{DOUBLE_WIDTH}** ' + normalize(labelOf(block.reprintBanner)) + ' **{/DOUBLE_WIDTH}{/DOUBLE_HEIGHT}{/BOLD}{/CENTER}');
                }
                if (block.onlineOrderBanner) {
                    const banner = block.onlineOrderBanner;
                    segment.pre.push('{CENTER}{BOLD}{DOUBLE_HEIGHT}{DOUBLE_WIDTH}** ' + normalize(labelOf(banner.label)) + ' **{/DOUBLE_WIDTH}{/DOUBLE_HEIGHT}{/BOLD}{/CENTER}');
                    if (banner.platform.text)
                        segment.pre.push('{CENTER}' + normalize(banner.platform.text) + '{/CENTER}');
                    if (banner.externalOrderId.text)
                        segment.pre.push('{CENTER}#' + normalize(banner.externalOrderId.text) + '{/CENTER}');
                }
                if (block.thankYou && labelOf(block.thankYou) !== (0, print_labels_generated_1.printLabel)(options.language, 'print.thankYouShort')) {
                    segment.main.push('{CENTER}' + normalize(labelOf(block.thankYou)) + '{/CENTER}');
                }
                if (block.footerNote)
                    (0, thermal_1.pushCenteredWrapped)(segment.post, block.footerNote.text, cols, options.language, options.capabilities);
                break;
            }
        }
    }
    // Assemble. Documents whose selected blocks appear in the canonical
    // relative order use the pinned legacy segment arrangement (byte parity
    // with the oracle); reordered compositions concatenate each block's
    // full segment group strictly in template order.
    // Canonical block sequence of PrintDocument v1 (mirrors buildBillDocument;
    // asserted in tests/print-document.test.ts).
    const CANONICAL_LAYOUT = [
        'business-header',
        'customer',
        'document-meta',
        'item-table',
        'totals',
        'tax-breakdown',
        'payments',
        'message',
    ];
    const canonicalRank = new Map(CANONICAL_LAYOUT.map((kind, index) => [kind, index]));
    let lastRank = -1;
    const isCanonicalRelativeOrder = blocks.every((block) => {
        const rank = canonicalRank.get(block.kind);
        if (rank === undefined || rank <= lastRank)
            return false;
        lastRank = rank;
        return true;
    });
    const emit = (kind, part) => {
        const segment = segments.get(kind);
        if (segment)
            lines.push(...segment[part]);
    };
    if (isCanonicalRelativeOrder) {
        // Pinned legacy arrangement (canonical parity contract). With the
        // canonical totals-before-breakdown sequence, the bold grand total
        // closes the breakdown segment (see the totals/breakdown cases).
        emit('message', 'pre');
        emit('business-header', 'main');
        emit('customer', 'main');
        emit('document-meta', 'main');
        emit('item-table', 'main');
        emit('totals', 'main');
        emit('tax-breakdown', 'main');
        emit('payments', 'main');
        emit('message', 'main');
        emit('totals', 'post');
        emit('business-header', 'post');
        emit('message', 'post');
    }
    else {
        // Strict template order: each block's complete content at its own
        // position — nothing moves across merchant-selected positions.
        for (const block of blocks) {
            const segment = segments.get(block.kind);
            if (!segment)
                continue;
            lines.push(...segment.pre, ...segment.main, ...segment.post);
        }
    }
    (0, thermal_1.appendPoweredByFooter)(lines);
    lines.push('{CUT}');
    return lines;
}
/**
 * Full document-driven classic preview pipeline:
 * authoritative rows → PrintData/PrintContext → buildBillDocument →
 * classic token lines → buildEscPos. Used by the print-bill preview branch;
 * actual printing keeps the legacy path this issue.
 */
function renderClassicReceiptViaDocument(order, bill, business, opts) {
    const printData = buildBillPrintData(order, bill, business, opts.isReprint);
    const printContext = buildBillPrintContext({
        columns: opts.columns,
        language: opts.language,
        ...(opts.additionalLanguage !== undefined ? { additionalLanguage: opts.additionalLanguage } : {}),
        business,
    });
    const document = (0, print_1.buildBillDocument)(printData, printContext);
    const warnings = [];
    const lines = renderBillDocumentToClassicLines(document, {
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
//# sourceMappingURL=document-classic.js.map