/**
 * Per-document renderer readiness lifecycle for the main POS window.
 *
 * The window starts hidden and is shown once the current document confirms
 * its window-control surface is present (native overlay confirmed, or HTML
 * fallback controls committed). Readiness is bound to an epoch token so the
 * lifecycle is coherent across reloads:
 *
 * - Every full-document main-frame navigation (`did-start-navigation`,
 *   including the initial load) begins a new epoch, which invalidates any
 *   report from the previous document and re-arms a bounded fail-safe. Same-
 *   document Next.js route changes do not reset readiness.
 * - The renderer learns the current epoch from `get-status` and reports
 *   readiness bound to it; stale-epoch or malformed reports are ignored.
 * - If the current epoch's document never confirms (renderer crash before
 *   mount, getStatus() rejection, hung load), the fail-safe fires and shows
 *   the window anyway: a visible window without verified controls beats an
 *   invisible POS forever, and the path taken is logged loudly.
 */
/** Registers the callback used to surface the window (fail-safe path). */
export declare function initWindowReadiness(showWindow: () => void, options?: {
    failsafeMs?: number;
}): void;
/**
 * Begins a fresh readiness epoch for an incoming document. Called on window
 * creation and before each full-document main-frame navigation; invalidates
 * prior documents' readiness reports and arms the fail-safe for this one.
 * The epoch starts before the new preload runs, so clearing the nonce here
 * cannot race the incoming document's synchronous registration. Same-document
 * Next.js route changes never call this function.
 */
export declare function beginRendererDocument(): number;
export declare function getRendererReadinessEpoch(): number;
/** True only for a main-frame navigation that creates a new document. */
export declare function isFullDocumentMainFrameNavigation(details: {
    isMainFrame: boolean;
    isSameDocument: boolean;
}): boolean;
export declare function registerRendererDocument(documentNonce: unknown): boolean;
export declare function getRendererDocumentNonce(): string | null;
/**
 * Records a readiness report bound to an epoch. Returns true only when the
 * report is well-formed and matches the current epoch; stale documents'
 * reports are rejected so a reload can never inherit readiness.
 */
export declare function markWindowRendererReady(epoch: unknown, documentNonce: unknown): boolean;
/** True when the current document's control surface has confirmed ready. */
export declare function isWindowRendererReady(): boolean;
export declare function isRendererReadinessFailSafeShown(): boolean;
export declare function isCurrentRendererFrame(senderFrame: {
    frameToken?: string;
    detached?: boolean;
} | null | undefined, currentFrame: {
    frameToken?: string;
    detached?: boolean;
} | null | undefined): boolean;
//# sourceMappingURL=window-readiness.d.ts.map