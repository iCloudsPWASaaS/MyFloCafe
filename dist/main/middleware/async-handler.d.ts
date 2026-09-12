import { Request, Response, NextFunction, RequestHandler } from 'express';
/**
 * Wrap an async Express handler so rejected promises flow to the global
 * error handler at main/server.ts:198 instead of crashing the request.
 * Saves a try/catch boilerplate per route.
 */
export declare function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler;
//# sourceMappingURL=async-handler.d.ts.map