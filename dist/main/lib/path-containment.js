"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveContainedPath = resolveContainedPath;
const path = __importStar(require("path"));
/**
 * Resolves `segments` against `root` and returns the normalized absolute path
 * only when it is strictly contained within `root`. Returns `null` when the
 * resolved path escapes `root` — via `..` segments, absolute segments, or any
 * other normalization that lands outside the root.
 *
 * This is a lexical containment check: `path.join`/`path.resolve` normalize
 * `..`, `.`, and redundant separators, and the result is compared against the
 * resolved root with a trailing separator so a sibling directory whose name
 * merely shares the root's prefix (e.g. `/var/www2`) cannot match.
 *
 * The final path is not `realpath`-resolved here. Callers that serve real
 * files still pass through `send`/`serve-static`, which resolves symlinks and
 * performs its own containment; this helper exists so the containment property
 * at each static-file boundary is explicit and statically verifiable.
 */
function resolveContainedPath(root, ...segments) {
    const resolvedRoot = path.resolve(root);
    const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    // path.join (unlike path.resolve) does not discard earlier segments when a
    // later segment is absolute, so an absolute attacker segment is treated as a
    // sub-path of root rather than silently winning. It also normalizes `..`.
    const joined = path.join(resolvedRoot, ...segments);
    const resolved = path.resolve(joined);
    if (resolved === resolvedRoot) {
        return resolvedRoot;
    }
    if (!resolved.startsWith(rootWithSep)) {
        return null;
    }
    const rel = path.relative(resolvedRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return null;
    }
    return resolved;
}
//# sourceMappingURL=path-containment.js.map