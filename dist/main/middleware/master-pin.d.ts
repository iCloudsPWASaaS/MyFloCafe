import { Request, Response, NextFunction } from 'express';
/**
 * Must be used after requireAuth + requireRole('owner'). Expects `master_pin`
 * in the request body. Rate-limit key is scoped per-route (not just per-IP) —
 * matching the existing PIN rate-limit convention in routes/orders.ts — so a
 * lockout on one gated action (e.g. backup) doesn't also lock out unrelated
 * ones (e.g. initialize) sharing the same IP.
 */
export declare function requireMasterPin(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=master-pin.d.ts.map