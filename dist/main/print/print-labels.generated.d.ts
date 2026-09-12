/** Stable concept identifiers resolvable through printLabel(). */
export type PrintConceptId = 'print.taxInvoiceTitle' | 'print.invoiceTitle' | 'print.invoiceNumber' | 'print.time' | 'print.customerShort' | 'print.numberShort' | 'print.address' | 'print.call' | 'print.note' | 'print.phoneLong' | 'print.subtotalExclTax' | 'print.serviceChargeShort' | 'print.grandTotal' | 'print.thankYouShort' | 'print.thankYouVisitAgain' | 'print.pleaseComeAgain' | 'print.ratesInclusiveNote' | 'print.pointsEarned' | 'print.pointsBalance' | 'print.pointsRedeemed' | 'print.kot.title' | 'print.kot.banner' | 'print.kot.station' | 'print.kot.type' | 'print.kot.noPendingItems' | 'print.kot.end' | 'print.hsn' | 'print.test.title' | 'print.test.networkUsb' | 'print.test.columns' | 'print.test.wrapHint' | 'print.test.success' | 'receipt.billNumber' | 'receipt.date' | 'pos.tableLabel' | 'pos.customer' | 'receipt.customerNo' | 'receipt.phone' | 'receipt.item' | 'receipt.qty' | 'receipt.rate' | 'receipt.amount' | 'printTest.amt' | 'pos.subtotal' | 'pos.discount' | 'pos.tax' | 'pos.delivery' | 'pos.packaging' | 'receipt.totalTax' | 'receipt.serviceCharge' | 'receipt.taxDetails' | 'receipt.payments' | 'receipt.thankYou' | 'receipt.taxIncluded' | 'receipt.reprint' | 'receipt.onlineOrder' | 'pos.orderNumber' | 'pos.orderTypeDineIn' | 'pos.orderTypeDelivery' | 'pos.orderTypeOnline' | 'pos.orderTypeTakeaway' | 'pos.methodCash' | 'pos.methodCard' | 'pos.methodWallet';
export declare const PRINT_LABEL_LANGUAGES: readonly ["en", "fa", "es", "fr", "pt", "tr", "fil", "de"];
export type PrintLabelLanguage = (typeof PRINT_LABEL_LANGUAGES)[number];
/**
 * Resolve a receipt/KOT label concept in the requested language.
 * Unknown languages and unknown languages missing individual entries fall
 * back to English so a receipt always renders real labels, never raw keys.
 */
export declare function printLabel(lang: string, conceptId: PrintConceptId): string;
/** True when the generated view carries a dedicated table for `lang`. */
export declare function isGeneratedPrintLanguage(lang: string): lang is PrintLabelLanguage;
//# sourceMappingURL=print-labels.generated.d.ts.map