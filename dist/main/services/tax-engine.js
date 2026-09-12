"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaxEngine = void 0;
exports.resolveTaxCategory = resolveTaxCategory;
exports.applyPayableRounding = applyPayableRounding;
const decimal_js_1 = __importDefault(require("decimal.js"));
const countries_1 = require("../countries");
const TaxDecimal = decimal_js_1.default.clone({ precision: 40, rounding: decimal_js_1.default.ROUND_HALF_UP });
const ROUNDING = {
    half_up: decimal_js_1.default.ROUND_HALF_UP,
    half_even: decimal_js_1.default.ROUND_HALF_EVEN,
    floor: decimal_js_1.default.ROUND_FLOOR,
    ceiling: decimal_js_1.default.ROUND_CEIL,
};
function decimal(value, fallback = '0') {
    const result = new TaxDecimal(value ?? fallback);
    if (!result.isFinite())
        throw new Error(`Invalid decimal value: ${value}`);
    return result;
}
function canonical(value) {
    if (value.isZero())
        return '0';
    return value.toFixed().replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}
function roundPlaces(value, places, method) {
    return value.toDecimalPlaces(places, ROUNDING[method]);
}
function roundIncrement(value, incrementValue, method) {
    const increment = decimal(incrementValue);
    if (increment.lte(0))
        throw new Error('payableRounding.increment must be greater than zero');
    return value.div(increment).toDecimalPlaces(0, ROUNDING[method]).mul(increment);
}
function resolvePayableIncrement(pack, currency) {
    const configuredIncrement = new TaxDecimal(pack.payableRounding.increment);
    const configuredDecimals = configuredIncrement.decimalPlaces() ?? 0;
    if (currency !== undefined
        && pack.currency === 'XXX'
        && (0, countries_1.getCurrencyFractionDigits)(currency) > configuredDecimals) {
        return new TaxDecimal(1).div((0, countries_1.getCurrencyMinorUnitFactor)(currency)).toString();
    }
    return pack.payableRounding.increment;
}
function resolveTaxCategory(pack, line) {
    if (line.transactionExempt) {
        return { categoryId: null, source: 'transaction_exemption' };
    }
    if (line.transactionCategoryId) {
        return { categoryId: line.transactionCategoryId, source: 'transaction_override' };
    }
    if (line.merchantCategoryId) {
        return { categoryId: line.merchantCategoryId, source: 'merchant_override' };
    }
    const explicitCategoryId = line.taxCategoryId || line.productCategoryId;
    if (explicitCategoryId) {
        return { categoryId: explicitCategoryId, source: 'explicit' };
    }
    if (line.kind === 'addon' && line.inheritParentCategory && line.parentProductCategoryId) {
        return { categoryId: line.parentProductCategoryId, source: 'parent' };
    }
    const defaultCategory = pack.defaultCategories[line.kind];
    if (defaultCategory) {
        return { categoryId: defaultCategory, source: 'charge_default' };
    }
    return { categoryId: pack.unclassifiedCategoryId, source: 'unclassified' };
}
function matchesRule(rule, input, categoryId) {
    if (!rule.categoryIds.includes(categoryId))
        return false;
    const conditions = rule.conditions;
    if (!conditions)
        return true;
    if (conditions.businessTypes && !conditions.businessTypes.includes(input.businessType || '')) {
        return false;
    }
    if (conditions.customerExempt !== undefined
        && Boolean(input.customer?.exempt) !== conditions.customerExempt) {
        return false;
    }
    const isInterstate = Boolean(input.customer?.registrationNumber
        && input.customer.stateCode
        && input.storeStateCode
        && input.customer.stateCode !== input.storeStateCode);
    if (conditions.customerStateRelation === 'interstate' && !isInterstate)
        return false;
    if (conditions.customerStateRelation === 'intra_or_unspecified' && isInterstate)
        return false;
    return true;
}
function topologicalRules(rules) {
    const byId = new Map(rules.map((rule) => [rule.id, rule]));
    const visiting = new Set();
    const visited = new Set();
    const result = [];
    const visit = (rule) => {
        if (visited.has(rule.id))
            return;
        if (visiting.has(rule.id))
            throw new Error(`Tax rule dependency cycle at ${rule.id}`);
        visiting.add(rule.id);
        if (rule.type === 'fixed' && (rule.baseRuleIds?.length || 0) > 0) {
            throw new Error(`Fixed tax rule ${rule.id} cannot depend on another tax rule`);
        }
        for (const dependencyId of rule.baseRuleIds || []) {
            const dependency = byId.get(dependencyId);
            if (!dependency) {
                throw new Error(`Tax rule ${rule.id} has unresolved line-local dependency ${dependencyId}`);
            }
            visit(dependency);
        }
        visiting.delete(rule.id);
        visited.add(rule.id);
        result.push(rule);
    };
    for (const rule of rules)
        visit(rule);
    return result;
}
function fixedAmount(rule, quantity) {
    if (rule.type !== 'fixed' || rule.amount === undefined || !rule.appliesPer) {
        throw new Error(`Fixed tax rule ${rule.id} requires amount and appliesPer`);
    }
    if (!['unit', 'line'].includes(rule.appliesPer)) {
        throw new Error(`Fixed tax rule ${rule.id} has invalid appliesPer value: ${rule.appliesPer}`);
    }
    const amount = decimal(rule.amount);
    if (amount.lt(0))
        throw new Error(`Fixed tax rule ${rule.id} cannot be negative`);
    return rule.appliesPer === 'unit' ? amount.mul(quantity) : amount;
}
function calculateRawLine(input, line) {
    const quantity = decimal(line.quantity);
    const unitPrice = decimal(line.unitPrice);
    const discount = decimal(line.discount);
    if (quantity.lte(0))
        throw new Error(`Line ${line.lineId} quantity must be greater than zero`);
    if (unitPrice.lt(0) || discount.lt(0))
        throw new Error(`Line ${line.lineId} has a negative amount`);
    const grossAmount = unitPrice.mul(quantity);
    if (discount.gt(grossAmount)) {
        console.warn(`[TaxEngine] Line ${line.lineId} discount (${discount}) exceeds gross amount (${grossAmount}), clamping gross to 0.`);
    }
    const gross = decimal_js_1.default.max(new TaxDecimal('0'), grossAmount.minus(discount));
    const resolution = resolveTaxCategory(input.pack, line);
    const category = resolution.categoryId
        ? input.pack.categories.find((entry) => entry.id === resolution.categoryId)
        : undefined;
    if (resolution.categoryId && !category) {
        throw new Error(`Line ${line.lineId} resolved unknown tax category ${resolution.categoryId}`);
    }
    const requestedBehavior = line.taxBehavior || category?.defaultBehavior || 'country_default';
    const behavior = requestedBehavior === 'country_default'
        ? (input.pack.inclusivePricingDefault ? 'inclusive' : 'exclusive')
        : requestedBehavior;
    if (resolution.source === 'transaction_exemption' || behavior === 'exempt') {
        return { input: line, resolution, behavior: 'exempt', gross, taxableBase: gross, components: [] };
    }
    const categoryRuleIds = new Set(category?.ruleIds || []);
    const selected = input.pack.rules.filter((rule) => categoryRuleIds.has(rule.id)
        && resolution.categoryId !== null
        && matchesRule(rule, input, resolution.categoryId));
    const ordered = topologicalRules(selected);
    const fixed = ordered.filter((rule) => rule.type === 'fixed');
    const percentages = ordered.filter((rule) => rule.type === 'percent');
    const fixedAmounts = new Map(fixed.map((rule) => [rule.id, fixedAmount(rule, quantity)]));
    const totalFixed = Array.from(fixedAmounts.values()).reduce((sum, amount) => sum.plus(amount), new TaxDecimal('0'));
    if (behavior === 'inclusive' && totalFixed.gt(gross)) {
        throw new Error(`Fixed inclusive tax exceeds gross amount on line ${line.lineId}`);
    }
    let taxableBase = gross;
    const rawAmounts = new Map(fixedAmounts);
    if (behavior === 'inclusive') {
        const remainderGross = gross.minus(totalFixed);
        const coefficients = new Map();
        const intercepts = new Map();
        for (const rule of percentages) {
            if (rule.rate === undefined)
                throw new Error(`Percent tax rule ${rule.id} requires rate`);
            const rate = decimal(rule.rate).div('100');
            if (rate.lt(0))
                throw new Error(`Percent tax rule ${rule.id} rate cannot be negative`);
            let coefficientBase = new TaxDecimal('1');
            let interceptBase = new TaxDecimal('0');
            for (const dependencyId of rule.baseRuleIds || []) {
                const dependency = selected.find((candidate) => candidate.id === dependencyId);
                if (!dependency) {
                    throw new Error(`Tax rule ${rule.id} has unresolved line-local dependency ${dependencyId}`);
                }
                if (dependency.type === 'fixed') {
                    interceptBase = interceptBase.plus(fixedAmounts.get(dependencyId) || 0);
                }
                else {
                    coefficientBase = coefficientBase.plus(coefficients.get(dependencyId) || 0);
                    interceptBase = interceptBase.plus(intercepts.get(dependencyId) || 0);
                }
            }
            coefficients.set(rule.id, coefficientBase.mul(rate));
            intercepts.set(rule.id, interceptBase.mul(rate));
        }
        const coefficientTotal = Array.from(coefficients.values()).reduce((sum, value) => sum.plus(value), new TaxDecimal('0'));
        const interceptTotal = Array.from(intercepts.values()).reduce((sum, value) => sum.plus(value), new TaxDecimal('0'));
        const divisor = coefficientTotal.plus('1');
        if (divisor.isZero())
            throw new Error(`Inclusive tax calculation divisor is zero on line ${line.lineId}`);
        taxableBase = remainderGross.minus(interceptTotal).div(divisor);
        if (taxableBase.lt(0))
            throw new Error(`Inclusive taxes exceed gross amount on line ${line.lineId}`);
        for (const rule of percentages) {
            rawAmounts.set(rule.id, taxableBase.mul(coefficients.get(rule.id) || 0).plus(intercepts.get(rule.id) || 0));
        }
    }
    else {
        for (const rule of percentages) {
            if (rule.rate === undefined)
                throw new Error(`Percent tax rule ${rule.id} requires rate`);
            let base = taxableBase;
            for (const dependencyId of rule.baseRuleIds || []) {
                const dependencyAmount = rawAmounts.get(dependencyId);
                if (!dependencyAmount) {
                    throw new Error(`Tax rule ${rule.id} has unresolved line-local dependency ${dependencyId}`);
                }
                base = base.plus(dependencyAmount);
            }
            rawAmounts.set(rule.id, base.mul(decimal(rule.rate)).div('100'));
        }
    }
    const components = ordered.map((rule) => ({
        lineId: line.lineId,
        rule,
        amount: rawAmounts.get(rule.id) || new TaxDecimal('0'),
        rounded: new TaxDecimal('0'),
        remainder: new TaxDecimal('0'),
    }));
    return { input: line, resolution, behavior, gross, taxableBase, components };
}
function applyTaxRounding(pack, lines, decimalPlaces = pack.taxRounding.decimalPlaces) {
    const policy = pack.taxRounding;
    const quantum = new TaxDecimal('10').pow(-decimalPlaces);
    if (policy.scope === 'unit') {
        for (const line of lines) {
            const quantity = decimal(line.input.quantity);
            for (const component of line.components) {
                const isLineFixed = component.rule.type === 'fixed' && component.rule.appliesPer === 'line';
                component.rounded = isLineFixed
                    ? roundPlaces(component.amount, decimalPlaces, policy.method)
                    : roundPlaces(component.amount.div(quantity), decimalPlaces, policy.method).mul(quantity);
                component.remainder = component.amount.minus(component.rounded);
            }
        }
        return;
    }
    if (policy.scope === 'line') {
        for (const line of lines) {
            for (const component of line.components) {
                component.rounded = roundPlaces(component.amount, decimalPlaces, policy.method);
                component.remainder = component.amount.minus(component.rounded);
            }
        }
        return;
    }
    const components = lines.flatMap((line) => line.components);
    const target = roundPlaces(components.reduce((sum, component) => sum.plus(component.amount), new TaxDecimal('0')), decimalPlaces, policy.method);
    for (const component of components) {
        component.rounded = component.amount.toDecimalPlaces(decimalPlaces, decimal_js_1.default.ROUND_FLOOR);
        component.remainder = component.amount.minus(component.rounded);
    }
    let units = target.minus(components.reduce((sum, component) => sum.plus(component.rounded), new TaxDecimal('0'))).div(quantum).toDecimalPlaces(0, decimal_js_1.default.ROUND_HALF_UP);
    const ordered = [...components].sort((left, right) => {
        const remainderOrder = right.remainder.comparedTo(left.remainder);
        if (remainderOrder !== 0)
            return remainderOrder;
        const ruleOrder = left.rule.id.localeCompare(right.rule.id);
        return ruleOrder !== 0 ? ruleOrder : left.lineId.localeCompare(right.lineId);
    });
    let index = 0;
    while (units.gt(0) && ordered.length > 0) {
        const item = ordered[index % ordered.length];
        item.rounded = item.rounded.plus(quantum);
        units = units.minus('1');
        index += 1;
    }
}
class TaxEngine {
    static calculate(input) {
        const rawLines = input.lines.map((line) => calculateRawLine(input, line));
        const places = input.currency !== undefined
            ? (0, countries_1.getCurrencyFractionDigits)(input.currency)
            : input.pack.taxRounding.decimalPlaces;
        applyTaxRounding(input.pack, rawLines, places);
        const lineResults = rawLines.map((line) => {
            const components = line.components.map((component) => ({
                ruleId: component.rule.id,
                label: component.rule.label,
                type: component.rule.type,
                ...(component.rule.rate === undefined ? {} : { rate: component.rule.rate }),
                ...(component.rule.amount === undefined ? {} : { amountPer: component.rule.amount }),
                baseRuleIds: component.rule.baseRuleIds || [],
                amount: component.rounded.toFixed(places),
                roundingRemainder: canonical(component.amount.minus(component.rounded)),
            }));
            const taxAmount = line.components.reduce((sum, component) => sum.plus(component.rounded), new TaxDecimal('0'));
            return {
                lineId: line.input.lineId,
                categoryId: line.resolution.categoryId,
                categorySource: line.resolution.source,
                taxBehavior: line.behavior,
                grossAmount: line.gross.toFixed(places),
                taxableBase: line.taxableBase.toFixed(places),
                taxAmount: taxAmount.toFixed(places),
                components,
            };
        });
        const subtotal = rawLines.reduce((sum, line) => sum.plus(line.gross), new TaxDecimal('0'));
        const taxAmount = lineResults.reduce((sum, line) => sum.plus(line.taxAmount), new TaxDecimal('0'));
        const totalBeforePayableRounding = rawLines.reduce((sum, line, index) => {
            const lineTax = decimal(lineResults[index].taxAmount);
            return sum.plus(line.behavior === 'inclusive' ? line.gross : line.gross.plus(lineTax));
        }, new TaxDecimal('0'));
        const payableTotal = roundIncrement(totalBeforePayableRounding, resolvePayableIncrement(input.pack, input.currency), input.pack.payableRounding.method);
        const appliedRuleIds = [...new Set(lineResults.flatMap((line) => line.components.map((component) => component.ruleId)))].sort();
        const snapshot = {
            packId: input.pack.id,
            packVersion: input.pack.version,
            effectiveFrom: input.pack.effectiveFrom,
            taxRounding: input.pack.taxRounding,
            payableRounding: input.pack.payableRounding,
            appliedRuleIds,
            lines: lineResults,
        };
        return {
            packId: input.pack.id,
            packVersion: input.pack.version,
            lines: lineResults,
            subtotal: subtotal.toFixed(places),
            taxAmount: taxAmount.toFixed(places),
            totalBeforePayableRounding: totalBeforePayableRounding.toFixed(places),
            payableTotal: canonical(payableTotal),
            payableRoundingAdjustment: canonical(payableTotal.minus(totalBeforePayableRounding)),
            snapshot,
        };
    }
}
exports.TaxEngine = TaxEngine;
function applyPayableRounding(exactTotal, pack, currency) {
    const places = currency !== undefined ? (0, countries_1.getCurrencyFractionDigits)(currency) : pack.taxRounding.decimalPlaces;
    const cleaned = new TaxDecimal(exactTotal).toDecimalPlaces(places, decimal_js_1.default.ROUND_HALF_UP);
    const rounded = roundIncrement(cleaned, resolvePayableIncrement(pack, currency), pack.payableRounding.method);
    return {
        total: rounded.toNumber(),
        adjustment: rounded.minus(cleaned).toNumber(),
    };
}
//# sourceMappingURL=tax-engine.js.map