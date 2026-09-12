export declare function parsePhoneE164(input: string, defaultCountry: string): {
    e164: string;
    countryCode: string;
} | null;
export declare function stripPhoneDigits(input: string): string;
export type NormalizedPhoneResult = {
    valid: boolean;
    e164: string | null;
    countryCode: string | null;
    error?: string;
};
export declare function normalizeOptionalPhone(input: unknown, defaultCountry?: string): NormalizedPhoneResult;
//# sourceMappingURL=phone.d.ts.map