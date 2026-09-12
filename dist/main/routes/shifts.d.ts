import { getDatabase } from '../db';
declare const router: import("express-serve-static-core").Router;
/**
 * Cash expected in the register for a shift's window: opening cash plus the
 * net cash collections (cash paid minus cash refunds) recorded while the
 * shift was open. Non-cash methods are excluded from the drawer expectation.
 */
export declare function computeShiftNetCollections(db: ReturnType<typeof getDatabase>, shift: any): number;
export { router as shiftRoutes };
//# sourceMappingURL=shifts.d.ts.map