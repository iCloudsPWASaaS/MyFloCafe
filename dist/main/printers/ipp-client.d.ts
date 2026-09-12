export type IppValue = string | number | boolean;
export type IppAttributeGroup = Record<string, IppValue[]>;
export interface IppAttribute {
    tag: number;
    name: string;
    values: IppValue[];
}
export interface IppResponse {
    statusCode: number;
    operationAttributes: IppAttributeGroup;
    /** One entry per printer-attributes-tag group (or per job-attributes-tag group). */
    groups: IppAttributeGroup[];
}
/** Enumerates every printer CUPS knows about (queues for USB and network printers alike). */
export declare function ippGetPrinters(signal?: AbortSignal): Promise<IppAttributeGroup[]>;
/** Returns the CUPS-configured default printer's name, or null if none is set. */
export declare function ippGetDefaultPrinterName(signal?: AbortSignal): Promise<string | null>;
export interface IppPrinterAttributes {
    state?: number;
    isAcceptingJobs?: boolean;
}
/** Pre-flight check mirroring thermal.ts's describeCupsQueueProblem for the lp path. */
export declare function ippGetPrinterAttributes(printerName: string, signal?: AbortSignal): Promise<IppPrinterAttributes>;
export interface IppPrintResult {
    ok: boolean;
    statusCode: number;
    jobId?: number;
    detail?: string;
}
/** Submits raw bytes (ESC/POS) as a Print-Job with document-format application/octet-stream — the IPP equivalent of `lp -o raw`. */
export declare function ippPrintRaw(printerName: string, data: Buffer, signal?: AbortSignal): Promise<IppPrintResult>;
//# sourceMappingURL=ipp-client.d.ts.map