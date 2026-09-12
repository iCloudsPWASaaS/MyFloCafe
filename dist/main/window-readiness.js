"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.initWindowReadiness = initWindowReadiness;
exports.beginRendererDocument = beginRendererDocument;
exports.getRendererReadinessEpoch = getRendererReadinessEpoch;
exports.isFullDocumentMainFrameNavigation = isFullDocumentMainFrameNavigation;
exports.registerRendererDocument = registerRendererDocument;
exports.getRendererDocumentNonce = getRendererDocumentNonce;
exports.markWindowRendererReady = markWindowRendererReady;
exports.isWindowRendererReady = isWindowRendererReady;
exports.isRendererReadinessFailSafeShown = isRendererReadinessFailSafeShown;
exports.isCurrentRendererFrame = isCurrentRendererFrame;
const RENDERER_READINESS_FAILSAFE_MS = 10_000;
const DOCUMENT_NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let rendererReadinessEpoch = 0;
let readyEpoch = null;
let rendererDocumentNonce = null;
let rendererReadinessFailSafeShown = false;
let showWindowFn = null;
let failsafeTimer = null;
let failsafeMs = RENDERER_READINESS_FAILSAFE_MS;
/** Registers the callback used to surface the window (fail-safe path). */
function initWindowReadiness(showWindow, options) {
    showWindowFn = showWindow;
    failsafeMs = Math.max(0, options?.failsafeMs ?? RENDERER_READINESS_FAILSAFE_MS);
}
function clearReadinessFailSafe() {
    if (failsafeTimer !== null) {
        clearTimeout(failsafeTimer);
        failsafeTimer = null;
    }
}
/**
 * Begins a fresh readiness epoch for an incoming document. Called on window
 * creation and before each full-document main-frame navigation; invalidates
 * prior documents' readiness reports and arms the fail-safe for this one.
 * The epoch starts before the new preload runs, so clearing the nonce here
 * cannot race the incoming document's synchronous registration. Same-document
 * Next.js route changes never call this function.
 */
function beginRendererDocument() {
    rendererReadinessEpoch += 1;
    readyEpoch = null;
    rendererDocumentNonce = null;
    rendererReadinessFailSafeShown = false;
    clearReadinessFailSafe();
    const epoch = rendererReadinessEpoch;
    failsafeTimer = setTimeout(() => {
        failsafeTimer = null;
        if (epoch !== rendererReadinessEpoch)
            return;
        if (readyEpoch === epoch)
            return;
        rendererReadinessFailSafeShown = true;
        if (showWindowFn) {
            console.error(`[Window] Renderer readiness FAIL-SAFE fired for epoch ${epoch}: ` +
                'the renderer never confirmed its window-control surface (getStatus ' +
                'rejected/hung, or the document failed to mount controls). Showing ' +
                'the window anyway - visible-without-controls beats invisible.');
            showWindowFn();
        }
    }, failsafeMs);
    return epoch;
}
function getRendererReadinessEpoch() {
    return rendererReadinessEpoch;
}
/** True only for a main-frame navigation that creates a new document. */
function isFullDocumentMainFrameNavigation(details) {
    return details.isMainFrame && !details.isSameDocument;
}
function registerRendererDocument(documentNonce) {
    if (typeof documentNonce !== 'string' || !DOCUMENT_NONCE_PATTERN.test(documentNonce))
        return false;
    rendererDocumentNonce = documentNonce;
    return true;
}
function getRendererDocumentNonce() {
    return rendererDocumentNonce;
}
/**
 * Records a readiness report bound to an epoch. Returns true only when the
 * report is well-formed and matches the current epoch; stale documents'
 * reports are rejected so a reload can never inherit readiness.
 */
function markWindowRendererReady(epoch, documentNonce) {
    if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 1)
        return false;
    if (epoch !== rendererReadinessEpoch)
        return false;
    if (documentNonce !== rendererDocumentNonce)
        return false;
    readyEpoch = epoch;
    clearReadinessFailSafe();
    return true;
}
/** True when the current document's control surface has confirmed ready. */
function isWindowRendererReady() {
    return readyEpoch === rendererReadinessEpoch && readyEpoch !== null && rendererReadinessEpoch > 0;
}
function isRendererReadinessFailSafeShown() {
    return rendererReadinessFailSafeShown;
}
function isCurrentRendererFrame(senderFrame, currentFrame) {
    return Boolean(senderFrame
        && currentFrame
        && senderFrame.detached !== true
        && currentFrame.detached !== true
        && typeof senderFrame.frameToken === 'string'
        && senderFrame.frameToken === currentFrame.frameToken);
}
//# sourceMappingURL=window-readiness.js.map