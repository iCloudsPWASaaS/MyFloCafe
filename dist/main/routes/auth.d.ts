import { getDatabase } from '../db';
export declare function clearJWTSecretCache(): void;
export declare function getJWTSecret(): string;
export declare function parseCategoryIds(value: unknown): string[];
export declare const MAX_EMAIL_LENGTH = 254;
export declare function isValidEmail(email: string): boolean;
/** Filipino intentionally uses the English sample data as its reviewed exception. */
export declare const ENGLISH_IDENTICAL_SEED_LANGUAGES: readonly ["fil"];
export declare function seedSetupProfile(db: ReturnType<typeof getDatabase>, profile: string, serviceModel: string, language?: string, country?: string): void;
export declare const authRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=auth.d.ts.map