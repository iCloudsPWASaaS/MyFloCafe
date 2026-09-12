export type FloErrorCode = `print.${string}` | `tax.${string}` | `migration.${string}` | `backup.${string}` | `cloud.${string}` | `update.${string}`;
export type CorrelatedError = Error & {
    code: FloErrorCode;
    correlationId: string;
};
export declare function correlationId(): string;
export declare function correlatedError(code: FloErrorCode, message: string, cause?: unknown): CorrelatedError;
export declare function errorDetails(error: unknown, fallbackCode: FloErrorCode): {
    code: FloErrorCode;
    correlationId: string;
    message: string;
};
//# sourceMappingURL=errors.d.ts.map