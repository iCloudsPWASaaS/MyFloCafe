"use strict";
/**
 * Renderer-independent PrintDocument v1 (#442, epic #438).
 *
 * A PrintDocument is the authoritative SEMANTIC representation of a printed
 * receipt: an ordered list of blocks (business header, document meta,
 * customer, item table, tax breakdown, totals, payments, messages). It is
 * produced by pure builders from caller-supplied normalized snapshots and
 * consumed by renderers that choose physical layout (ESC/POS token lines,
 * HTML, …). No transport APIs and no byte tokens (`{CENTER}` etc.) exist in
 * this model.
 *
 * PURITY RULES (same contract as the rest of `shared/print/`, see README.md):
 *   - Types + pure functions only. No Electron, DOM, Node built-ins, DB,
 *     filesystem, network, or transport IO of any kind.
 *   - Builders perform NO database IO and NO financial recomputation. Tax
 *     components, totals and payment amounts arrive as printed truth inside
 *     {@link PrintData}; builders only apply presence/show decisions.
 *   - Labels are carried as concept references plus already-resolved strings
 *     (resolved through the injected {@link PrintContext.resolveLabel}
 *     catalog lookup) or explicit bilingual pairs — never pre-concatenated
 *     `"A / B"` strings.
 *   - Every block carries its resolved base direction; embedded values are
 *     annotated via the direction kernel so LTR islands (invoice numbers,
 *     phone numbers, amounts) stay distinguishable inside RTL documents.
 *
 * First consumer: the classic thermal receipt rendered through the backend
 * preview pipeline (#442). Merchant template schemas (#447/#448) and other
 * renderers adopt this model in later issues; schema documentation is owned
 * by #449.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bilingualLabel = bilingualLabel;
exports.directionalText = directionalText;
exports.getBlock = getBlock;
exports.buildBillDocument = buildBillDocument;
exports.isKotItemPending = isKotItemPending;
exports.buildKotDocument = buildKotDocument;
const direction_1 = require("./direction");
/** Build a {@link SemanticLabel} from an explicit bilingual pair. */
function bilingualLabel(text, conceptId) {
    return Object.freeze({
        ...(conceptId !== undefined ? { conceptId } : {}),
        ...(text.secondary !== undefined ? { secondary: text.secondary } : {}),
        primary: text.primary,
    });
}
/** Annotate `text` with its value-scope direction for a document base direction. */
function directionalText(text, base) {
    return Object.freeze({ text, direction: (0, direction_1.resolveValueDirection)(text, base) });
}
/** Typed accessor for one block kind within a document. */
function getBlock(document, kind) {
    return document.blocks.find((block) => block.kind === kind);
}
/** Concept ids for known payment methods; unknown methods stay literal. */
const PAYMENT_METHOD_CONCEPTS = Object.freeze({
    cash: 'pos.methodCash',
    card: 'pos.methodCard',
    wallet: 'pos.methodWallet',
});
const KOT_ORDER_TYPE_CONCEPTS = Object.freeze({
    dine_in: 'pos.orderTypeDineIn',
    delivery: 'pos.orderTypeDelivery',
    online: 'pos.orderTypeOnline',
    takeaway: 'pos.orderTypeTakeaway',
});
function resolveSemanticLabel(labels, conceptId) {
    return Object.freeze({
        conceptId,
        primary: labels.ctx.resolveLabel(conceptId, labels.primary),
        ...(labels.secondary !== undefined
            ? { secondary: labels.ctx.resolveLabel(conceptId, labels.secondary) }
            : {}),
    });
}
function literalLabel(primary) {
    return Object.freeze({ primary });
}
function paymentLabel(labels, method) {
    const conceptId = PAYMENT_METHOD_CONCEPTS[method.toLowerCase()];
    return conceptId !== undefined ? resolveSemanticLabel(labels, conceptId) : literalLabel(method);
}
function kotOrderTypeValue(labels, value) {
    const conceptId = KOT_ORDER_TYPE_CONCEPTS[value];
    if (conceptId === undefined)
        return value.replace(/_/g, ' ').trim().toUpperCase();
    return resolveSemanticLabel(labels, conceptId).primary;
}
function optionalDirectional(text, base) {
    if (text === undefined || text === null || String(text).length === 0)
        return null;
    return directionalText(String(text), base);
}
function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
/**
 * Build a PrintDocument v1 from normalized print data. Pure: reads only its
 * arguments; performs no IO and no financial recomputation (totals, taxes
 * and payments are copied verbatim from `printData.bill`).
 */
function buildBillDocument(printData, printContext) {
    const { bill, order, business } = printData;
    const base = printContext.baseDirection;
    const labels = {
        ctx: printContext,
        primary: printContext.languages[0],
        ...(printContext.languages.length > 1 ? { secondary: printContext.languages[1] } : {}),
    };
    const taxComponents = bill.taxComponents.filter((component) => toFiniteNumber(component.amount) !== 0);
    const hasTax = toFiniteNumber(bill.taxAmount) !== 0 || taxComponents.length > 0;
    const showBreakdown = business.showTaxBreakdown && taxComponents.length > 0;
    const showTaxIdLine = business.taxRegistrationNumber.length > 0
        && (business.showTaxId === 'force'
            || (business.showTaxId === 'auto' && hasTax));
    const header = Object.freeze({
        kind: 'business-header',
        direction: base,
        name: business.showName ? optionalDirectional(business.name, base) : null,
        address: business.showAddress ? optionalDirectional(business.address, base) : null,
        phone: business.showPhone ? optionalDirectional(business.phone, base) : null,
        instagramHandle: optionalDirectional(business.instagramHandle, base),
        taxId: showTaxIdLine
            ? Object.freeze({
                label: literalLabel(business.taxIdLabel.length > 0 ? business.taxIdLabel : 'Tax ID'),
                value: directionalText(business.taxRegistrationNumber, base),
            })
            : null,
        phoneLabel: business.showPhone && business.phone.length > 0
            ? resolveSemanticLabel(labels, 'receipt.phone')
            : null,
    });
    const meta = Object.freeze({
        kind: 'document-meta',
        direction: base,
        title: resolveSemanticLabel(labels, hasTax ? 'print.taxInvoiceTitle' : 'print.invoiceTitle'),
        invoiceNumberLabel: resolveSemanticLabel(labels, 'print.invoiceNumber'),
        billNumberLabel: resolveSemanticLabel(labels, 'receipt.billNumber'),
        dateLabel: resolveSemanticLabel(labels, 'receipt.date'),
        invoiceNumber: directionalText(bill.billNumber.length > 0 ? bill.billNumber : order.orderNumber, base),
        timestamp: directionalText(order.createdAt, base),
        table: business.showTableNumber && order.tableName.length > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.tableLabel'),
                name: directionalText(order.tableName, base),
            })
            : null,
    });
    const customer = Object.freeze({
        kind: 'customer',
        direction: base,
        name: business.showCustomerName ? optionalDirectional(business.customerName, base) : null,
        phone: business.showCustomerPhone ? optionalDirectional(business.customerPhone, base) : null,
        address: optionalDirectional(order.deliveryAddress, base),
        nameLabel: resolveSemanticLabel(labels, 'pos.customer'),
        phoneLabel: resolveSemanticLabel(labels, 'print.numberShort'),
    });
    const items = Object.freeze({
        kind: 'item-table',
        direction: base,
        header: Object.freeze({
            item: resolveSemanticLabel(labels, 'receipt.item'),
            quantity: resolveSemanticLabel(labels, 'receipt.qty'),
            amount: resolveSemanticLabel(labels, 'receipt.amount'),
        }),
        noteLabel: resolveSemanticLabel(labels, 'print.note'),
        rows: Object.freeze(order.items.map((item) => Object.freeze({
            direction: base,
            name: directionalText(item.productName, base),
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.total,
            addons: Object.freeze(item.addons.map((addon) => Object.freeze({
                name: directionalText(addon.name, base),
                price: addon.price,
                quantity: addon.quantity,
            }))),
            specialInstructions: optionalDirectional(item.specialInstructions, base),
        }))),
    });
    const breakdown = Object.freeze({
        kind: 'tax-breakdown',
        direction: base,
        lines: Object.freeze((showBreakdown ? taxComponents : []).map((component) => Object.freeze({
            label: literalLabel(component.title),
            rate: component.rate,
            amount: component.amount,
        }))),
    });
    const totals = Object.freeze({
        kind: 'totals',
        direction: base,
        subtotal: Object.freeze({
            label: resolveSemanticLabel(labels, 'pos.subtotal'),
            amount: bill.subtotal,
        }),
        discount: bill.discountAmount > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.discount'),
                amount: bill.discountAmount,
            })
            : null,
        tax: !showBreakdown && toFiniteNumber(bill.taxAmount) !== 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.tax'),
                amount: bill.taxAmount,
            })
            : null,
        serviceCharge: toFiniteNumber(bill.serviceCharge) !== 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'receipt.serviceCharge'),
                amount: toFiniteNumber(bill.serviceCharge),
            })
            : null,
        deliveryCharge: toFiniteNumber(bill.deliveryCharge) !== 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.delivery'),
                amount: toFiniteNumber(bill.deliveryCharge),
            })
            : null,
        packagingCharge: toFiniteNumber(bill.packagingCharge) !== 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.packaging'),
                amount: toFiniteNumber(bill.packagingCharge),
            })
            : null,
        grandTotal: Object.freeze({
            label: resolveSemanticLabel(labels, 'print.grandTotal'),
            amount: bill.total,
        }),
        pointsRedeemed: bill.pointsRedeemed > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'print.pointsRedeemed'),
                points: bill.pointsRedeemed,
            })
            : null,
        pointsEarned: bill.pointsEarned > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'print.pointsEarned'),
                points: bill.pointsEarned,
            })
            : null,
        pointsBalance: bill.pointsBalance !== null && bill.pointsBalance !== 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'print.pointsBalance'),
                points: bill.pointsBalance,
            })
            : null,
    });
    const payments = Object.freeze({
        kind: 'payments',
        direction: base,
        lines: Object.freeze(bill.payments
            .filter((payment) => payment.method.length > 0)
            .map((payment) => Object.freeze({
            method: payment.method,
            label: paymentLabel(labels, payment.method),
            amount: payment.amount,
        }))),
    });
    const hasOnlineOrderInfo = order.onlinePlatform.length > 0 || order.externalOrderId.length > 0;
    const messages = Object.freeze({
        kind: 'message',
        direction: base,
        reprintBanner: printData.isReprint ? resolveSemanticLabel(labels, 'receipt.reprint') : null,
        onlineOrderBanner: hasOnlineOrderInfo
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'receipt.onlineOrder'),
                platform: directionalText(order.onlinePlatform, base),
                externalOrderId: directionalText(order.externalOrderId, base),
            })
            : null,
        footerNote: business.footerNote.length > 0 ? directionalText(business.footerNote, base) : null,
        thankYou: resolveSemanticLabel(labels, 'print.thankYouShort'),
    });
    return Object.freeze({
        version: 1,
        direction: (0, direction_1.resolveDirectionSpec)(base),
        languages: printContext.languages,
        blocks: Object.freeze([
            header,
            customer,
            meta,
            items,
            totals,
            breakdown,
            payments,
            messages,
        ]),
    });
}
// ---------------------------------------------------------------------------
// KOT document variant (kitchen order ticket) — #443
// ---------------------------------------------------------------------------
/** Whether an order item belongs on a new kitchen ticket. */
function isKotItemPending(status) {
    return status !== 'served' && status !== 'ready';
}
/**
 * Build a KotDocument v1 from normalized kitchen-ticket data. Pure: reads
 * only its arguments and performs no IO or recomputation.
 */
function buildKotDocument(printData, printContext) {
    const base = printContext.baseDirection;
    const primary = printContext.languages[0];
    const labels = { ctx: printContext, primary };
    const header = Object.freeze({
        kind: 'kot-header',
        direction: base,
        banner: resolveSemanticLabel(labels, 'print.kot.banner'),
        stationLabel: resolveSemanticLabel(labels, 'print.kot.station'),
        stationName: directionalText(String(printData.stationName ?? ''), base),
        orderNumberLabel: resolveSemanticLabel(labels, 'pos.orderNumber'),
        orderNumber: directionalText(String(printData.order?.orderNumber ?? ''), base),
        table: typeof printData.order?.tableName === 'string' && printData.order.tableName.length > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.tableLabel'),
                name: directionalText(printData.order.tableName, base),
            })
            : null,
        orderType: typeof printData.order?.orderType === 'string' && printData.order.orderType.length > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'print.kot.type'),
                value: directionalText(kotOrderTypeValue(labels, printData.order.orderType), base),
                code: printData.order.orderType,
            })
            : null,
        customer: typeof printData.order?.customerName === 'string' && printData.order.customerName.length > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.customer'),
                name: directionalText(printData.order.customerName, base),
            })
            : null,
        timeLabel: resolveSemanticLabel(labels, 'print.time'),
        timestamp: directionalText(String(printData.order?.createdAt ?? ''), base),
    });
    const items = Object.freeze({
        kind: 'kot-items',
        direction: base,
        rows: Object.freeze((Array.isArray(printData.items) ? printData.items : []).map((item) => Object.freeze({
            quantity: Number(item?.quantity) || 0,
            name: directionalText(String(item?.productName ?? ''), base),
            addons: Object.freeze((item?.addons ?? new Array())
                .filter((addon) => typeof addon?.name === 'string' && addon.name.length > 0)
                .map((addon) => Object.freeze({
                ...directionalText(String(addon.name), base),
                ...(typeof addon.quantity === 'number' && Number.isFinite(addon.quantity) && addon.quantity > 0
                    ? { quantity: addon.quantity }
                    : {}),
            }))),
            specialInstructions: optionalDirectional(item?.specialInstructions, base),
        }))),
    });
    return Object.freeze({
        version: 1,
        direction: (0, direction_1.resolveDirectionSpec)(base),
        languages: printContext.languages,
        blocks: Object.freeze([header, items]),
    });
}
//# sourceMappingURL=document.js.map