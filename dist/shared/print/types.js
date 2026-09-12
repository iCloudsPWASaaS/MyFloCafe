"use strict";
/**
 * Shared print kernel — core types (#441, epic #438).
 *
 * PURITY RULES (see shared/print/README.md):
 *   - Types + pure functions only. No Electron, DOM, React, DB, filesystem,
 *     network, or transport IO of any kind.
 *   - No imports from `frontend/` or `main/`. The central UI language
 *     registry (`frontend/src/lib/i18n/languages.ts`) stays authoritative:
 *     call sites inject registry-derived facts as plain parameters.
 *   - Never hardcode a language union (`'en' | 'fa' | ...`). Language codes
 *     are structural strings validated against injected registry facts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map