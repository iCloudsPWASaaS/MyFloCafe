"use strict";
/**
 * PrintDocument v1 → kitchen order ticket renderer (#443, epic #438).
 *
 * Maps a `buildKotDocument` KOT document onto the shared ESC/POS token-line
 * layout, so kitchen tickets flow through `data → document → lines → bytes`.
 *
 * Layering: this module lives in `main/` (transport token syntax + generated
 * label catalog); all SEMANTICS come from the document — no order row is
 * read here beyond the caller's normalization step. The KOT language policy
 * is single-primary (kernel `kot_language_policy`) and is resolved by the
 * caller before reaching this renderer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildKotPrintData = buildKotPrintData;
exports.buildKotPrintContext = buildKotPrintContext;
exports.renderKotDocumentToLines = renderKotDocumentToLines;
exports.renderKotViaDocument = renderKotViaDocument;
const db_1 = require("../db");
const print_labels_generated_1 = require("../print/print-labels.generated");
const thermal_1 = require("./thermal");
const thermal_capabilities_1 = require("../../shared/print/thermal-capabilities");
const document_classic_1 = require("./document-classic");
const print_1 = require("../../shared/print");
// ---------------------------------------------------------------------------
// Normalization (caller-side, main-process layer)
// ---------------------------------------------------------------------------
/**
 * Normalize raw order/items/station rows into an authoritative KOT snapshot.
 * This is the ONLY step allowed to touch raw rows so the builder stays pure.
 */
function buildKotPrintData(order, items, stationName) {
    const ticketItems = Array.isArray(items)
        ? items.filter((item) => (0, print_1.isKotItemPending)(item?.status))
        : [];
    return {
        stationName: String(stationName ?? ''),
        order: {
            orderNumber: String(order?.order_number ?? ''),
            createdAt: String(order?.created_at ?? ''),
            tableName: String(order?.table?.name ?? ''),
            orderType: String(order?.type ?? '').trim(),
            customerName: String(order?.customer?.name ?? order?.customer_name ?? '').trim(),
        },
        items: ticketItems.map((item) => ({
            productName: String(item?.product_name ?? ''),
            quantity: Number(item?.quantity) || 0,
            addons: (Array.isArray(item?.addons) ? item.addons : []).map((addon) => ({
                name: String(addon?.name ?? ''),
                ...(typeof addon?.quantity === 'number' && Number.isFinite(addon.quantity) && addon.quantity > 0
                    ? { quantity: addon.quantity }
                    : {}),
            })),
            specialInstructions: String(item?.special_instructions ?? ''),
        })),
    };
}
/**
 * Build the PrintContext for a kitchen ticket. The language arrives already
 * resolved from `kot_language_policy` through the kernel by the caller.
 */
function buildKotPrintContext(opts) {
    return {
        columns: opts.columns,
        languages: [opts.language],
        baseDirection: (0, document_classic_1.detectPrintLanguageDirection)(opts.language),
        locale: 'en-US',
        currencySymbol: '',
        trimDecimals: false,
        ...(opts.timezone !== undefined ? { timezone: opts.timezone } : {}),
        resolveLabel: (conceptId, language) => (0, print_labels_generated_1.printLabel)(language, conceptId),
    };
}
/** Typed accessor for one block kind within a KOT document. */
function kotBlock(document, kind) {
    return document.blocks.find((block) => block.kind === kind);
}
function labelOf(label) {
    return label.primary;
}
/** Interpolate the ICU {name} placeholder of pos.tableLabel inline (#440). */
function formatTableLabel(label, tableName) {
    return labelOf(label).replace('{name}', tableName);
}
// Header metadata must stay visible on generic ESC/POS. Keep the localized
// value when the selected capability can represent it; otherwise use the
// existing ASCII labels rather than silently losing ticket identity.
const UNSUPPORTED_METADATA_PLACEHOLDER = '[UNSUPPORTED]';
function thermalSafeText(value, fallback, language, arabicShaping, capabilities) {
    return (0, thermal_capabilities_1.thermalTextFallback)(value, fallback, (0, thermal_capabilities_1.mergeThermalCapabilities)(capabilities ?? thermal_capabilities_1.GENERIC_THERMAL_CAPABILITIES, arabicShaping));
}
function thermalSafeMetadataValue(value, language, arabicShaping, capabilities) {
    return thermalSafeText(value, UNSUPPORTED_METADATA_PLACEHOLDER, language, arabicShaping, capabilities);
}
function formatOrderNumberLabel(label, orderNumber, language, arabicShaping, capabilities) {
    const localized = labelOf(label).replace('{number}', orderNumber);
    const fallbackOrderNumber = thermalSafeMetadataValue(orderNumber, language, arabicShaping, capabilities);
    return thermalSafeText(localized, `Order #${fallbackOrderNumber}`, language, arabicShaping, capabilities);
}
function kotHeaderLines(header, options) {
    const cols = options.columns;
    const lines = [];
    const tzOptions = options.timezone ? { timeZone: options.timezone } : undefined;
    const thermalCapabilities = (0, thermal_capabilities_1.mergeThermalCapabilities)(options.capabilities, options.arabicShaping);
    lines.push('{INIT}');
    const banner = thermalSafeText(labelOf(header.banner), 'KITCHEN ORDER TICKET', options.language, options.arabicShaping, options.capabilities);
    const station = thermalSafeText(`${labelOf(header.stationLabel)}: ${header.stationName.text}`, `Station: ${thermalSafeMetadataValue(header.stationName.text, options.language, options.arabicShaping, options.capabilities)}`, options.language, options.arabicShaping, options.capabilities);
    const table = header.table
        ? thermalSafeText(formatTableLabel(header.table.label, header.table.name.text), `Table: ${thermalSafeMetadataValue(header.table.name.text, options.language, options.arabicShaping, options.capabilities)}`, options.language, options.arabicShaping, options.capabilities)
        : null;
    const orderType = header.orderType
        ? (() => {
            const localized = `${labelOf(header.orderType.label)}: ${header.orderType.value.text}`;
            const fallback = `Type: ${header.orderType.code.replace(/_/g, ' ').trim().toUpperCase()}`;
            return (0, thermal_capabilities_1.shouldUseOrderTypeFallback)(localized, thermalCapabilities)
                ? fallback
                : thermalSafeText(localized, fallback, options.language, options.arabicShaping, options.capabilities);
        })()
        : null;
    const time = (0, db_1.parseDbTimestamp)(header.timestamp.text).toLocaleTimeString((options.locale ?? 'en-US') + '-u-nu-latn', tzOptions);
    const timeLine = thermalSafeText(`${labelOf(header.timeLabel)}: ${time}`, `Time: ${(0, db_1.parseDbTimestamp)(header.timestamp.text).toLocaleTimeString('en-US-u-nu-latn', tzOptions)}`, options.language, options.arabicShaping, options.capabilities);
    lines.push('{CENTER}{BOLD}' + (0, thermal_1.truncateShapedLine)(banner, cols, options.arabicShaping, options.language, options.capabilities) + '{/BOLD}{/CENTER}');
    lines.push('');
    lines.push((0, thermal_1.truncateShapedLine)(station, cols, options.arabicShaping, options.language, options.capabilities));
    lines.push((0, thermal_1.truncateShapedLine)(formatOrderNumberLabel(header.orderNumberLabel, header.orderNumber.text, options.language, options.arabicShaping, options.capabilities), cols, options.arabicShaping, options.language, options.capabilities));
    if (table)
        lines.push((0, thermal_1.truncateShapedLine)(table, cols, options.arabicShaping, options.language, options.capabilities));
    if (orderType)
        lines.push((0, thermal_1.truncateShapedLine)(orderType, cols, options.arabicShaping, options.language, options.capabilities));
    if (header.customer) {
        const customer = thermalSafeText(`${labelOf(header.customer.label)}: ${header.customer.name.text}`, `Customer: ${thermalSafeMetadataValue(header.customer.name.text, options.language, options.arabicShaping, options.capabilities)}`, options.language, options.arabicShaping, options.capabilities);
        lines.push((0, thermal_1.truncateShapedLine)(customer, cols, options.arabicShaping, options.language, options.capabilities));
    }
    lines.push((0, thermal_1.truncateShapedLine)(timeLine, cols, options.arabicShaping, options.language, options.capabilities));
    return lines;
}
function kotItemLines(row, cols, arabicShaping, language, capabilities) {
    const lines = [];
    const itemPrefix = row.quantity + 'x  ';
    lines.push('{DOUBLE_HEIGHT}{BOLD}' + itemPrefix + (0, thermal_1.truncateShapedLine)(row.name.text, Math.max(1, cols - itemPrefix.length), arabicShaping, language, capabilities) + '{/BOLD}{/DOUBLE_HEIGHT}');
    for (const addon of row.addons) {
        const quantity = addon.quantity ?? 1;
        const quantitySuffix = quantity > 1 ? ` x${quantity}` : '';
        const name = (0, thermal_1.truncate)(addonName(addon), Math.max(1, cols - 4 - quantitySuffix.length), language, capabilities);
        lines.push('  + ' + name + quantitySuffix);
    }
    if (row.specialInstructions) {
        lines.push('  >> ' + (0, thermal_1.truncateShapedLine)(row.specialInstructions.text, Math.max(1, cols - 8), arabicShaping, language, capabilities));
    }
    return lines;
}
function addonName(addon) {
    return addon.text;
}
/**
 * Map a KotDocument onto the legacy KOT token-line layout. Pure with
 * respect to business data: everything rendered comes from the document.
 */
function renderKotDocumentToLines(document, options) {
    const lines = [];
    const header = kotBlock(document, 'kot-header');
    const items = kotBlock(document, 'kot-items');
    const cols = options.columns;
    const bar = '='.repeat(cols);
    if (header)
        lines.push(...kotHeaderLines(header, options));
    lines.push(bar);
    lines.push('');
    if (items) {
        for (const row of items.rows) {
            lines.push(...kotItemLines(row, cols, options.arabicShaping, options.language, options.capabilities));
        }
    }
    lines.push('');
    lines.push(bar);
    lines.push('{CUT}');
    return lines;
}
/**
 * Full document-driven KOT pipeline: authoritative rows → KotPrintData /
 * PrintContext → buildKotDocument → KOT token lines → buildEscPos.
 */
function renderKotViaDocument(order, items, stationName, opts) {
    const printData = buildKotPrintData(order, items, stationName);
    const printContext = buildKotPrintContext({
        columns: opts.columns,
        language: opts.language,
        ...(opts.timezone !== undefined ? { timezone: opts.timezone } : {}),
    });
    const document = (0, print_1.buildKotDocument)(printData, printContext);
    const warnings = [];
    const lines = renderKotDocumentToLines(document, {
        columns: opts.columns,
        language: opts.language,
        ...(opts.locale !== undefined ? { locale: opts.locale } : {}),
        ...(printContext.timezone !== undefined ? { timezone: printContext.timezone } : {}),
        useUnicode: opts.useUnicode,
        arabicShaping: opts.arabicShaping,
        cutMode: opts.cutMode,
        capabilities: opts.capabilities,
    });
    const data = (0, thermal_1.buildEscPos)(lines, opts.useUnicode, { cutMode: opts.cutMode, arabicShaping: opts.arabicShaping, columns: opts.columns, language: opts.language, capabilities: opts.capabilities }, warnings);
    return { document, lines, data, warnings };
}
//# sourceMappingURL=document-kot.js.map