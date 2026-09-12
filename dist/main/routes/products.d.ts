export interface SerpApiImageResult {
    source: string;
    title: string;
    thumbnail: string | null;
    full: string | null;
    width: number | null;
    height: number | null;
    context_url: string | null;
}
/**
 * Searches Google Images via SerpAPI and returns normalized results.
 * Returns [] (with a warning log) on any failure so the UI degrades
 * silently — never throws.
 */
export declare function searchSerpApiImages(query: string): Promise<SerpApiImageResult[]>;
export declare const productRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=products.d.ts.map