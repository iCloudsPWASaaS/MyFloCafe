"use strict";
/**
 * Shared print kernel — bilingual label semantics (#441).
 * Pure functions only. Renderers choose presentation later; the kernel only
 * decides which width-fit strategy applies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INLINE_SEPARATOR_COLUMNS = void 0;
exports.labelWidth = labelWidth;
exports.selectBilingualFit = selectBilingualFit;
exports.bilingualLabelLines = bilingualLabelLines;
/**
 * Columns reserved between inline primary and secondary text. One space on
 * each side keeps the two variants readable when both fit on one line.
 */
exports.INLINE_SEPARATOR_COLUMNS = 2;
/**
 * Visible width of a label in printer columns. v1 measures UTF-16 code units
 * (thermal fonts are effectively monospaced for Latin and Persian/Arabic at
 * the code points FloCafe prints today); renderers may pre-shape text before
 * applying these strategies. Keep pure: no Intl, no DOM measurement.
 */
function labelWidth(text) {
    return typeof text === 'string' ? text.length : 0;
}
/**
 * Select the width-fit strategy for a bilingual label at a given paper
 * column count:
 *   - single-language labels are trivially `'inline'`;
 *   - bilingual labels go `'inline'` when primary + separator + secondary
 *     fits within `columns`, otherwise `'stacked'` (one line each);
 *   - non-positive or non-finite column counts force `'stacked'`.
 *
 * Callers test this at 32/36/42/48 columns (58mm…80mm paper).
 */
function selectBilingualFit(label, columns) {
    if (label.secondary === undefined)
        return 'inline';
    if (!Number.isFinite(columns) || columns <= 0)
        return 'stacked';
    const total = labelWidth(label.primary) + exports.INLINE_SEPARATOR_COLUMNS + labelWidth(label.secondary);
    return total <= columns ? 'inline' : 'stacked';
}
/**
 * Ordered lines a renderer should emit for `label` under its selected
 * strategy. Pure view-model helper so every renderer stacks identically.
 */
function bilingualLabelLines(label, strategy) {
    if (strategy === 'inline' && label.secondary !== undefined) {
        const pad = ' '.repeat(exports.INLINE_SEPARATOR_COLUMNS);
        return [`${label.primary}${pad}${label.secondary}`];
    }
    return label.secondary !== undefined && strategy === 'stacked'
        ? [label.primary, label.secondary]
        : [label.primary];
}
//# sourceMappingURL=bilingual.js.map