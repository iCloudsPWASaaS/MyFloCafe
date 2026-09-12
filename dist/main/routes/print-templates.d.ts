/**
 * Merchant print template CRUD API (#447, epic #438).
 *
 * Owner-role lifecycle management for tenant-owned semantic receipt
 * templates: create draft -> activate -> archive, with single-step rollback.
 * Payloads are validated fail-closed by the shared kernel validator on every
 * write. #448 adds validated offline transfer: GET /:id/export downloads a
 * self-describing `.json` envelope; POST /import runs the same fail-closed
 * pipeline on an uploaded envelope and lands it as a NEW draft. This API
 * deliberately does NOT expose a visual editor.
 */
export declare const printTemplateRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=print-templates.d.ts.map