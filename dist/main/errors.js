"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.correlationId = correlationId;
exports.correlatedError = correlatedError;
exports.errorDetails = errorDetails;
const crypto_1 = require("crypto");
function correlationId() {
    return (0, crypto_1.randomUUID)();
}
function correlatedError(code, message, cause) {
    const error = new Error(message);
    error.name = 'FloOperationError';
    error.code = code;
    error.correlationId = correlationId();
    if (cause)
        error.cause = cause;
    return error;
}
function errorDetails(error, fallbackCode) {
    const candidate = error;
    return {
        code: candidate?.code || fallbackCode,
        correlationId: candidate?.correlationId || correlationId(),
        message: error instanceof Error ? error.message : String(error),
    };
}
//# sourceMappingURL=errors.js.map