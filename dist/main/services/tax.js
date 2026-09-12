"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TAX_ID_LENGTH = void 0;
exports.getActiveCountryPack = getActiveCountryPack;
exports.isTaxModuleActiveForCountry = isTaxModuleActiveForCountry;
exports.resolveTaxIdFormat = resolveTaxIdFormat;
exports.validateTaxRegistrationNumber = validateTaxRegistrationNumber;
exports.previewCategoryRate = previewCategoryRate;
exports.hasConfiguredTaxCategories = hasConfiguredTaxCategories;
exports.calculateItemTax = calculateItemTax;
exports.getConfiguredChargeTaxCategories = getConfiguredChargeTaxCategories;
exports.normalizeChargeAmount = normalizeChargeAmount;
exports.calculateConfiguredChargeTaxes = calculateConfiguredChargeTaxes;
exports.aggregateTaxBreakdown = aggregateTaxBreakdown;
exports.aggregateTaxSnapshots = aggregateTaxSnapshots;
exports.invertTaxSnapshot = invertTaxSnapshot;
exports.invertTaxBreakdown = invertTaxBreakdown;
exports.scaleTaxBreakdowns = scaleTaxBreakdowns;
exports.scaleTaxSnapshots = scaleTaxSnapshots;
exports.combineItemAndChargeTaxes = combineItemAndChargeTaxes;
exports.calculateTaxPreview = calculateTaxPreview;
const decimal_js_1 = __importDefault(require("decimal.js"));
const db_1 = require("../db");
const bundled_1 = require("../tax-packs/bundled");
const countries_1 = require("../countries");
const tax_engine_1 = require("./tax-engine");
function round(value, decimals = 2) {
    if (typeof value !== 'number' || isNaN(value) || !isFinite(value))
        return 0;
    return Number(Math.round(Number(value + 'e' + decimals)) + 'e-' + decimals);
}
// Same country -> bundled-pack selection used by calculateItemTax below and
// by the GET /api/tax/categories endpoint (routes/index.ts) — kept as one
// function so the two never drift apart on which pack is "active".
function getActiveCountryPack(country) {
    try {
        const db = (0, db_1.getDatabase)();
        const row = db.prepare(`
      SELECT version.pack_json
      FROM country_packs AS pack
      JOIN country_pack_versions AS version ON version.id = pack.active_version_id
      WHERE pack.country IN (?, '*') AND pack.status = 'active'
      ORDER BY CASE WHEN pack.country = ? THEN 0 ELSE 1 END, pack.updated_at DESC
      LIMIT 1
    `).get(country, country);
        if (row)
            return JSON.parse(row.pack_json);
    }
    catch {
        // Database initialization and isolated unit tests can call this before the
        // migration runner has registered bundled packs. The immutable bundled
        // JSON remains the required offline fallback.
    }
    return (0, bundled_1.getBundledCountryPack)(country);
}
// "The taxation module is enabled" means an official (non-local) pack is
// actually active for this country — the bundled/manual local pack never
// carries a verified registration-number format, so it never gates entry.
function isTaxModuleActiveForCountry(country) {
    if ((0, db_1.getSettingValue)('taxes_enabled') !== 'true')
        return false;
    try {
        return getActiveCountryPack(country).publisher !== 'local';
    }
    catch {
        return false;
    }
}
function resolveTaxIdFormat(country) {
    if (!isTaxModuleActiveForCountry(country))
        return null;
    return getActiveCountryPack(country).registrationNumberFormat
        || (0, countries_1.getCountryByCode)(country)?.taxIdFormat
        || null;
}
// check 25 (routes/tax-packs.ts) rejects the textbook nested-quantifier
// ReDoS shape at pack-activation time, but that's a known-shape heuristic,
// not a formal safety proof — bound the value as a backstop too. The
// longest real registration-number scheme is 15 chars (India GSTIN), so 24
// leaves generous headroom while keeping a worst-case pattern's
// backtracking imperceptible (CodeQL js/polynomial-redos; same
// bound-before-regex approach as isValidEmail in routes/auth.ts).
exports.MAX_TAX_ID_LENGTH = 24;
function validateTaxRegistrationNumber(country, value) {
    const format = resolveTaxIdFormat(country);
    if (!format || !value)
        return { valid: true, format };
    const trimmed = value.trim();
    if (trimmed.length > exports.MAX_TAX_ID_LENGTH)
        return { valid: false, format };
    let regex;
    try {
        regex = new RegExp(format.pattern, 'i');
    }
    catch {
        return { valid: true, format: null };
    }
    return { valid: regex.test(trimmed), format };
}
// A representative rate for display only (product tax-category picker,
// products list) — the intrastate/default rule set for this business type,
// summing every matching percent component (e.g. Tax 1 + Tax 2). Authoritative
// calculation always goes through TaxEngine.calculate, which also resolves
// the interstate variant per transaction; this never feeds a checkout total.
//
// Rule selection here mirrors calculateRawLine (tax-engine.ts): a rule only
// counts if the *category* declares it via category.ruleIds, not just if the
// rule declares the category via rule.categoryIds. A well-formed pack always
// keeps both sides in sync, but selecting only by rule.categoryIds would show
// a rate for a rule checkout actually excludes for any pack where they've
// drifted (e.g. a hand-edited or malformed catalog pack) — showing a price
// the merchant never actually charges.
function previewCategoryRate(pack, businessType, categoryId) {
    const category = pack.categories.find((candidate) => candidate.id === categoryId);
    if (!category)
        return null;
    const ruleById = new Map(pack.rules.map((rule) => [rule.id, rule]));
    const percentRules = category.ruleIds.reduce((acc, ruleId) => {
        const rule = ruleById.get(ruleId);
        if (!rule || rule.type !== 'percent' || !rule.categoryIds.includes(categoryId))
            return acc;
        const conditions = rule.conditions;
        if (conditions) {
            if (conditions.businessTypes && !conditions.businessTypes.includes(businessType))
                return acc;
            if (conditions.customerStateRelation === 'interstate')
                return acc;
        }
        acc.push(rule);
        return acc;
    }, []);
    if (percentRules.length === 0)
        return null;
    const percent = percentRules.reduce((sum, rule) => sum + Number(rule.rate || 0), 0);
    return {
        percent: Math.round(percent * 100) / 100,
        label: percentRules.map((rule) => `${rule.label} ${rule.rate}%`).join(' + '),
    };
}
function hasConfiguredTaxCategories(pack, businessType) {
    return pack.categories.some((category) => category.ruleIds.some((ruleId) => {
        const rule = pack.rules.find((candidate) => candidate.id === ruleId);
        return Boolean(rule
            && (!rule.conditions?.businessTypes || rule.conditions.businessTypes.includes(businessType)));
    }));
}
function calculateItemTax(tenant, product, taxableAmount, customer) {
    if (!tenant.taxes_enabled) {
        return { tax_amount: 0, tax_breakdown: [], tax_type: 'none', tax_snapshot: null };
    }
    const taxCategoryId = product.tax_category_id || product.tax_category;
    const pack = getActiveCountryPack(tenant.country);
    let merchantOverride = null;
    if (product.id !== undefined && product.id !== null) {
        try {
            const db = (0, db_1.getDatabase)();
            const row = db.prepare(`
        SELECT override.id, override.value_json
        FROM tax_overrides AS override
        JOIN country_packs AS pack ON pack.active_version_id = override.pack_version_id
        WHERE pack.id = ?
          AND override.entity_type = 'product'
          AND override.entity_id = ?
          AND override.field_name = 'tax_category_id'
        ORDER BY override.updated_at DESC
        LIMIT 1
      `).get(pack.id, String(product.id));
            if (row) {
                const value = JSON.parse(row.value_json);
                const categoryId = typeof value === 'string' ? value : value?.categoryId;
                if (typeof categoryId === 'string' && categoryId) {
                    merchantOverride = { id: row.id, categoryId };
                }
            }
        }
        catch {
            // An unavailable override table is possible only before migrations or
            // in isolated unit tests; normal checkout databases always have it.
        }
    }
    if (taxCategoryId || merchantOverride) {
        let calculation;
        try {
            calculation = tax_engine_1.TaxEngine.calculate({
                pack,
                currency: tenant.currency,
                country: tenant.country,
                businessType: tenant.business_type,
                storeStateCode: tenant.state_code,
                transactionDate: new Date().toISOString(),
                customer: customer
                    ? {
                        registrationNumber: customer.taxRegistrationNumber,
                        stateCode: customer.customer_state_code,
                    }
                    : null,
                lines: [{
                        lineId: 'legacy-item-adapter',
                        kind: 'product',
                        quantity: '1',
                        unitPrice: String(taxableAmount),
                        merchantCategoryId: merchantOverride?.categoryId,
                        productCategoryId: taxCategoryId,
                        taxBehavior: product.tax_behavior || 'country_default',
                    }],
            });
        }
        catch (engineError) {
            // A misconfigured category/pack is a data problem, not a server bug —
            // checkout must block loudly on a bad tax config, never fall through
            // to charging zero tax. statusCode lets route handlers return 400
            // instead of a generic 500 (see orders.ts / index.ts catch blocks).
            throw Object.assign(new Error(`Tax calculation failed: ${engineError.message}`), { statusCode: 400 });
        }
        const line = calculation.lines[0];
        if (line.taxBehavior !== 'exempt' && line.components.length === 0) {
            throw Object.assign(new Error(`Tax calculation failed: no tax rules apply to category ${line.categoryId} for business type ${tenant.business_type}`), { statusCode: 400 });
        }
        return {
            tax_amount: Number(line.taxAmount),
            tax_breakdown: line.components.map((component) => ({
                title: component.label,
                rate: Number(component.rate || 0),
                amount: Number(component.amount),
            })),
            // The engine resolves country_default against the active pack. Persist
            // that effective behavior on the order item so every later total
            // recomputation knows whether the tax is already included in the price.
            tax_type: line.taxBehavior === 'exempt' ? 'none' : line.taxBehavior,
            tax_snapshot: {
                ...calculation.snapshot,
                merchantOverridesApplied: merchantOverride ? [{
                        overrideId: merchantOverride.id,
                        entityType: 'product',
                        entityId: String(product.id),
                        fieldName: 'tax_category_id',
                        categoryId: merchantOverride.categoryId,
                    }] : [],
            },
        };
    }
    // Tax is opt-in through a resolved category. Legacy product.tax_type and
    // product.tax_rate columns remain in the schema only for non-destructive
    // upgrade compatibility; they are not authoritative for new transactions.
    return { tax_amount: 0, tax_breakdown: [], tax_type: 'none', tax_snapshot: null };
}
const CHARGE_KINDS = ['packaging', 'delivery', 'service_charge'];
function getConfiguredChargeTaxCategories(country) {
    if ((0, db_1.getSettingValue)('taxes_enabled') !== 'true')
        return {};
    const pack = getActiveCountryPack(country);
    try {
        const rows = (0, db_1.getDatabase)().prepare(`
      SELECT override.id, override.entity_type, override.value_json
      FROM tax_overrides AS override
      JOIN country_packs AS country_pack
        ON country_pack.active_version_id = override.pack_version_id
      WHERE country_pack.id = ?
        AND override.entity_type IN ('packaging', 'delivery', 'service_charge')
        AND override.entity_id IS NULL
        AND override.field_name = 'tax_category_id'
      ORDER BY override.updated_at DESC
    `).all(pack.id);
        const configured = {};
        for (const row of rows) {
            if (configured[row.entity_type])
                continue;
            try {
                const value = JSON.parse(row.value_json);
                const categoryId = typeof value === 'string' ? value : value?.categoryId;
                if (typeof categoryId === 'string' && categoryId) {
                    configured[row.entity_type] = { categoryId, overrideId: row.id };
                }
            }
            catch { }
        }
        return configured;
    }
    catch {
        return {};
    }
}
function normalizeChargeAmount(value, kind) {
    if (value === undefined || value === null || value === '')
        return 0;
    if (typeof value !== 'number' && typeof value !== 'string') {
        throw Object.assign(new Error(`${kind} charge must be a non-negative finite amount`), { statusCode: 400 });
    }
    try {
        const amount = new decimal_js_1.default(value);
        if (!amount.isFinite() || amount.isNegative()) {
            throw new Error(`${kind} charge must be a non-negative finite amount`);
        }
        const numericAmount = amount.toNumber();
        if (!Number.isFinite(numericAmount)) {
            throw new Error(`${kind} charge must be a non-negative finite amount`);
        }
        return numericAmount;
    }
    catch (error) {
        throw Object.assign(new Error(error.message || `${kind} charge is invalid`), { statusCode: 400 });
    }
}
function chargeAmount(context, kind) {
    const amountKey = kind === 'service_charge'
        ? 'service_charge'
        : `${kind}_charge`;
    return new decimal_js_1.default(normalizeChargeAmount(context[amountKey], kind));
}
function chargeCategoryId(context, kind) {
    const value = context[`${kind}_tax_category_id`];
    return typeof value === 'string' && value ? value : null;
}
function calculateConfiguredChargeTaxes(tenant, context, customer) {
    const pack = getActiveCountryPack(tenant.country);
    const breakdowns = [];
    const snapshotJson = [];
    let taxAmount = new decimal_js_1.default(0);
    let exclusiveTaxAmount = new decimal_js_1.default(0);
    for (const kind of CHARGE_KINDS) {
        const amount = chargeAmount(context, kind);
        const categoryId = chargeCategoryId(context, kind);
        // NULL means this order remains on the legacy path. Charges were
        // previously added untaxed, so preserve that behavior until the merchant
        // explicitly migrates this charge kind in Settings.
        if (amount.isZero() || !categoryId)
            continue;
        let calculation;
        try {
            calculation = tax_engine_1.TaxEngine.calculate({
                pack,
                currency: tenant.currency,
                country: tenant.country,
                businessType: tenant.business_type,
                storeStateCode: tenant.state_code,
                transactionDate: new Date().toISOString(),
                customer: customer
                    ? {
                        registrationNumber: customer.taxRegistrationNumber,
                        stateCode: customer.customer_state_code,
                    }
                    : null,
                lines: [{
                        lineId: `charge:${kind}`,
                        kind,
                        quantity: '1',
                        unitPrice: amount.toString(),
                        merchantCategoryId: categoryId,
                        taxBehavior: 'country_default',
                    }],
            });
        }
        catch (engineError) {
            throw Object.assign(new Error(`Tax calculation failed for ${kind}: ${engineError.message}`), { statusCode: 400 });
        }
        const line = calculation.lines[0];
        if (line.taxBehavior !== 'exempt' && line.components.length === 0) {
            throw Object.assign(new Error(`Tax calculation failed: no tax rules apply to ${kind} category ${line.categoryId}`), { statusCode: 400 });
        }
        const lineTax = new decimal_js_1.default(line.taxAmount);
        taxAmount = taxAmount.plus(lineTax);
        if (line.taxBehavior !== 'inclusive')
            exclusiveTaxAmount = exclusiveTaxAmount.plus(lineTax);
        breakdowns.push(line.components.map((component) => ({
            title: component.label,
            rate: Number(component.rate || 0),
            amount: Number(component.amount),
        })));
        snapshotJson.push(JSON.stringify({
            ...calculation.snapshot,
            chargeKind: kind,
            configuredCategoryId: categoryId,
        }));
    }
    return {
        taxAmount: taxAmount.toNumber(),
        exclusiveTaxAmount: exclusiveTaxAmount.toNumber(),
        breakdowns,
        snapshotJson,
    };
}
function aggregateTaxBreakdown(itemBreakdowns, minorFactor = 100) {
    const merged = {};
    for (const breakdown of itemBreakdowns) {
        if (!Array.isArray(breakdown))
            continue;
        for (const line of breakdown) {
            if (!line || typeof line.amount !== 'number' || !Number.isFinite(line.amount))
                continue;
            const key = `${line.title}_${line.rate}`;
            if (!merged[key]) {
                merged[key] = { title: line.title, rate: line.rate, amount: 0 };
            }
            merged[key].amount = round(merged[key].amount + line.amount, 4);
        }
    }
    return Object.values(merged).map((line) => ({
        ...line,
        amount: round(line.amount, Math.log10(minorFactor)),
    }));
}
// Rolls up whichever active order_items carry a per-item engine snapshot
// (order_items.tax_snapshot, only present for category-driven items — see
// calculateItemTax above) into the order/bill-level tax_snapshot column.
// Uncategorized items are tax-free and therefore have no snapshot to roll up.
function aggregateTaxSnapshots(itemSnapshotsJson) {
    const snapshots = itemSnapshotsJson
        .map((raw) => {
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    })
        .filter((snapshot) => snapshot !== null);
    return snapshots.length > 0 ? JSON.stringify(snapshots) : null;
}
// A prepared-item void is represented by a new negative order_item. Mirror
// the immutable tax evidence with signed amounts as well, otherwise the
// order-level snapshot would still claim positive tax after the rows net to 0.
function invertTaxSnapshot(raw) {
    if (!raw)
        return null;
    try {
        const snapshot = JSON.parse(raw);
        if (!snapshot || !Array.isArray(snapshot.lines))
            return null;
        const negate = (value) => {
            if (typeof value !== 'string' && typeof value !== 'number')
                return value;
            return new decimal_js_1.default(value).negated().toString();
        };
        snapshot.lines = snapshot.lines.map((line) => ({
            ...line,
            lineId: `${line.lineId}:void-adjustment`,
            grossAmount: negate(line.grossAmount),
            taxableBase: negate(line.taxableBase),
            taxAmount: negate(line.taxAmount),
            components: Array.isArray(line.components)
                ? line.components.map((component) => ({
                    ...component,
                    amount: negate(component.amount),
                    roundingRemainder: negate(component.roundingRemainder),
                }))
                : line.components,
        }));
        return JSON.stringify(snapshot);
    }
    catch {
        return null;
    }
}
function invertTaxBreakdown(raw) {
    if (!raw)
        return null;
    try {
        const breakdown = JSON.parse(raw);
        if (!Array.isArray(breakdown))
            return null;
        return JSON.stringify(breakdown.map((component) => ({
            ...component,
            amount: new decimal_js_1.default(component.amount || 0).negated().toNumber(),
        })));
    }
    catch {
        return null;
    }
}
function scaleTaxBreakdowns(breakdowns, ratio, targetTaxAmount, minorFactor = 100) {
    const decimals = Math.log10(minorFactor);
    const cloned = breakdowns.map((breakdown) => Array.isArray(breakdown)
        ? breakdown.map((component) => ({ ...component }))
        : breakdown);
    const entries = [];
    const scale = new decimal_js_1.default(ratio);
    cloned.forEach((breakdown, outerIndex) => {
        if (!Array.isArray(breakdown))
            return;
        breakdown.forEach((component, innerIndex) => {
            const rawAmount = new decimal_js_1.default(component.amount || 0).mul(scale);
            const rounded = rawAmount.toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP);
            entries.push({
                component,
                rounded,
                remainder: rawAmount.minus(rounded),
                outerIndex,
                innerIndex,
            });
        });
    });
    if (entries.length === 0)
        return cloned;
    const roundedTotal = entries.reduce((sum, entry) => sum.plus(entry.rounded), new decimal_js_1.default(0));
    const minorDelta = new decimal_js_1.default(targetTaxAmount)
        .minus(roundedTotal)
        .mul(minorFactor)
        .toDecimalPlaces(0, decimal_js_1.default.ROUND_HALF_UP)
        .toNumber();
    const direction = Math.sign(minorDelta);
    const allocationOrder = [...entries].sort((left, right) => {
        const remainderOrder = direction >= 0
            ? right.remainder.comparedTo(left.remainder)
            : left.remainder.comparedTo(right.remainder);
        if (remainderOrder !== 0)
            return remainderOrder;
        const titleOrder = String(left.component.title || '').localeCompare(String(right.component.title || ''));
        if (titleOrder !== 0)
            return titleOrder;
        return left.outerIndex - right.outerIndex || left.innerIndex - right.innerIndex;
    });
    for (let index = 0; index < Math.abs(minorDelta); index++) {
        const entry = allocationOrder[index % allocationOrder.length];
        entry.rounded = entry.rounded.plus(direction / minorFactor);
    }
    for (const entry of entries)
        entry.component.amount = entry.rounded.toNumber();
    return cloned;
}
function scaleTaxSnapshots(snapshotsJson, ratio, minorFactor = 100) {
    const snapshots = snapshotsJson.flatMap((raw) => {
        if (!raw)
            return [];
        try {
            const snapshot = JSON.parse(raw);
            return snapshot && Array.isArray(snapshot.lines) ? [snapshot] : [];
        }
        catch {
            return [];
        }
    });
    const scale = new decimal_js_1.default(ratio);
    const decimals = Math.log10(minorFactor);
    const entries = [];
    for (const snapshot of snapshots) {
        for (const line of snapshot.lines) {
            if (!Array.isArray(line.components))
                continue;
            for (const component of line.components) {
                const raw = new decimal_js_1.default(component.amount || 0).mul(scale);
                const rounded = raw.toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP);
                entries.push({ component, line, raw, rounded, remainder: raw.minus(rounded) });
            }
        }
    }
    if (entries.length > 0) {
        const targetTaxAmount = entries.reduce((sum, entry) => sum.plus(new decimal_js_1.default(entry.component.amount || 0)), new decimal_js_1.default(0)).mul(scale).toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP);
        const roundedTotal = entries.reduce((sum, entry) => sum.plus(entry.rounded), new decimal_js_1.default(0));
        const centsDelta = targetTaxAmount
            .minus(roundedTotal)
            .mul(minorFactor)
            .toDecimalPlaces(0, decimal_js_1.default.ROUND_HALF_UP)
            .toNumber();
        const direction = Math.sign(centsDelta);
        const ordered = [...entries].sort((left, right) => {
            const remainderOrder = direction >= 0
                ? right.remainder.comparedTo(left.remainder)
                : left.remainder.comparedTo(right.remainder);
            if (remainderOrder !== 0)
                return remainderOrder;
            const ruleOrder = String(left.component.ruleId || '').localeCompare(String(right.component.ruleId || ''));
            if (ruleOrder !== 0)
                return ruleOrder;
            return String(left.line.lineId || '').localeCompare(String(right.line.lineId || ''));
        });
        for (let index = 0; index < Math.abs(centsDelta); index += 1) {
            const entry = ordered[index % ordered.length];
            entry.rounded = entry.rounded.plus(direction / minorFactor);
        }
        for (const entry of entries) {
            entry.component.amount = entry.rounded.toFixed(decimals);
            entry.component.roundingRemainder = entry.raw.minus(entry.rounded).toString();
        }
    }
    for (const snapshot of snapshots) {
        for (const line of snapshot.lines) {
            const scaleValue = (value) => {
                if (typeof value !== 'string' && typeof value !== 'number')
                    return value;
                return new decimal_js_1.default(value).mul(scale).toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP).toFixed(decimals);
            };
            line.grossAmount = scaleValue(line.grossAmount);
            line.taxableBase = scaleValue(line.taxableBase);
            if (Array.isArray(line.components)) {
                line.taxAmount = line.components.reduce((sum, component) => sum.plus(component.amount || 0), new decimal_js_1.default(0)).toFixed(decimals);
            }
            else {
                line.taxAmount = scaleValue(line.taxAmount);
            }
        }
    }
    return snapshots.map((snapshot) => JSON.stringify(snapshot));
}
function combineItemAndChargeTaxes(args) {
    const scaledBreakdowns = scaleTaxBreakdowns(args.itemBreakdowns, args.itemTaxRatio, args.itemTaxAmount, args.minorFactor);
    const scaledSnapshots = scaleTaxSnapshots(args.itemSnapshots, args.itemTaxRatio, args.minorFactor);
    const nonEmptyBreakdowns = [
        ...scaledBreakdowns,
        ...args.chargeTaxes.breakdowns,
    ].filter((breakdown) => Array.isArray(breakdown) && breakdown.length > 0);
    return {
        taxAmount: new decimal_js_1.default(args.itemTaxAmount).plus(args.chargeTaxes.taxAmount).toNumber(),
        exclusiveTaxAmount: new decimal_js_1.default(args.itemExclusiveTaxAmount)
            .plus(args.chargeTaxes.exclusiveTaxAmount)
            .toNumber(),
        breakdowns: nonEmptyBreakdowns,
        snapshotJson: aggregateTaxSnapshots([...scaledSnapshots, ...args.chargeTaxes.snapshotJson]),
    };
}
// Tax preview endpoint handler
async function calculateTaxPreview(req, res) {
    try {
        const { items, customer_id, packaging_charge, delivery_charge, service_charge, discount_type, discount_value, } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            res.status(400).json({ error: 'Items are required' });
            return;
        }
        const db = (0, db_1.getDatabase)();
        // Get settings
        const settings = {};
        db.prepare('SELECT key, value FROM settings').all().forEach((row) => {
            settings[row.key] = row.value;
        });
        const tenantInfo = {
            country: settings.country || 'IN',
            business_type: settings.business_type || 'restaurant',
            state_code: settings.state_code || '',
            taxes_enabled: settings.taxes_enabled === 'true',
        };
        const currency = settings.currency && /^[A-Z]{3}$/.test(settings.currency)
            ? settings.currency
            : (0, countries_1.getCountryByCode)(tenantInfo.country)?.currency || 'INR';
        tenantInfo.currency = currency;
        const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
        const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)(currency);
        const customer = customer_id
            ? db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id)
            : null;
        const itemResults = [];
        const allBreakdowns = [];
        const allTaxSnapshots = [];
        let totalSubtotal = 0;
        let totalTax = 0;
        let totalExclusiveTax = 0;
        for (const itemData of items) {
            if (!itemData || typeof itemData !== 'object' || !itemData.product_id) {
                continue;
            }
            const product = db.prepare('SELECT * FROM products WHERE id = ?').get(itemData.product_id);
            if (!product) {
                console.warn(`[TaxPreview] Product with ID ${itemData.product_id} not found in database.`);
                continue;
            }
            const unitPrice = parseFloat(product.price) || 0;
            const rawQty = Number(itemData.quantity);
            const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
            const rawDisc = Number(itemData.discount_amount);
            const itemDiscount = Number.isFinite(rawDisc) && rawDisc >= 0 ? rawDisc : 0;
            let subtotal = unitPrice * quantity;
            if (itemData.addons) {
                for (const addon of itemData.addons) {
                    subtotal += (addon.price || 0) * (addon.quantity || 1) * quantity;
                }
            }
            subtotal = Math.max(0, subtotal - itemDiscount);
            const taxResult = calculateItemTax(tenantInfo, product, subtotal, customer || null);
            itemResults.push({
                product_id: product.id,
                product_name: product.name,
                quantity,
                unit_price: unitPrice,
                subtotal: round(subtotal, decimals),
                discount_amount: itemDiscount,
                tax_amount: taxResult.tax_amount,
                tax_breakdown: taxResult.tax_breakdown,
                tax_type: taxResult.tax_type,
                total: round(subtotal + (taxResult.tax_type === 'inclusive' ? 0 : taxResult.tax_amount), decimals),
            });
            if (taxResult.tax_breakdown) {
                allBreakdowns.push(taxResult.tax_breakdown);
            }
            allTaxSnapshots.push(taxResult.tax_snapshot ? JSON.stringify(taxResult.tax_snapshot) : null);
            totalSubtotal += subtotal;
            totalTax += taxResult.tax_amount;
            if (taxResult.tax_type !== 'inclusive') {
                totalExclusiveTax += taxResult.tax_amount;
            }
        }
        const packaging = normalizeChargeAmount(packaging_charge, 'packaging');
        const delivery = normalizeChargeAmount(delivery_charge, 'delivery');
        const service = normalizeChargeAmount(service_charge, 'service_charge');
        let discountAmount = new decimal_js_1.default(0);
        if (discount_type !== undefined || discount_value !== undefined) {
            if (!['percentage', 'amount'].includes(discount_type)) {
                res.status(400).json({ error: 'discount_type must be percentage or amount' });
                return;
            }
            const parsedDiscount = Number(discount_value);
            if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0) {
                res.status(400).json({ error: 'discount_value must be a finite non-negative number' });
                return;
            }
            const subtotalDecimal = new decimal_js_1.default(totalSubtotal);
            if (discount_type === 'percentage') {
                if (parsedDiscount > 100) {
                    res.status(400).json({ error: 'discount_value must not exceed 100 percent' });
                    return;
                }
                discountAmount = subtotalDecimal.mul(parsedDiscount).div(100);
            }
            else {
                discountAmount = decimal_js_1.default.min(new decimal_js_1.default(parsedDiscount), subtotalDecimal);
            }
            discountAmount = discountAmount.toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP);
        }
        const subtotalDecimal = new decimal_js_1.default(totalSubtotal);
        const discountedSubtotal = decimal_js_1.default.max(0, subtotalDecimal.minus(discountAmount));
        const taxRatio = discountAmount.gt(0) && subtotalDecimal.gt(0)
            ? discountedSubtotal.div(subtotalDecimal)
            : new decimal_js_1.default(1);
        const discountedItemTax = new decimal_js_1.default(totalTax)
            .mul(taxRatio)
            .toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP)
            .toNumber();
        const discountedExclusiveTax = new decimal_js_1.default(totalExclusiveTax)
            .mul(taxRatio)
            .toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP)
            .toNumber();
        const chargeCategories = getConfiguredChargeTaxCategories(tenantInfo.country);
        const chargeTaxes = calculateConfiguredChargeTaxes(tenantInfo, {
            packaging_charge: packaging,
            delivery_charge: delivery,
            service_charge: service,
            packaging_tax_category_id: chargeCategories.packaging?.categoryId || null,
            delivery_tax_category_id: chargeCategories.delivery?.categoryId || null,
            service_charge_tax_category_id: chargeCategories.service_charge?.categoryId || null,
        }, customer || null);
        const taxRollup = combineItemAndChargeTaxes({
            itemTaxAmount: discountedItemTax,
            itemExclusiveTaxAmount: discountedExclusiveTax,
            itemBreakdowns: allBreakdowns,
            itemSnapshots: allTaxSnapshots,
            itemTaxRatio: taxRatio.toNumber(),
            chargeTaxes,
            minorFactor,
        });
        const aggregatedBreakdown = aggregateTaxBreakdown(taxRollup.breakdowns, minorFactor);
        const exactTotal = discountedSubtotal
            .plus(taxRollup.exclusiveTaxAmount)
            .plus(packaging)
            .plus(delivery)
            .plus(service)
            .toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP)
            .toNumber();
        const pack = getActiveCountryPack(tenantInfo.country);
        const { total, adjustment: roundOff } = (0, tax_engine_1.applyPayableRounding)(exactTotal, pack, currency);
        res.json({
            items: itemResults,
            summary: {
                subtotal: round(totalSubtotal, decimals),
                discount_amount: discountAmount.toNumber(),
                discounted_subtotal: discountedSubtotal.toNumber(),
                tax_amount: round(taxRollup.taxAmount, decimals),
                tax_breakdown: aggregatedBreakdown,
                packaging_charge: packaging,
                delivery_charge: delivery,
                service_charge: service,
                round_off: roundOff,
                total,
            },
        });
    }
    catch (error) {
        console.error('[Tax] Preview error:', error);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Internal server error" });
    }
}
//# sourceMappingURL=tax.js.map