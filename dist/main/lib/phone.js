"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePhoneE164 = parsePhoneE164;
exports.stripPhoneDigits = stripPhoneDigits;
exports.normalizeOptionalPhone = normalizeOptionalPhone;
const libphonenumber_js_1 = require("libphonenumber-js");
function parsePhoneE164(input, defaultCountry) {
    try {
        const raw = String(input || '').trim();
        if (!raw)
            return null;
        const country = (defaultCountry || 'IN').toUpperCase();
        const parsed = (0, libphonenumber_js_1.parsePhoneNumber)(raw, { defaultCountry: country, extract: false });
        if (!parsed?.isValid())
            return null;
        return { e164: parsed.number, countryCode: `+${parsed.countryCallingCode}` };
    }
    catch {
        return null;
    }
}
function stripPhoneDigits(input) {
    return String(input || '').replace(/\D/g, '');
}
function normalizeOptionalPhone(input, defaultCountry = 'IN') {
    if (input === undefined || input === null) {
        return { valid: true, e164: null, countryCode: null };
    }
    const raw = String(input).trim();
    if (raw === '') {
        return { valid: true, e164: null, countryCode: null };
    }
    const parsed = parsePhoneE164(raw, defaultCountry);
    if (!parsed) {
        return {
            valid: false,
            e164: null,
            countryCode: null,
            error: 'Invalid phone number format. Please provide a valid phone number with optional country code.',
        };
    }
    return { valid: true, e164: parsed.e164, countryCode: parsed.countryCode };
}
//# sourceMappingURL=phone.js.map