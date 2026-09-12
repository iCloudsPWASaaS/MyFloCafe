import * as fs from 'fs';
export declare const STALE_RENDER_CACHE_DIRS: string[];
interface Logger {
    debug: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
}
export interface CacheFsOps {
    readFileSync: typeof fs.readFileSync;
    writeFileSync: typeof fs.writeFileSync;
    rmSync: typeof fs.rmSync;
    mkdirSync: typeof fs.mkdirSync;
}
export declare function clearStaleRenderCachesOnVersionChange(userDataPath: string, currentElectronVersion: string, logger?: Logger, fsOps?: CacheFsOps): void;
export {};
//# sourceMappingURL=startup-cache.d.ts.map