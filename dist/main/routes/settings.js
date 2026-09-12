"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.settingsRoutes = void 0;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const db_1 = require("../db");
const cloud_sync_1 = require("../services/cloud-sync");
const google_drive_1 = require("../services/google-drive");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const master_pin_1 = require("../middleware/master-pin");
const tax_1 = require("../services/tax");
const telemetry_1 = require("../services/telemetry");
const countries_1 = require("../countries");
const country_provenance_1 = require("../services/country-provenance");
const shutdown_1 = require("../shutdown");
const async_handler_1 = require("../middleware/async-handler");
const phone_1 = require("../lib/phone");
const print_templates_1 = require("../services/print-templates");
const merchant_print_templates_1 = require("../services/merchant-print-templates");
const print_language_settings_1 = require("../lib/print-language-settings");
const title_bar_theme_1 = require("../title-bar-theme");
const router = (0, express_1.Router)();
const settingsReadRateLimit = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
const configuredSettingsWriteLimit = Number.parseInt(process.env.FLO_SETTINGS_WRITE_RATE_LIMIT_MAX || '', 10);
const settingsWriteRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: Number.isFinite(configuredSettingsWriteLimit) && configuredSettingsWriteLimit > 0
        ? configuredSettingsWriteLimit
        : 60,
    standardHeaders: true,
    legacyHeaders: false,
});
// ── Helpers ────────────────────────────────────────────────────────────────
function getAllSettings(db) {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const s = {};
    for (const row of rows)
        s[row.key] = row.value;
    return s;
}
function upsertSettings(db, entries) {
    const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
    db.transaction(() => {
        for (const [key, val] of Object.entries(entries)) {
            if (val !== undefined)
                stmt.run(key, val === null ? '' : String(val), (0, db_1.now)());
        }
    })();
}
function validBusinessLocation(timezone, currency, country) {
    if (timezone !== undefined && !(0, countries_1.isValidTimeZone)(timezone))
        return false;
    if (currency !== undefined && (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)))
        return false;
    if (country !== undefined && (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)))
        return false;
    return true;
}
const SENSITIVE_SETTING_KEYS = new Set([
    'jwt_secret',
    'cloud_api_key',
    'cloud_device_secret',
    'cloud_deletion_status_token',
    'cloud_last_error',
]);
const OPTIONAL_SETTING_DEFAULTS = {
    bill_template: 'classic',
    bill_footer_message: '',
    printer_trim_decimals: 'false',
    split_checks_enabled: 'false',
    // Print language policies (#441) — inherit store language, no second
    // language. Defaults preserve pre-policy behavior for existing tenants.
    [print_language_settings_1.BILL_LANGUAGE_POLICY_KEY]: (0, print_language_settings_1.defaultLanguagePolicySettingJson)(),
    [print_language_settings_1.KOT_LANGUAGE_POLICY_KEY]: (0, print_language_settings_1.defaultLanguagePolicySettingJson)(),
    // Iran locale display preferences (Batch G, Refs #241) — display-only.
    currency_display: 'rial',
    number_digits: 'locale',
    calendar: 'locale',
    // No row until the user first changes it; 'system' is the renderer's own
    // default (frontend/src/store/theme.ts), so a GET before that point should
    // return it rather than 404.
    theme_mode: 'system',
};
function maskSetting(key, value) {
    if (key === 'cloud_last_error')
        return value ? 'Cloud service request failed' : '';
    if (!SENSITIVE_SETTING_KEYS.has(key))
        return value;
    return value ? `****${value.slice(-4)}` : '';
}
function publicSettingsShape(settings) {
    const publicSettings = {};
    for (const [key, value] of Object.entries(settings)) {
        publicSettings[key] = maskSetting(key, value);
    }
    return publicSettings;
}
function boolFlag(value) {
    if (value === undefined)
        return undefined;
    if (typeof value === 'string') {
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) ? 'true' : 'false';
    }
    return value ? 'true' : 'false';
}
// Country-scoped locale display preferences (#390). A region without declared
// localeOptions supports only the neutral default for each group: canonical
// currency unit (rial), locale digits, and locale calendar.
const NEUTRAL_LOCALE_PREFERENCES = {
    currency_display: 'rial',
    number_digits: 'locale',
    calendar: 'locale',
};
const LOCALE_OPTION_FIELDS = {
    currency_display: 'currencyDisplay',
    number_digits: 'digits',
    calendar: 'calendar',
};
function isLocalePreferenceKey(key) {
    return key === 'currency_display' || key === 'number_digits' || key === 'calendar';
}
function isLocalePreferenceSupported(key, value, countryCode) {
    if (value === NEUTRAL_LOCALE_PREFERENCES[key])
        return true;
    const options = (0, countries_1.getCountryByCode)(countryCode)?.localeOptions?.[LOCALE_OPTION_FIELDS[key]];
    return Array.isArray(options) && options.includes(value);
}
function resolveStoredLocalePreference(key, stored, countryCode) {
    if (stored && isLocalePreferenceSupported(key, stored, countryCode))
        return stored;
    return NEUTRAL_LOCALE_PREFERENCES[key];
}
// cloud_sync_enabled/cloud_orders_enabled/cloud_reports_enabled/cloud_command_polling_enabled
// mirror FloAdmin's own `stores` table and are read elsewhere (cloud-sync.ts) as a strict
// '1' check, not boolFlag()'s 'true'/'false' — keep this route's writes on that convention.
function bool01Flag(value) {
    const flag = boolFlag(value);
    return flag === undefined ? undefined : flag === 'true' ? '1' : '0';
}
function deriveCurrencySymbol(currency, country) {
    return (0, countries_1.getCurrencySymbol)(currency || 'INR', (0, countries_1.getCountryByCode)(country || 'IN')?.locale) || currency || 'INR';
}
function isMaskedSecret(value) {
    return typeof value === 'string' && value.startsWith('****');
}
function businessShape(s) {
    return {
        business_name: s.business_name || '',
        timezone: s.timezone || 'Asia/Kolkata',
        currency: s.currency || 'INR',
        country: s.country || 'IN',
        language: s.language || 'en',
        tax_registration_number: s.tax_registration_number || '',
        state_code: s.state_code || '',
        business_address: s.business_address || '',
        business_phone: s.business_phone || '',
        instagram_handle: s.instagram_handle || '',
        billing_type: s.billing_type || 'postpaid',
        tables_required: s.tables_required !== 'false',
        tax_registered: s.tax_registered === 'true' || s.tax_registered === '1',
        bill_show_name: s.bill_show_name !== 'false',
        bill_show_address: s.bill_show_address !== 'false',
        bill_show_phone: s.bill_show_phone !== 'false',
        bill_show_tax_id: s.bill_show_tax_id === 'true',
        bill_show_tax_breakdown: s.bill_show_tax_breakdown !== 'false',
        bill_show_customer_name: s.bill_show_customer_name !== 'false',
        bill_show_customer_phone: s.bill_show_customer_phone !== 'false',
        bill_show_table_number: s.bill_show_table_number !== 'false',
        currency_display: resolveStoredLocalePreference('currency_display', s.currency_display, s.country || 'IN'),
        number_digits: resolveStoredLocalePreference('number_digits', s.number_digits, s.country || 'IN'),
        calendar: resolveStoredLocalePreference('calendar', s.calendar, s.country || 'IN'),
        // Informational only — the active country pack's format if it declares
        // one, else the static main/countries.ts fallback, else null. Never
        // blocks the save; the UI uses this to show a non-blocking warning.
        tax_id_format: (0, tax_1.resolveTaxIdFormat)(s.country || 'IN'),
    };
}
function taxShape(s) {
    return {
        tax_registered: s.tax_registered === 'true',
        tax_registration_number: s.tax_registration_number || '',
        state_code: s.state_code || '',
        tax_scheme: s.tax_scheme || 'regular',
        country: s.country || 'IN',
        tax_id_format: (0, tax_1.resolveTaxIdFormat)(s.country || 'IN'),
    };
}
// ── Specific routes (must come BEFORE /:key wildcard) ─────────────────────
router.get('/business', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.allStaff), (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json(businessShape(s));
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put('/business', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { business_name, timezone, currency, country, language, tax_registration_number, state_code, business_address, business_phone, instagram_handle, billing_type, tables_required, tax_registered, bill_show_name, bill_show_address, bill_show_phone, bill_show_tax_id, bill_show_tax_breakdown, bill_show_customer_name, bill_show_customer_phone, bill_show_table_number, currency_display, number_digits, calendar } = req.body;
        if (!validBusinessLocation(timezone, currency, country)) {
            return res.status(400).json({ error: 'Invalid timezone, currency, or country' });
        }
        const db = (0, db_1.getDatabase)();
        const currentSettings = getAllSettings(db);
        const effectiveCountry = country || currentSettings.country || 'IN';
        const effectiveCurrency = currency || currentSettings.currency || 'INR';
        // Validate explicitly supplied locale preferences against the effective
        // country's declared options, and normalize stale legacy values (e.g. a
        // Toman/Persian preference left behind by an IR -> US transition).
        const localeUpdates = {};
        for (const { key, submitted } of [
            { key: 'currency_display', submitted: currency_display },
            { key: 'number_digits', submitted: number_digits },
            { key: 'calendar', submitted: calendar },
        ]) {
            if (submitted !== undefined) {
                if (typeof submitted !== 'string' || !isLocalePreferenceSupported(key, submitted, effectiveCountry)) {
                    return res.status(400).json({ error: `Invalid ${key} for country ${effectiveCountry}` });
                }
                localeUpdates[key] = submitted;
            }
            else {
                localeUpdates[key] = resolveStoredLocalePreference(key, currentSettings[key], effectiveCountry);
            }
        }
        if (tax_registration_number) {
            const { valid, format } = (0, tax_1.validateTaxRegistrationNumber)(effectiveCountry, tax_registration_number);
            if (!valid && format) {
                return res.status(400).json({
                    error: `Tax ID does not match the expected ${effectiveCountry} format: ${format.description}`,
                    tax_id_format: format,
                });
            }
        }
        let normalizedPhone = undefined;
        if (business_phone !== undefined) {
            const phoneRes = (0, phone_1.normalizeOptionalPhone)(business_phone, effectiveCountry);
            if (!phoneRes.valid) {
                return res.status(400).json({ error: phoneRes.error || 'Invalid business phone number' });
            }
            normalizedPhone = phoneRes.e164 || '';
        }
        upsertSettings(db, {
            business_name, timezone, currency, country, language,
            currency_symbol: (currency !== undefined || country !== undefined)
                ? deriveCurrencySymbol(effectiveCurrency, effectiveCountry)
                : undefined,
            tax_registration_number, state_code, business_address,
            business_phone: normalizedPhone !== undefined ? normalizedPhone : undefined,
            instagram_handle,
            billing_type, tables_required, tax_registered,
            bill_show_name, bill_show_address, bill_show_phone, bill_show_tax_id,
            bill_show_tax_breakdown, bill_show_customer_name, bill_show_customer_phone, bill_show_table_number,
            ...localeUpdates,
            // This form PUTs every field, so a merchant saving their phone number
            // re-sends the country untouched. Only a country that actually changed
            // is evidence anyone chose it.
            ...(0, country_provenance_1.countryConfirmationPatch)(country, currentSettings.country, req.body.country_selected),
        });
        cloud_sync_1.cloudSync.refreshRegistrationProfile();
        res.json(businessShape(getAllSettings(db)));
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/tax', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.allStaff), (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json(taxShape(s));
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put('/tax', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { tax_registered, tax_registration_number, state_code, tax_scheme, country } = req.body;
        if (!validBusinessLocation(undefined, undefined, country)) {
            return res.status(400).json({ error: 'Invalid country' });
        }
        const db = (0, db_1.getDatabase)();
        const currentSettings = getAllSettings(db);
        const effectiveCountry = country || currentSettings.country || 'IN';
        if (tax_registration_number) {
            const { valid, format } = (0, tax_1.validateTaxRegistrationNumber)(effectiveCountry, tax_registration_number);
            if (!valid && format) {
                return res.status(400).json({
                    error: `Tax ID does not match the expected ${effectiveCountry} format: ${format.description}`,
                    tax_id_format: format,
                });
            }
        }
        upsertSettings(db, {
            tax_registered,
            tax_registration_number,
            state_code,
            tax_scheme,
            country,
            currency_symbol: country !== undefined
                ? deriveCurrencySymbol(currentSettings.currency || 'INR', country || currentSettings.country || 'IN')
                : undefined,
        });
        cloud_sync_1.cloudSync.refreshRegistrationProfile();
        res.json(taxShape(getAllSettings(db)));
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/loyalty', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.allStaff), (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json({
            loyalty_enabled: s.loyalty_enabled === 'true' || s.loyalty_enabled === '1',
            global_cashback_percent: parseFloat(s.global_cashback_percent || '0'),
        });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put('/loyalty', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { loyalty_enabled, global_cashback_percent } = req.body;
        let finalGlobalCb = undefined;
        if (global_cashback_percent !== undefined) {
            if (typeof global_cashback_percent !== 'number' || !Number.isFinite(global_cashback_percent) || global_cashback_percent < 0 || global_cashback_percent > 100) {
                return res.status(400).json({ error: 'Global cashback percent must be a number between 0 and 100' });
            }
            finalGlobalCb = global_cashback_percent;
        }
        const db = (0, db_1.getDatabase)();
        upsertSettings(db, {
            loyalty_enabled,
            ...(finalGlobalCb !== undefined && { global_cashback_percent: String(finalGlobalCb) })
        });
        const s = getAllSettings(db);
        res.json({
            loyalty_enabled: s.loyalty_enabled === 'true' || s.loyalty_enabled === '1',
            global_cashback_percent: parseFloat(s.global_cashback_percent || '0'),
        });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ─── Discount settings ──────────────────────────────────────────────────────
router.get('/discount', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.allStaff), (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json({
            discount_max_percentage: parseFloat(s.discount_max_percentage || '25'),
            discount_max_amount: parseFloat(s.discount_max_amount || '0'),
            discount_mode: s.discount_mode || 'percentage',
            discount_requires_approval: s.discount_requires_approval === 'true' || s.discount_requires_approval === '1',
        });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put('/discount', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { discount_max_percentage, discount_max_amount, discount_mode, discount_requires_approval, } = req.body;
        // Validate inputs
        if (discount_max_percentage !== undefined) {
            const val = parseFloat(discount_max_percentage);
            if (isNaN(val) || val < 1 || val > 100) {
                return res.status(400).json({ error: 'discount_max_percentage must be a number between 1 and 100' });
            }
        }
        if (discount_max_amount !== undefined) {
            const val = parseFloat(discount_max_amount);
            if (isNaN(val) || val < 0 || val > 999999) {
                return res.status(400).json({ error: 'discount_max_amount must be a number between 0 and 999999' });
            }
        }
        if (discount_mode !== undefined && !['percentage', 'flat', 'both'].includes(discount_mode)) {
            return res.status(400).json({ error: 'discount_mode must be "percentage", "flat", or "both"' });
        }
        const db = (0, db_1.getDatabase)();
        upsertSettings(db, {
            discount_max_percentage,
            discount_max_amount,
            discount_mode,
            discount_requires_approval: discount_requires_approval === true || discount_requires_approval === 'true' ? 'true' : 'false',
        });
        const s = getAllSettings(db);
        res.json({
            discount_max_percentage: parseFloat(s.discount_max_percentage || '25'),
            discount_max_amount: parseFloat(s.discount_max_amount || '0'),
            discount_mode: s.discount_mode || 'percentage',
            discount_requires_approval: s.discount_requires_approval === 'true' || s.discount_requires_approval === '1',
        });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ─── KDS settings (must come BEFORE /:key wildcard) ─────────────────────────
// The public `/api/kds/info` already exposes `kds_default_view`, but it lives
// on the KDS server (different origin) and isn't reachable from the
// dashboard's settings page. This is the dashboard-side mirror — read-only
// from the client's perspective; the PUT below is the only mutator.
router.get('/kds', (_req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json({
            kds_default_view: s.kds_default_view === 'kanban' ? 'kanban' : 'tabs',
        });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put('/kds', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { kds_default_view } = req.body;
        if (kds_default_view !== undefined && !['tabs', 'kanban'].includes(kds_default_view)) {
            return res.status(400).json({ error: 'kds_default_view must be "tabs" or "kanban"' });
        }
        if (kds_default_view !== undefined) {
            upsertSettings((0, db_1.getDatabase)(), { kds_default_view });
        }
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json({
            kds_default_view: s.kds_default_view === 'kanban' ? 'kanban' : 'tabs',
        });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ─── Order numbering settings (must come BEFORE /:key wildcard) ─────────────
function orderNumberingShape(s) {
    return {
        order_number_prefix: s.order_number_prefix ?? 'ORD',
        order_number_include_date: s.order_number_include_date !== 'false',
        order_number_reset_daily: s.order_number_reset_daily !== 'false',
        invoice_number_prefix: s.invoice_number_prefix ?? 'INV',
        invoice_number_include_period: s.invoice_number_include_period !== 'false',
        invoice_number_reset_period: ['never', 'daily', 'monthly', 'financial_year'].includes(s.invoice_number_reset_period)
            ? s.invoice_number_reset_period
            : 'daily',
        invoice_financial_year_start_month: parseBoundedInt(s.invoice_financial_year_start_month, 1, 12, 4),
        invoice_financial_year_start_day: parseBoundedInt(s.invoice_financial_year_start_day, 1, 31, 1),
    };
}
// Letters and numbers only: the "-" separator between prefix, period segment,
// and sequence is always inserted automatically, so allowing "-"/"_" here let
// a saved prefix like "FAC-" collide with it and print as "FAC--20260101-0001".
const ORDER_NUMBER_PREFIX_PATTERN = /^[A-Za-z0-9]{0,12}$/;
const INVOICE_RESET_PERIODS = new Set(['never', 'daily', 'monthly', 'financial_year']);
function parseBoundedInt(value, min, max, fallback) {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
router.get('/order-numbering', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.allStaff), (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json(orderNumberingShape(s));
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put('/order-numbering', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { order_number_prefix, order_number_include_date, order_number_reset_daily, invoice_number_prefix, invoice_number_include_period, invoice_number_reset_period, invoice_financial_year_start_month, invoice_financial_year_start_day, } = req.body;
        if (order_number_prefix !== undefined && !ORDER_NUMBER_PREFIX_PATTERN.test(order_number_prefix)) {
            return res.status(400).json({ error: 'order_number_prefix must be up to 12 letters and numbers only' });
        }
        if (invoice_number_prefix !== undefined && !ORDER_NUMBER_PREFIX_PATTERN.test(invoice_number_prefix)) {
            return res.status(400).json({ error: 'invoice_number_prefix must be up to 12 letters and numbers only' });
        }
        if (invoice_number_reset_period !== undefined && !INVOICE_RESET_PERIODS.has(invoice_number_reset_period)) {
            return res.status(400).json({ error: 'invoice_number_reset_period must be one of never, daily, monthly, financial_year' });
        }
        if (invoice_financial_year_start_month !== undefined && parseBoundedInt(invoice_financial_year_start_month, 1, 12, NaN) !== Number(invoice_financial_year_start_month)) {
            return res.status(400).json({ error: 'invoice_financial_year_start_month must be a whole number between 1 and 12' });
        }
        if (invoice_financial_year_start_day !== undefined && parseBoundedInt(invoice_financial_year_start_day, 1, 31, NaN) !== Number(invoice_financial_year_start_day)) {
            return res.status(400).json({ error: 'invoice_financial_year_start_day must be a whole number between 1 and 31' });
        }
        const db = (0, db_1.getDatabase)();
        upsertSettings(db, {
            order_number_prefix,
            order_number_include_date: boolFlag(order_number_include_date),
            order_number_reset_daily: boolFlag(order_number_reset_daily),
            invoice_number_prefix,
            invoice_number_include_period: boolFlag(invoice_number_include_period),
            invoice_number_reset_period,
            invoice_financial_year_start_month,
            invoice_financial_year_start_day,
        });
        res.json(orderNumberingShape(getAllSettings(db)));
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
function publicDeletionRequest(request) {
    if (!request)
        return null;
    const safe = {};
    const requestId = request.request_id ?? request.id;
    if (typeof requestId === 'string' && requestId)
        safe.id = requestId;
    if (typeof request.status === 'string')
        safe.status = request.status;
    if (typeof request.requested_at === 'string')
        safe.requested_at = request.requested_at;
    if (typeof request.reviewed_at === 'string' || request.reviewed_at === null)
        safe.reviewed_at = request.reviewed_at;
    if (typeof request.decision_note === 'string')
        safe.decision_note = request.decision_note;
    return safe;
}
function publicEmailPreferences(data) {
    return {
        email: typeof data.email === 'string' ? data.email : null,
        verified: data.verified === true,
        verified_at: typeof data.verified_at === 'string' || data.verified_at === null ? data.verified_at : null,
        verification_sent_at: typeof data.verification_sent_at === 'string' || data.verification_sent_at === null ? data.verification_sent_at : null,
        product_updates: data.product_updates === true,
        marketing: data.marketing === true,
    };
}
const CLOUD_ACCOUNT_UNAVAILABLE_ERROR = 'Cloud account services are unavailable while Cloud services are stopped or unregistered';
// ─── Cloud Sync settings (must come BEFORE /:key wildcard) ──────────────────
router.get('/cloud', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        res.json(cloud_sync_1.cloudSync.getStatus());
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put('/cloud', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { cloud_server_url, cloud_api_key, cloud_store_id, cloud_sync_enabled, cloud_orders_enabled, cloud_reports_enabled, cloud_command_polling_enabled, } = req.body;
        const db = (0, db_1.getDatabase)();
        const updates = {
            cloud_store_id: cloud_store_id === undefined ? undefined : String(cloud_store_id || ''),
            cloud_sync_enabled: bool01Flag(cloud_sync_enabled),
            cloud_orders_enabled: bool01Flag(cloud_orders_enabled),
            cloud_reports_enabled: bool01Flag(cloud_reports_enabled),
            cloud_command_polling_enabled: bool01Flag(cloud_command_polling_enabled),
        };
        if (cloud_server_url !== undefined) {
            updates.cloud_server_url = (0, cloud_sync_1.normalizeCloudServerUrl)(cloud_server_url || cloud_sync_1.DEFAULT_CLOUD_SERVER_URL);
        }
        if (cloud_api_key !== undefined && !isMaskedSecret(cloud_api_key)) {
            updates.cloud_api_key = String(cloud_api_key || '');
        }
        const enablingCloud = [cloud_sync_enabled, cloud_orders_enabled, cloud_reports_enabled, cloud_command_polling_enabled]
            .some((value) => bool01Flag(value) === '1');
        const resumingStoppedCloud = cloud_sync_1.cloudSync.getStatus().cloud_services_disabled_by_user && enablingCloud;
        if (resumingStoppedCloud) {
            // Stop All disables every cloud feature. Re-enabling the Cloud Services
            // control is a resume action, not just a sync preference change.
            updates.cloud_sync_enabled = '1';
            updates.cloud_orders_enabled = '1';
            updates.cloud_reports_enabled = '1';
            updates.cloud_command_polling_enabled = '1';
        }
        if (enablingCloud)
            updates.cloud_services_disabled_by_user = 'false';
        if (enablingCloud && cloud_sync_1.cloudSync.getStatus().cloud_deletion_blocked) {
            return res.status(409).json({ error: 'Cloud deletion is unresolved; retry or cancel it before re-enabling cloud services.' });
        }
        upsertSettings(db, updates);
        cloud_sync_1.cloudSync.reload();
        cloud_sync_1.cloudSync.refreshRegistrationProfile();
        res.json(cloud_sync_1.cloudSync.getStatus());
    }
    catch (error) {
        console.error('[API] Cloud settings update failed:', error);
        res.status(400).json({ error: 'Invalid cloud settings' });
    }
});
router.post('/cloud/register', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const deletionRequest = await cloud_sync_1.cloudSync.getDeletionRequestStatus({
            allowRemote: cloud_sync_1.cloudSync.isCloudAccountAvailable(),
            signal: (0, shutdown_1.getHttpRequestSignal)(req),
        });
        if (deletionRequest?.status === 'pending') {
            return res.status(409).json({ error: 'A cloud deletion request is pending review. Cancel it before re-enabling cloud services.' });
        }
        if (cloud_sync_1.cloudSync.getStatus().cloud_services_disabled_by_user) {
            return res.status(409).json({ error: CLOUD_ACCOUNT_UNAVAILABLE_ERROR });
        }
        if (req.body?.cloud_server_url !== undefined) {
            upsertSettings((0, db_1.getDatabase)(), {
                cloud_server_url: (0, cloud_sync_1.normalizeCloudServerUrl)(req.body.cloud_server_url || cloud_sync_1.DEFAULT_CLOUD_SERVER_URL),
            });
        }
        if (cloud_sync_1.cloudSync.getStatus().cloud_deletion_blocked) {
            return res.status(409).json({ error: 'Cloud deletion is unresolved; retry or cancel it before re-enabling cloud services.' });
        }
        // Registration sends contact metadata for FloAdmin support; it does not
        // create a cloud owner account or grant authentication access.
        await cloud_sync_1.cloudSync.register((0, shutdown_1.getHttpRequestSignal)(req));
        upsertSettings((0, db_1.getDatabase)(), {
            cloud_sync_enabled: '1', cloud_reports_enabled: '1', cloud_command_polling_enabled: '1',
            cloud_services_disabled_by_user: 'false',
        });
        cloud_sync_1.cloudSync.reload();
        res.json(cloud_sync_1.cloudSync.getStatus());
    }
    catch (error) {
        console.error('[API] Cloud registration failed:', error);
        res.status(502).json({ error: 'Cloud registration failed' });
    }
}));
router.post('/cloud/test', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const result = await cloud_sync_1.cloudSync.testConnection((0, shutdown_1.getHttpRequestSignal)(req));
        res.json(result);
    }
    catch (error) {
        console.error('[API] Cloud test failed:', error);
        res.status(502).json({ error: 'Cloud test failed' });
    }
}));
router.get('/cloud/account', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const cloudAccountAvailable = cloud_sync_1.cloudSync.isCloudAccountAvailable();
        const signal = (0, shutdown_1.getHttpRequestSignal)(req);
        const deletionRequest = await cloud_sync_1.cloudSync.getDeletionRequestStatus({ allowRemote: cloudAccountAvailable, signal });
        const safeDeletionRequest = publicDeletionRequest(deletionRequest);
        if (deletionRequest?.status === 'approved' || !cloud_sync_1.cloudSync.isCloudAccountAvailable()) {
            return res.json({
                email: null,
                verified: false,
                verified_at: null,
                verification_sent_at: null,
                product_updates: false,
                marketing: false,
                cloud_account_available: false,
                deletion_request: safeDeletionRequest,
            });
        }
        res.json({
            ...publicEmailPreferences(await cloud_sync_1.cloudSync.getEmailPreferences(signal)),
            cloud_account_available: true,
            deletion_request: safeDeletionRequest,
        });
    }
    catch {
        res.status(502).json({ error: 'Could not load cloud account status' });
    }
}));
router.put('/cloud/account/preferences', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (!cloud_sync_1.cloudSync.isCloudAccountAvailable()) {
        return res.status(409).json({ error: CLOUD_ACCOUNT_UNAVAILABLE_ERROR });
    }
    try {
        res.json(publicEmailPreferences(await cloud_sync_1.cloudSync.updateEmailPreferences({
            product_updates: req.body?.product_updates,
            marketing: req.body?.marketing,
        }, (0, shutdown_1.getHttpRequestSignal)(req))));
    }
    catch {
        res.status(502).json({ error: 'Could not update email preferences' });
    }
}));
router.post('/cloud/account/verification', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (!cloud_sync_1.cloudSync.isCloudAccountAvailable()) {
        return res.status(409).json({ error: CLOUD_ACCOUNT_UNAVAILABLE_ERROR });
    }
    try {
        res.json(publicEmailPreferences(await cloud_sync_1.cloudSync.requestEmailVerification({ source: 'settings' }, (0, shutdown_1.getHttpRequestSignal)(req))));
    }
    catch {
        res.status(502).json({ error: 'Could not send verification email' });
    }
}));
router.get('/cloud/delete-data/status', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const deletionRequest = await cloud_sync_1.cloudSync.getDeletionRequestStatus({ allowRemote: true, signal: (0, shutdown_1.getHttpRequestSignal)(req) });
        res.json({
            cloud_account_available: cloud_sync_1.cloudSync.isCloudAccountAvailable(),
            deletion_request: publicDeletionRequest(deletionRequest),
        });
    }
    catch {
        res.status(502).json({ error: 'Could not refresh cloud deletion status' });
    }
}));
router.post('/cloud/stop-all', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (0, async_handler_1.asyncHandler)(async (req, res) => {
    res.json(await cloud_sync_1.cloudSync.stopAllCloudServices((0, shutdown_1.getHttpRequestSignal)(req)));
}));
router.post('/cloud/delete-data', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (req.body?.confirmation !== 'DELETE CLOUD DATA') {
        return res.status(400).json({ error: 'Type DELETE CLOUD DATA to confirm' });
    }
    try {
        res.json(await cloud_sync_1.cloudSync.deleteCloudData((0, shutdown_1.getHttpRequestSignal)(req)));
    }
    catch {
        res.status(502).json({ error: 'Cloud data deletion failed' });
    }
}));
router.post('/cloud/delete-data/cancel', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        res.json(await cloud_sync_1.cloudSync.cancelDeletionRequest((0, shutdown_1.getHttpRequestSignal)(req)));
    }
    catch {
        res.status(502).json({ error: 'Could not cancel deletion request' });
    }
}));
// ─── Google Drive backups (must come BEFORE /:key wildcard) ─────────────────
// See #129. Off by default — connect/disconnect/backup-now are the only
// actions that ever touch Google's API, and only owner can trigger them
// (mirrors how database.ts gates the raw backup/restore actions).
router.get('/google-drive', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        res.json(google_drive_1.googleDrive.getStatus());
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put('/google-drive', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { frequency, retention_count } = req.body;
        res.json(google_drive_1.googleDrive.updatePreferences({ frequency, retention_count }));
    }
    catch (error) {
        console.error('[API] Google Drive preferences update failed:', error);
        res.status(400).json({ error: 'Invalid Google Drive preferences' });
    }
});
router.post('/google-drive/connect', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const status = await (0, shutdown_1.trackHttpRequestWork)(req, google_drive_1.googleDrive.connect((0, shutdown_1.getHttpRequestSignal)(req)));
        res.json(status);
    }
    catch (error) {
        console.error('[API] Google Drive connection failed:', error);
        if ((0, shutdown_1.getHttpRequestSignal)(req)?.aborted) {
            if (!res.headersSent)
                res.status(503).end();
            else if (!res.writableEnded)
                res.destroy();
            return;
        }
        res.status(502).json({ error: 'Google Drive connection failed' });
    }
}));
router.post('/google-drive/disconnect', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (0, async_handler_1.asyncHandler)(async (_req, res) => {
    try {
        const status = await google_drive_1.googleDrive.disconnect();
        res.json(status);
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}));
router.post('/google-drive/backup-now', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.owner), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const status = await (0, shutdown_1.trackHttpRequestWork)(req, google_drive_1.googleDrive.backupNow((0, shutdown_1.getHttpRequestSignal)(req)));
        res.json(status);
    }
    catch (error) {
        console.error('[API] Google Drive backup failed:', error);
        if ((0, shutdown_1.getHttpRequestSignal)(req)?.aborted) {
            if (!res.headersSent)
                res.status(503).end();
            else if (!res.writableEnded)
                res.destroy();
            return;
        }
        res.status(502).json({ error: 'Google Drive backup failed' });
    }
}));
// ── Generic key-value routes (wildcard — must be last) ─────────────────────
// Only non-sensitive keys may be updated via the wildcard route.
// Sensitive keys (cloud_*, tax_registration_number, etc.) must use their explicit routes above.
const ALLOWED_WILDCARD_KEYS = new Set([
    'business_name', 'timezone', 'currency', 'country',
    'state_code', 'business_address', 'business_phone',
    'billing_type', 'tables_required', 'tax_registered', 'bill_show_name', 'bill_show_address',
    'bill_show_phone', 'bill_show_tax_id', 'bill_show_tax_breakdown', 'bill_show_customer_name',
    'bill_show_customer_phone', 'bill_show_table_number',
    'tax_scheme',
    'taxes_enabled',
    'loyalty_enabled',
    'language',
    'kds_default_view',
    'printer_method', 'paper_size', 'bill_template', 'bill_footer_message', 'printer_trim_decimals',
    'cash_drawer_pulse_enabled', 'cash_drawer_pulse_methods',
    'telemetry_enabled',
    'diagnostics_consent',
    'kds_enabled', 'server_app_enabled', 'kot_printing_enabled',
    'split_checks_enabled',
    print_language_settings_1.BILL_LANGUAGE_POLICY_KEY, print_language_settings_1.KOT_LANGUAGE_POLICY_KEY,
    'currency_display', 'number_digits', 'calendar',
    'theme_mode',
]);
function isAllowedWildcardKey(key) {
    return ALLOWED_WILDCARD_KEYS.has(key) || /^tax_plugin_request:[A-Z]{2}$/.test(key);
}
router.get('/', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.allStaff), (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json({ settings: publicSettingsShape(s) });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/bill-templates', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (_req, res) => {
    try {
        const plugins = (0, print_templates_1.listInstalledPrintTemplates)().map((template) => {
            let storedWidths = [];
            try {
                const parsed = JSON.parse(template.paper_widths_json);
                storedWidths = Array.isArray(parsed) ? parsed.filter((width) => typeof width === 'string') : [];
            }
            catch { /* Ignore malformed rows; install validation owns the contract. */ }
            const paperColumns = storedWidths
                .map((width) => /^cols-(\d+)$/.exec(width)?.[1])
                .filter((width) => !!width)
                .map((width) => Number(width));
            return {
                id: template.template_id,
                displayName: template.display_name,
                country: template.country,
                jurisdiction: template.jurisdiction,
                paperColumns,
                status: template.status,
                packId: template.pack_id,
                packVersionId: template.pack_version_id,
            };
        });
        // Merchant templates (#447): provenance is informational only — a cloned
        // origin references a compliance-pack template id WITHOUT transferring
        // any compliance trust. Only active rows are selectable.
        const merchant = (0, merchant_print_templates_1.listMerchantPrintTemplates)().map((template) => ({
            id: template.id,
            displayName: template.name,
            origin: template.origin,
            derivedFrom: template.derived_from ? JSON.parse(template.derived_from) : null,
            documentType: template.document_type,
            schemaVersion: template.schema_version,
            status: template.status,
            updatedAt: template.updated_at,
        }));
        res.json({ core: [...print_templates_1.CORE_BILL_TEMPLATES], plugins, merchant });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/:key', settingsReadRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.allStaff), (req, res) => {
    try {
        if (SENSITIVE_SETTING_KEYS.has(req.params.key)) {
            return res.status(403).json({ error: 'This setting is sensitive and cannot be read directly' });
        }
        const key = String(req.params.key);
        const db = (0, db_1.getDatabase)();
        const setting = db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
        if (!setting) {
            const defaultValue = OPTIONAL_SETTING_DEFAULTS[key];
            if (defaultValue !== undefined) {
                return res.json({ setting: { key, value: defaultValue, updated_at: null } });
            }
            return res.status(404).json({ error: 'Setting not found' });
        }
        res.json({ setting });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put('/:key', settingsWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        if (!isAllowedWildcardKey(req.params.key)) {
            return res.status(403).json({ error: 'This setting cannot be updated via wildcard route' });
        }
        const { value } = req.body;
        if (value === undefined) {
            return res.status(400).json({ error: 'Value is required' });
        }
        // bill_template accepts every legacy bare value AND the structured
        // { source, id } form; whichever the client sends, the canonical
        // structured JSON is persisted — legacy strings upgrade transparently on
        // their next save (#447).
        if (req.params.key === 'bill_template' && !(0, print_templates_1.isAvailableBillTemplate)(value)) {
            return res.status(400).json({ error: 'Unsupported bill template' });
        }
        if (req.params.key === 'theme_mode' && !(0, title_bar_theme_1.isThemeMode)(value)) {
            return res.status(400).json({ error: 'Invalid theme_mode value' });
        }
        let valueToPersist = value;
        if (req.params.key === 'bill_template') {
            valueToPersist = (0, print_templates_1.upgradeBillTemplateValue)(value);
        }
        if (typeof req.params.key === 'string' && print_language_settings_1.LANGUAGE_POLICY_SETTING_KEYS.has(req.params.key)) {
            const validation = (0, print_language_settings_1.validateLanguagePolicySetting)(req.params.key, value);
            if (!validation.ok) {
                return res.status(400).json({ error: validation.error });
            }
            valueToPersist = validation.stored;
        }
        const db = (0, db_1.getDatabase)();
        const wildcardKey = String(req.params.key);
        if (isLocalePreferenceKey(wildcardKey)) {
            const countryCode = getAllSettings(db).country || 'IN';
            if (typeof value !== 'string' || !isLocalePreferenceSupported(wildcardKey, value, countryCode)) {
                return res.status(400).json({ error: `Invalid ${wildcardKey} for country ${countryCode}` });
            }
        }
        if (req.params.key === 'business_phone') {
            const effectiveCountry = getAllSettings(db).country || 'IN';
            const phoneRes = (0, phone_1.normalizeOptionalPhone)(value, effectiveCountry);
            if (!phoneRes.valid) {
                return res.status(400).json({ error: phoneRes.error || 'Invalid business phone number' });
            }
            valueToPersist = phoneRes.e164 || '';
        }
        // KDS turning off → invalidate any outstanding pairing tokens. Without
        // this, a token minted while KDS was on would still let a device pair
        // in after it's been switched off (issue #133).
        if (req.params.key === 'kds_enabled') {
            const wasEnabled = getAllSettings(db).kds_enabled !== 'false';
            const turningOff = boolFlag(value) === 'false';
            if (wasEnabled && turningOff) {
                db.prepare('DELETE FROM kds_pairing_tokens').run();
            }
        }
        db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(req.params.key, valueToPersist, (0, db_1.now)());
        // Keep the legacy setting as a compatibility mirror. The canonical runtime
        // switch is telemetry_enabled; this route is the only user-facing writer,
        // so both stay aligned whenever the owner changes the toggle.
        if (req.params.key === 'telemetry_enabled') {
            db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES ('anonymous_data_consent', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(value, (0, db_1.now)());
        }
        // Tell FloAdmin the merchant's current choice so stores.diagnostics_consent
        // matches in both directions, not just inferred from "an event arrived."
        // Best-effort — never blocks the setting save on cloud reachability.
        if (req.params.key === 'diagnostics_consent') {
            void cloud_sync_1.cloudSync.setDiagnosticsConsent(boolFlag(value) === 'true');
        }
        if (req.params.key === 'split_checks_enabled' && boolFlag(value) === 'true') {
            void (0, telemetry_1.sendEvent)('feature_used', { feature: 'split_checks', action: 'enabled' });
        }
        const setting = db.prepare('SELECT * FROM settings WHERE key = ?').get(req.params.key);
        res.json({ setting });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.settingsRoutes = router;
//# sourceMappingURL=settings.js.map