/**
 * Shared print kernel — direction semantics (#441).
 * Pure functions only.
 */
import type { DirectionScope, TextDirection } from './types';
/**
 * Per-scope direction for a document. `document` and `block` follow the base
 * direction; `value` defaults to the base but individual values may resolve
 * to LTR islands via {@link resolveValueDirection}.
 */
export interface DirectionSpec {
    readonly base: TextDirection;
    readonly document: TextDirection;
    readonly block: TextDirection;
    readonly value: TextDirection;
}
/** Build the per-scope direction spec for a base document direction. */
export declare function resolveDirectionSpec(base: TextDirection): DirectionSpec;
/**
 * Resolve the direction for a specific embedded value inside a document with
 * the given base direction. Confident LTR islands (IDs, phones, URLs, SKUs,
 * tax IDs, invoice numbers, amounts) resolve to `'ltr'` even in RTL
 * documents; everything else follows the base. Classification is heuristic
 * and conservative — mixed natural-language text is never an island.
 */
export declare function resolveValueDirection(text: string, base: TextDirection): TextDirection;
/** Scope-aware direction resolution. */
export declare function resolveScopeDirection(scope: DirectionScope, base: TextDirection, value?: string): TextDirection;
/**
 * True when `text` carries any RTL-script letters (Hebrew/Arabic blocks).
 * Exported so registry owners can derive a language's base direction from
 * its own label strings without hardcoding language unions in the kernel.
 */
export declare function containsRtlScript(text: string): boolean;
/**
 * Classify whether `text` is a confident LTR island (IDs, phones, URLs,
 * SKUs, tax IDs, invoice numbers, amounts). Returns false for empty input
 * and for any text containing RTL script characters.
 */
export declare function isLtrIsland(text: string): boolean;
//# sourceMappingURL=direction.d.ts.map