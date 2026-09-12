export interface TaxIdFormat {
    pattern: string;
    description: string;
}
/**
 * Which locale display preferences a country supports. The Settings UI only
 * renders these controls when a country's profile declares them, so
 * region-specific options never appear (or bloat) other regions' UI.
 */
export interface CountryLocaleOptions {
    currencyDisplay?: ('rial' | 'toman' | 'toman_short')[];
    digits?: ('locale' | 'latin')[];
    calendar?: ('locale' | 'persian' | 'gregorian')[];
}
export interface Country {
    code: string;
    name: string;
    currency: string;
    timezone: string;
    dialCode: string;
    locale: string;
    taxIdLabel?: string;
    taxName?: string;
    taxIdFormat?: TaxIdFormat;
    localeOptions?: CountryLocaleOptions;
}
export declare const COUNTRIES: Country[];
export declare const getCountryByCode: (code: string) => Country | undefined;
export declare const getCurrencySymbol: (currency: string, locale?: string) => string;
/**
 * Iran/Persian display preferences. Storage is never affected: monetary
 * values are always persisted in the tenant's currency code (IRR for Iran,
 * i.e. Rial) and these options only change how values are *rendered*.
 *
 * - `currencyDisplay`: `rial` (default) renders the stored unit verbatim;
 *   `toman` divides by 10 (1 Toman = 10 Rial) and suffixes `تومان`;
 *   `toman_short` divides by 10 and suffixes `ت`/`T` (Persian/Latin digits).
 * - `digits`: `locale` (default) follows the locale's native digits
 *   (Persian for `fa-IR`); `latin` forces Western digits.
 * - `calendar`: `locale` (default) follows the locale's calendar (Shamsi for
 *   `fa-IR`); `persian` forces Shamsi; `gregorian` forces Gregorian.
 *
 * Storage is canonical: monetary amounts persist in the tenant currency (Rial / IRR),
 * and `getCurrencyUnitAdapter` translates UI payment modal inputs to/from the display unit.
 */
export type CurrencyDisplay = 'rial' | 'toman' | 'toman_short';
export type DigitMode = 'locale' | 'latin';
export type CalendarMode = 'locale' | 'persian' | 'gregorian';
export interface LocalePreferences {
    currencyDisplay?: CurrencyDisplay;
    digits?: DigitMode;
    calendar?: CalendarMode;
}
export declare const formatCurrency: (amount: number, currency: string, locale?: string) => string;
/**
 * Currency display with the Iran `currencyDisplay`/`digits` preferences
 * applied. Non-IRR currencies and the `rial` mode behave like
 * `formatCurrency` (plus the optional Latin-digit override).
 */
export declare const formatMoney: (amount: number, currency: string, locale?: string, prefs?: LocalePreferences) => string;
export interface CurrencyUnitAdapter {
    scale: number;
    label: string;
    step: string;
    maxDecimals: number;
    toDisplay: (storedAmount: number) => number;
    toStored: (displayAmount: number) => number;
    formatInput: (displayAmount: number) => string;
}
/**
 * Resolves standard ISO 4217 decimal fraction digits for a currency code using
 * native Intl.NumberFormat metadata, falling back safely to 2 decimals.
 */
export declare function getCurrencyFractionDigits(currency: string): number;
/**
 * Resolves the minor-unit factor (e.g. 1 for JPY, 100 for USD) for currency arithmetic.
 */
export declare function getCurrencyMinorUnitFactor(currency: string): number;
/**
 * Returns a centralized adapter for handling input/display unit conversions
 * across all currencies and tenant display preferences (e.g. Rial vs Toman).
 */
export declare const getCurrencyUnitAdapter: (currency: string, countryCode?: string, prefs?: LocalePreferences) => CurrencyUnitAdapter;
export declare const formatCurrencyForTenant: (amount: number, countryCode: string | undefined, currency: string, prefs?: LocalePreferences) => string;
/**
 * Formats a plain (non-currency) number using the given locale's digits and
 * grouping (e.g. `1234.5` → `۱٬۲۳۴٫۵` in `fa-IR`). Used for counts, points,
 * and other bare numbers so they follow the tenant locale instead of the
 * browser's default locale.
 */
export declare const formatNumber: (value: number, locale?: string, numberingSystem?: string) => string;
/**
 * Formats a plain number using the tenant's country locale and digit
 * preference. Mirrors `formatCurrencyForTenant` for non-monetary values.
 */
export declare const formatNumberForTenant: (value: number, countryCode: string | undefined, prefs?: LocalePreferences) => string;
/**
 * Formats a date with the tenant's timezone, calendar/digit preferences, and
 * an optional UI locale override (falling back to the tenant country's locale).
 * Dates are stored as UTC timestamps; this is display-only.
 */
export declare const formatDateForTenant: (date: Date, countryCode: string | undefined, timezone: string, prefs?: LocalePreferences, options?: Intl.DateTimeFormatOptions, localeOverride?: string) => string;
export declare const countryName: (code: string) => string;
/**
 * Canonical IANA timezone identifiers available on this platform, sourced
 * exclusively from the native Intl API (no external timezone data or
 * network access). Used to populate the editable timezone selector without
 * shipping a bundled tz database.
 */
export declare const listTimeZones: () => string[];
/**
 * Validates an IANA timezone identifier using native Intl.DateTimeFormat.
 * Mirrors the offline-first contract: no bundled tz data, no network calls.
 * Legacy aliases accepted by Intl (e.g. US/Eastern) remain valid here, which
 * keeps existing persisted values working during upgrades.
 */
export declare const isValidTimeZone: (value: unknown) => boolean;
export declare const DEFAULT_COUNTRY_PROFILE: {
    readonly dialCode: "+1";
    readonly locale: "en-US";
    readonly taxIdLabel: "Tax ID";
    readonly taxName: "Tax";
};
//# sourceMappingURL=countries.d.ts.map