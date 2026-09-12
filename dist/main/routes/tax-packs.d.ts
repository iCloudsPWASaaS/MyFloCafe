import { type KeyLike } from 'crypto';
import { type TaxPackCatalogEntry } from '../tax-packs/catalog';
export declare const LEGACY_TRUSTED_PACK_DIGESTS: Record<string, string>;
interface VersionRow {
    id: string;
    pack_id: string;
    version: string;
    schema_version: number;
    manifest_json: string;
    pack_json: string;
    digest: string | null;
    signature: string | null;
    effective_from: string;
    effective_to: string | null;
    min_flo_version: string;
    published_at: string;
    status: string;
    created_at: string;
}
export declare function validationChecklist(version: VersionRow, publicKey?: KeyLike): {
    valid: boolean;
    checks: Array<{
        id: number;
        passed: boolean;
        message: string;
    }>;
};
interface InstallCatalogEntryOptions {
    actorUserId: string | null;
    fetchImpl?: typeof fetch;
    publicKey?: KeyLike;
    signal?: AbortSignal;
}
export declare function installCatalogEntry(entry: TaxPackCatalogEntry, options: InstallCatalogEntryOptions): Promise<{
    packId: string;
    versionId: string;
    version: string;
    validation: ReturnType<typeof validationChecklist>;
}>;
export declare function reinstallPackVersion(packId: string, versionId: string, options: InstallCatalogEntryOptions): Promise<{
    packId: string;
    versionId: string;
    version: string;
    templateCount: number;
}>;
export declare function slugifyTaxId(label: string, used: Set<string>, fallback: string): string;
export declare const taxPackRoutes: import("express-serve-static-core").Router;
export {};
//# sourceMappingURL=tax-packs.d.ts.map