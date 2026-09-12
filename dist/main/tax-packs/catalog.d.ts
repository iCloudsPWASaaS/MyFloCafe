import { type KeyLike } from 'crypto';
import type { CountryPack, PluginPrintTemplate } from './types';
export interface TaxPackCatalogEntry {
    id: string;
    publisher: string;
    country: string;
    jurisdiction: string;
    version: string;
    publishedAt: string;
    minFloVersion: string;
    downloadUrl: string;
    signatureUrl: string;
    digest: string;
}
export interface TaxPackCatalog {
    schemaVersion: 1;
    generatedAt: string;
    packs: TaxPackCatalogEntry[];
}
export interface RemoteTaxPackCatalog {
    releaseTag: string;
    releaseUrl: string;
    catalog: TaxPackCatalog;
}
export interface VerifiedTaxPackArtifact {
    entry: TaxPackCatalogEntry;
    pack: CountryPack;
    packJson: string;
    artifactJson: string;
    signature: string;
    printTemplates: PluginPrintTemplate[];
}
export interface InstalledTaxPackVersion {
    packId: string;
    country: string;
    publisher: string;
    version: string;
}
export interface TaxPackUpdate {
    packId: string;
    installedPackId: string;
    country: string;
    publisher: string;
    currentVersion: string;
    latestVersion: string;
    entry: TaxPackCatalogEntry;
}
export declare function computeTaxPackUpdates(installed: InstalledTaxPackVersion[], catalog: TaxPackCatalog): TaxPackUpdate[];
type FetchLike = typeof fetch;
export declare function taxPackSha256(value: string): string;
export declare function parseTaxPackCatalog(value: unknown): TaxPackCatalog;
export declare function fetchRemoteTaxPackCatalog(fetchImpl?: FetchLike, signal?: AbortSignal): Promise<RemoteTaxPackCatalog>;
export declare function verifyTaxPackSignature(packJson: string, signature: string, publicKey?: KeyLike): boolean;
export declare function downloadAndVerifyTaxPack(entry: TaxPackCatalogEntry, fetchImpl?: FetchLike, publicKey?: KeyLike, signal?: AbortSignal): Promise<VerifiedTaxPackArtifact>;
export {};
//# sourceMappingURL=catalog.d.ts.map