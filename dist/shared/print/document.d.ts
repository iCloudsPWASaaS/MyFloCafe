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
import type { BilingualLabel } from './bilingual';
import type { DirectionSpec } from './direction';
import type { PrintLanguageCode, ResolvedPrintLanguages, TextDirection } from './types';
/**
 * Stable concept identifier from the print-label catalog (kernel C, #440).
 * Structural string on purpose: the set of valid concepts is owned by the
 * generated label tables at call sites, not by the kernel.
 */
export type LabelConceptId = string;
/**
 * A semantic label: a concept reference plus its already-resolved renderings.
 * `primary` is the primary receipt language string (fallbacks already
 * applied by the injected resolver); `secondary` is the optional second
 * receipt language rendering of the SAME concept. Renderers decide how the
 * two variants share a line — the model never pre-concatenates them.
 */
export interface SemanticLabel {
    /** Catalog concept this label resolves from, when it has one. */
    readonly conceptId?: LabelConceptId;
    /** Resolved primary-language text. */
    readonly primary: string;
    /** Resolved secondary-language text of the same concept, when configured. */
    readonly secondary?: string;
}
/** Build a {@link SemanticLabel} from an explicit bilingual pair. */
export declare function bilingualLabel(text: BilingualLabel, conceptId?: LabelConceptId): SemanticLabel;
/**
 * A text value annotated with its resolved direction. Values classified as
 * confident LTR islands (see `resolveValueDirection`) carry `'ltr'` even in
 * RTL documents so renderers can embed them without bidi ambiguity.
 */
export interface DirectionalText {
    readonly text: string;
    readonly direction: TextDirection;
}
/** Annotate `text` with its value-scope direction for a document base direction. */
export declare function directionalText(text: string, base: TextDirection): DirectionalText;
/** One add-on line; price is the extended printed amount (0 = unpriced). */
export interface ItemAddonSnapshot {
    readonly name: string;
    readonly price: number;
    /** Addon unit quantity as printed truth, when the surface displays it. */
    readonly quantity?: number;
}
/** One item row as printed truth. */
export interface OrderItemSnapshot {
    readonly productName: string;
    readonly quantity: number;
    readonly unitPrice: number;
    readonly total: number;
    readonly addons: readonly ItemAddonSnapshot[];
    readonly specialInstructions: string;
}
/** The order behind the bill, as printed truth. */
export interface OrderSnapshot {
    readonly orderNumber: string;
    /** Canonical stored timestamp; renderers localize for presentation. */
    readonly createdAt: string;
    readonly tableName: string;
    /** Aggregator/web-order platform name (#284), e.g. "Swiggy". Empty when not an online order. */
    readonly onlinePlatform: string;
    /** The platform's own order id (#284), printed alongside the online-order banner. */
    readonly externalOrderId: string;
    /** Free-text delivery address, present only for `delivery` orders. */
    readonly deliveryAddress: string;
    readonly items: readonly OrderItemSnapshot[];
}
/** One captured payment line. */
export interface PaymentSnapshot {
    readonly method: string;
    readonly amount: number;
}
/** One display tax component (already reconciled by the caller). */
export interface TaxComponentSnapshot {
    readonly title: string;
    readonly rate: number | null;
    readonly amount: number;
}
/** The bill's financial truth. Amounts are never recomputed by builders. */
export interface BillSnapshot {
    readonly billNumber: string;
    readonly subtotal: number;
    readonly discountAmount: number;
    readonly taxAmount: number;
    readonly total: number;
    /** Flat service charge, when the server-persisted bill carries one. */
    readonly serviceCharge?: number;
    /** Flat delivery charge, when the bill carries one (frontend bills). */
    readonly deliveryCharge?: number;
    /** Flat packaging charge, when the bill carries one. */
    readonly packagingCharge?: number;
    readonly taxComponents: readonly TaxComponentSnapshot[];
    readonly payments: readonly PaymentSnapshot[];
    readonly pointsEarned: number;
    readonly pointsRedeemed: number;
    readonly pointsBalance: number | null;
}
/**
 * Merchant/business snapshot incl. the receipt show-flags. Builders apply
 * these flags while composing blocks so renderers receive final content.
 */
export interface BusinessSnapshot {
    readonly name: string;
    readonly address: string;
    readonly phone: string;
    readonly taxRegistrationNumber: string;
    /** Country-profile tax ID label (e.g. "GSTIN"), resolved by the caller. */
    readonly taxIdLabel: string;
    readonly instagramHandle: string;
    readonly footerNote: string;
    readonly customerName: string;
    readonly customerPhone: string;
    readonly showName: boolean;
    readonly showAddress: boolean;
    readonly showPhone: boolean;
    /**
     * Tri-state legacy flag: `'force'` prints the tax ID whenever a number
     * exists, `'never'` suppresses it, `'auto'` prints it when the bill
     * carries applicable tax.
     */
    readonly showTaxId: 'force' | 'never' | 'auto';
    readonly showTaxBreakdown: boolean;
    readonly showTableNumber: boolean;
    readonly showCustomerName: boolean;
    readonly showCustomerPhone: boolean;
}
/**
 * Normalized authoritative values passed in by callers. Renderers and
 * builders perform no DB IO — everything printed must be present here.
 */
export interface PrintData {
    readonly bill: BillSnapshot;
    readonly order: OrderSnapshot;
    readonly business: BusinessSnapshot;
    readonly isReprint: boolean;
}
/** Injected, pure label-catalog lookup (kernel C view at the call site). */
export type LabelResolver = (conceptId: LabelConceptId, language: PrintLanguageCode) => string;
/**
 * Rendering environment for one document: paper geometry, resolved language
 * policy (kernel C), base direction (caller-injected registry fact), and
 * locale-formatting preferences derived from existing regionalization
 * helpers at the call site.
 */
export interface PrintContext {
    /** Printable paper columns (32…48 for thermal receipts today). */
    readonly columns: number;
    /** Ordered resolved languages, primary first (max 2 in v1). */
    readonly languages: ResolvedPrintLanguages;
    /** Base document direction for the primary language. */
    readonly baseDirection: TextDirection;
    /** BCP-47 locale used for date/number formatting (e.g. `en-IN`). */
    readonly locale: string;
    /** Currency symbol as configured for the business. */
    readonly currencySymbol: string;
    /** Whether trailing `.00` decimals are trimmed on amounts. */
    readonly trimDecimals: boolean;
    /** Optional IANA timezone for business-local date presentation. */
    readonly timezone?: string;
    /** Pure label lookup injected from the generated print-label catalog. */
    readonly resolveLabel: LabelResolver;
}
/** Business identity: big header name plus contact/tax facts used in footers. */
export interface BusinessHeaderBlock {
    readonly kind: 'business-header';
    readonly direction: TextDirection;
    readonly name: DirectionalText | null;
    readonly address: DirectionalText | null;
    readonly phone: DirectionalText | null;
    readonly instagramHandle: DirectionalText | null;
    /** Tax registration line, present per merchant flag + tax applicability. */
    readonly taxId: {
        readonly label: SemanticLabel;
        readonly value: DirectionalText;
    } | null;
    /** Label used when the business phone renders as a labeled contact line. */
    readonly phoneLabel: SemanticLabel | null;
}
/** Invoice identity: title concept, number, canonical timestamp, table. */
export interface DocumentMetaBlock {
    readonly kind: 'document-meta';
    readonly direction: TextDirection;
    /** Tax-invoice vs plain-invoice title, chosen by tax applicability. */
    readonly title: SemanticLabel;
    /** Label rendered alongside the invoice/order number. */
    readonly invoiceNumberLabel: SemanticLabel;
    /** Alternate bill-number label; layouts that head the receipt with "Bill #". */
    readonly billNumberLabel: SemanticLabel;
    /** Date label for layouts that print a labeled date line (e.g. compact). */
    readonly dateLabel: SemanticLabel;
    readonly invoiceNumber: DirectionalText;
    /** Canonical stored timestamp; presentation formatting is a renderer duty. */
    readonly timestamp: DirectionalText;
    /** Table reference with its (uninterpolated) label concept. */
    readonly table: {
        readonly label: SemanticLabel;
        readonly name: DirectionalText;
    } | null;
}
/** Customer identity lines (name / phone / delivery address), when present and shown. */
export interface CustomerBlock {
    readonly kind: 'customer';
    readonly direction: TextDirection;
    readonly name: DirectionalText | null;
    readonly phone: DirectionalText | null;
    /** Delivery address line(s), present only for `delivery` orders. */
    readonly address: DirectionalText | null;
    /** Labels for layouts that render labeled customer lines (compact). */
    readonly nameLabel: SemanticLabel;
    readonly phoneLabel: SemanticLabel;
}
/** One add-on under an item row; price is its extended printed amount. */
export interface ItemAddonValue {
    readonly name: DirectionalText;
    readonly price: number;
    /** Addon unit quantity as printed truth, when the snapshot carries one. */
    readonly quantity?: number;
}
/** One item row: semantic fields only — no layout widths, no byte tokens. */
export interface ItemTableRow {
    readonly direction: TextDirection;
    readonly name: DirectionalText;
    readonly quantity: number;
    /** Per-unit price as printed truth, when the surface prints a rate column. */
    readonly unitPrice?: number;
    /** Line total as printed truth. */
    readonly amount: number;
    readonly addons: readonly ItemAddonValue[];
    readonly specialInstructions: DirectionalText | null;
}
/** Column-header labels for the item table (concepts + resolved strings). */
export interface ItemTableHeaderLabels {
    readonly item: SemanticLabel;
    readonly quantity: SemanticLabel;
    readonly amount: SemanticLabel;
}
/** Ordered item rows including addons and special instructions. */
export interface ItemTableBlock {
    readonly kind: 'item-table';
    readonly direction: TextDirection;
    readonly header: ItemTableHeaderLabels;
    /** Label rendered before an item's special instruction text. */
    readonly noteLabel: SemanticLabel;
    readonly rows: readonly ItemTableRow[];
}
/**
 * Per-component tax lines (only when the merchant shows the breakdown).
 * Component titles are printed truth from the caller's tax resolution.
 */
export interface TaxBreakdownBlock {
    readonly kind: 'tax-breakdown';
    readonly direction: TextDirection;
    readonly lines: readonly {
        readonly label: SemanticLabel;
        readonly rate: number | null;
        readonly amount: number;
    }[];
}
/**
 * Financial summary. All labels are semantic (bilingual pairs allowed);
 * sign/points suffixes ("−", "pts") are presentation choices renderers make.
 */
export interface TotalsBlock {
    readonly kind: 'totals';
    readonly direction: TextDirection;
    readonly subtotal: {
        readonly label: SemanticLabel;
        readonly amount: number;
    };
    readonly discount: {
        readonly label: SemanticLabel;
        readonly amount: number;
    } | null;
    /** Flat tax line, present only when no breakdown lines are emitted. */
    readonly tax: {
        readonly label: SemanticLabel;
        readonly amount: number;
    } | null;
    /** Flat service-charge line, present when the server snapshot carries a nonzero charge. */
    readonly serviceCharge: {
        readonly label: SemanticLabel;
        readonly amount: number;
    } | null;
    /** Flat delivery-charge line, present when the snapshot carries a nonzero charge. */
    readonly deliveryCharge: {
        readonly label: SemanticLabel;
        readonly amount: number;
    } | null;
    /** Flat packaging-charge line, present when the snapshot carries a nonzero charge. */
    readonly packagingCharge: {
        readonly label: SemanticLabel;
        readonly amount: number;
    } | null;
    readonly grandTotal: {
        readonly label: SemanticLabel;
        readonly amount: number;
    };
    readonly pointsRedeemed: {
        readonly label: SemanticLabel;
        readonly points: number;
    } | null;
    readonly pointsEarned: {
        readonly label: SemanticLabel;
        readonly points: number;
    } | null;
    readonly pointsBalance: {
        readonly label: SemanticLabel;
        readonly points: number;
    } | null;
}
/** Captured payment lines; unknown methods keep their raw code as literal. */
export interface PaymentsBlock {
    readonly kind: 'payments';
    readonly direction: TextDirection;
    readonly lines: readonly {
        /** Raw payment-method code (e.g. `cash`). */
        readonly method: string;
        readonly label: SemanticLabel;
        readonly amount: number;
    }[];
}
/**
 * Banner/footer/thank-you messaging. Designed so future banners (e.g. the
 * online-order banner, #284) become additional semantic entries rather than
 * ad-hoc renderer strings; the reprint banner lives here today.
 */
export interface MessageBlock {
    readonly kind: 'message';
    readonly direction: TextDirection;
    readonly reprintBanner: SemanticLabel | null;
    /** Online-order banner (#284): present whenever the order carries a platform/external id. */
    readonly onlineOrderBanner: {
        readonly label: SemanticLabel;
        readonly platform: DirectionalText;
        readonly externalOrderId: DirectionalText;
    } | null;
    readonly footerNote: DirectionalText | null;
    readonly thankYou: SemanticLabel | null;
}
/** Ordered union of every PrintDocument v1 block kind. */
export type PrintDocumentBlock = BusinessHeaderBlock | DocumentMetaBlock | CustomerBlock | ItemTableBlock | TaxBreakdownBlock | TotalsBlock | PaymentsBlock | MessageBlock;
/**
 * Renderer-independent semantic receipt document, version 1. Blocks appear
 * in canonical document order; each carries its resolved direction.
 */
export interface PrintDocument {
    readonly version: 1;
    /** Per-scope direction spec for the whole document (direction kernel). */
    readonly direction: DirectionSpec;
    /** Ordered resolved languages the document's labels were resolved in. */
    readonly languages: ResolvedPrintLanguages;
    readonly blocks: readonly PrintDocumentBlock[];
}
/** Typed accessor for one block kind within a document. */
export declare function getBlock<K extends PrintDocumentBlock['kind']>(document: PrintDocument, kind: K): Extract<PrintDocumentBlock, {
    kind: K;
}> | undefined;
/**
 * Build a PrintDocument v1 from normalized print data. Pure: reads only its
 * arguments; performs no IO and no financial recomputation (totals, taxes
 * and payments are copied verbatim from `printData.bill`).
 */
export declare function buildBillDocument(printData: PrintData, printContext: PrintContext): PrintDocument;
/** Whether an order item belongs on a new kitchen ticket. */
export declare function isKotItemPending(status: unknown): boolean;
/** One add-on under a KOT item row; quantity is display-only kitchen truth. */
export interface KotAddonSnapshot {
    readonly name: string;
    /** Add-on unit quantity, when greater than the default of one. */
    readonly quantity?: number;
}
/** One item on the kitchen ticket, as printed truth. */
export interface KotItemSnapshot {
    readonly productName: string;
    readonly quantity: number;
    readonly addons: readonly KotAddonSnapshot[];
    readonly specialInstructions: string;
}
/** The order behind the ticket (order number, canonical timestamp, table, type, optional customer). */
export interface KotOrderSnapshot {
    readonly orderNumber: string;
    readonly createdAt: string;
    readonly tableName: string;
    readonly orderType: string;
    /** Customer display name, when the order carries one. */
    readonly customerName?: string;
}
/**
 * Normalized authoritative values for one kitchen ticket. Pure snapshot —
 * no live rows; callers normalize before building.
 */
export interface KotPrintData {
    readonly stationName: string;
    readonly order: KotOrderSnapshot;
    readonly items: readonly KotItemSnapshot[];
}
/** Ticket header: banner, station, order number, table, type, optional customer, time. */
export interface KotHeaderBlock {
    readonly kind: 'kot-header';
    readonly direction: TextDirection;
    readonly banner: SemanticLabel;
    readonly stationLabel: SemanticLabel;
    readonly stationName: DirectionalText;
    readonly orderNumberLabel: SemanticLabel;
    readonly orderNumber: DirectionalText;
    /** Table reference with its (uninterpolated) label concept. */
    readonly table: {
        readonly label: SemanticLabel;
        readonly name: DirectionalText;
    } | null;
    readonly orderType: {
        readonly label: SemanticLabel;
        readonly value: DirectionalText;
        readonly code: string;
    } | null;
    readonly customer: {
        readonly label: SemanticLabel;
        readonly name: DirectionalText;
    } | null;
    readonly timeLabel: SemanticLabel;
    /** Canonical stored timestamp; presentation formatting is a renderer duty. */
    readonly timestamp: DirectionalText;
}
/** Ordered kitchen item rows with addons and preparation instructions. */
export interface KotAddonValue extends DirectionalText {
    /** Add-on unit quantity, when greater than the default of one. */
    readonly quantity?: number;
}
export interface KotItemsBlock {
    readonly kind: 'kot-items';
    readonly direction: TextDirection;
    readonly rows: readonly {
        readonly quantity: number;
        readonly name: DirectionalText;
        readonly addons: readonly KotAddonValue[];
        readonly specialInstructions: DirectionalText | null;
    }[];
}
/** Ordered union of KOT v1 block kinds. */
export type KotDocumentBlock = KotHeaderBlock | KotItemsBlock;
/**
 * Renderer-independent semantic kitchen-ticket document, version 1.
 * KOT language policy is single-primary (v1): exactly one resolved language.
 */
export interface KotDocument {
    readonly version: 1;
    readonly direction: DirectionSpec;
    readonly languages: ResolvedPrintLanguages;
    readonly blocks: readonly KotDocumentBlock[];
}
/**
 * Build a KotDocument v1 from normalized kitchen-ticket data. Pure: reads
 * only its arguments and performs no IO or recomputation.
 */
export declare function buildKotDocument(printData: KotPrintData, printContext: PrintContext): KotDocument;
//# sourceMappingURL=document.d.ts.map