export interface ColumnDef {
    name: string;
    type: string;
    notnull: boolean;
    dfltValue: string | null;
    pk: boolean;
}
export interface IndexDef {
    name: string;
    unique: boolean;
    columns: string[];
    createSql: string | null;
}
export interface ForeignKeyDef {
    table: string;
    from: string;
    to: string;
    onDelete: string;
    onUpdate: string;
}
export interface TableSchema {
    name: string;
    createSql: string | null;
    columns: ColumnDef[];
    indexes: IndexDef[];
    foreignKeys: ForeignKeyDef[];
}
export interface DbSchemaSnapshot {
    tables: Record<string, TableSchema>;
    schemaVersion: number;
}
export type FindingKind = 'missing_table' | 'missing_column' | 'missing_index' | 'extra_table' | 'extra_column' | 'extra_index' | 'column_type_mismatch' | 'column_notnull_mismatch' | 'column_default_mismatch' | 'foreign_key_mismatch';
export interface HealthFinding {
    id: string;
    table: string;
    column?: string;
    index?: string;
    kind: FindingKind;
    risk: 'safe' | 'manual_review';
    autoApplicable: boolean;
    description: string;
    suggestedDdl?: string;
    currentState?: string;
    idealState?: string;
}
export interface HealthCheckReport {
    generatedAt: string;
    liveSchemaVersion: number;
    idealSchemaVersion: number;
    findings: HealthFinding[];
    summary: {
        safeCount: number;
        manualReviewCount: number;
    };
}
export declare function runHealthCheck(): HealthCheckReport;
export interface ApplySafeFixesResult {
    applied: string[];
    skipped: string[];
    errors: {
        id: string;
        error: string;
    }[];
}
/**
 * Re-derives the report itself (rather than trusting client-supplied DDL) so a
 * tampered request body can, at worst, select which already-computed safe
 * fixes to apply — never inject arbitrary SQL.
 */
export declare function applySafeFixes(findingIds?: string[]): ApplySafeFixesResult;
//# sourceMappingURL=schema-health.d.ts.map