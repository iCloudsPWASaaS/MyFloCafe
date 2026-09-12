"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHealthCheck = runHealthCheck;
exports.applySafeFixes = applySafeFixes;
const db_1 = require("../db");
function snapshotSchema(dbInstance) {
    const tables = {};
    for (const name of (0, db_1.getTables)(dbInstance)) {
        // SQLite metadata can contain arbitrary object names in a damaged or
        // user-supplied database. Never interpolate an unsafe name into PRAGMA.
        if (!(0, db_1.isSafeIdentifier)(name))
            continue;
        const createRow = dbInstance.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
        const columns = dbInstance.prepare(`PRAGMA table_info(${name})`).all().map((c) => ({
            name: c.name,
            type: String(c.type || '').toUpperCase(),
            notnull: !!c.notnull,
            dfltValue: c.dflt_value ?? null,
            pk: !!c.pk,
        }));
        const indexList = dbInstance.prepare(`PRAGMA index_list(${name})`).all();
        const indexes = indexList
            // sqlite_autoindex_* are implicit indexes backing PRIMARY KEY/UNIQUE column
            // constraints already captured by ColumnDef.pk — skip to avoid double-reporting.
            .filter((i) => !String(i.name).startsWith('sqlite_autoindex_'))
            .filter((i) => (0, db_1.isSafeIdentifier)(String(i.name)))
            .map((i) => {
            const cols = dbInstance.prepare(`PRAGMA index_info(${i.name})`).all().map((c) => c.name);
            const sqlRow = dbInstance.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name = ?`).get(i.name);
            return { name: i.name, unique: !!i.unique, columns: cols, createSql: sqlRow?.sql ?? null };
        });
        const foreignKeys = dbInstance.prepare(`PRAGMA foreign_key_list(${name})`).all().map((fk) => ({
            table: fk.table,
            from: fk.from,
            to: fk.to,
            onDelete: fk.on_delete,
            onUpdate: fk.on_update,
        }));
        tables[name] = { name, createSql: createRow?.sql ?? null, columns, indexes, foreignKeys };
    }
    return { tables, schemaVersion: dbInstance.pragma('user_version', { simple: true }) };
}
function normalizeType(type) {
    return type.trim().toUpperCase().replace(/\(\d+(,\s*\d+)?\)/, '');
}
function normalizeCreateIfNotExists(sql) {
    if (/\bIF\s+NOT\s+EXISTS\b/i.test(sql))
        return sql;
    return sql.replace(/^\s*CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+/i, (m, unique = '') => `CREATE ${unique}${m.trim().split(/\s+/).pop()} IF NOT EXISTS `);
}
function sameColumnList(a, b) {
    return a.length === b.length && a.every((c, i) => c === b[i]);
}
function fkSignature(fk) {
    // Include the referential actions so a table whose only difference is its
    // ON DELETE/ON UPDATE cascade behavior is reported instead of passing as
    // identical. Delete behavior directly affects data safety.
    return `${fk.from}->${fk.table}.${fk.to}:${fk.onDelete}:${fk.onUpdate}`;
}
function sameForeignKeys(a, b) {
    const sigA = a.map(fkSignature).sort();
    const sigB = b.map(fkSignature).sort();
    return sigA.length === sigB.length && sigA.every((s, i) => s === sigB[i]);
}
function mismatchFinding(table, column, kind, description, currentState, idealState) {
    return {
        id: `${kind}:${table}.${column}`,
        table,
        column,
        kind,
        risk: 'manual_review',
        autoApplicable: false,
        description,
        currentState,
        idealState,
    };
}
function diffSchemas(live, ideal) {
    const findings = [];
    for (const tableName of Object.keys(ideal.tables)) {
        const idealTable = ideal.tables[tableName];
        const liveTable = live.tables[tableName];
        if (!liveTable) {
            findings.push({
                id: `missing_table:${tableName}`,
                table: tableName,
                kind: 'missing_table',
                risk: 'safe',
                autoApplicable: !!idealTable.createSql,
                description: `Table "${tableName}" is missing.`,
                suggestedDdl: idealTable.createSql ? normalizeCreateIfNotExists(idealTable.createSql) : undefined,
                idealState: idealTable.createSql ?? undefined,
            });
            continue;
        }
        for (const idealCol of idealTable.columns) {
            const liveCol = liveTable.columns.find((c) => c.name === idealCol.name);
            if (!liveCol) {
                const canAutoAdd = !idealCol.notnull || idealCol.dfltValue !== null;
                findings.push({
                    id: `missing_column:${tableName}.${idealCol.name}`,
                    table: tableName,
                    column: idealCol.name,
                    kind: 'missing_column',
                    risk: canAutoAdd ? 'safe' : 'manual_review',
                    autoApplicable: canAutoAdd,
                    description: canAutoAdd
                        ? `Column "${idealCol.name}" is missing from "${tableName}".`
                        : `Column "${idealCol.name}" is missing from "${tableName}" and is NOT NULL with no default — cannot be added automatically on a non-empty table.`,
                    suggestedDdl: canAutoAdd
                        ? `ALTER TABLE ${tableName} ADD COLUMN ${idealCol.name} ${idealCol.type}${idealCol.dfltValue !== null ? ` DEFAULT ${idealCol.dfltValue}` : ''}`
                        : undefined,
                    idealState: `${idealCol.type}${idealCol.notnull ? ' NOT NULL' : ''}${idealCol.dfltValue !== null ? ` DEFAULT ${idealCol.dfltValue}` : ''}`,
                });
                continue;
            }
            if (normalizeType(liveCol.type) !== normalizeType(idealCol.type)) {
                findings.push(mismatchFinding(tableName, idealCol.name, 'column_type_mismatch', `Column "${idealCol.name}" type differs from the expected schema.`, liveCol.type || '(none)', idealCol.type || '(none)'));
            }
            if (liveCol.notnull !== idealCol.notnull) {
                findings.push(mismatchFinding(tableName, idealCol.name, 'column_notnull_mismatch', `Column "${idealCol.name}" NOT NULL constraint differs from the expected schema.`, liveCol.notnull ? 'NOT NULL' : 'nullable', idealCol.notnull ? 'NOT NULL' : 'nullable'));
            }
            if ((liveCol.dfltValue ?? null) !== (idealCol.dfltValue ?? null)) {
                findings.push(mismatchFinding(tableName, idealCol.name, 'column_default_mismatch', `Column "${idealCol.name}" default value differs from the expected schema.`, liveCol.dfltValue ?? 'none', idealCol.dfltValue ?? 'none'));
            }
        }
        for (const liveCol of liveTable.columns) {
            if (!idealTable.columns.some((c) => c.name === liveCol.name)) {
                findings.push({
                    id: `extra_column:${tableName}.${liveCol.name}`,
                    table: tableName,
                    column: liveCol.name,
                    kind: 'extra_column',
                    risk: 'manual_review',
                    autoApplicable: false,
                    description: `Column "${liveCol.name}" on "${tableName}" isn't part of the expected schema — may be legitimate custom data or a leftover from a partial migration. Will not be removed automatically; review before deciding.`,
                    currentState: liveCol.type,
                });
            }
        }
        for (const idealIdx of idealTable.indexes) {
            const hasEquivalent = liveTable.indexes.some((i) => sameColumnList(i.columns, idealIdx.columns) && i.unique === idealIdx.unique);
            if (!hasEquivalent) {
                findings.push({
                    id: `missing_index:${tableName}.${idealIdx.name}`,
                    table: tableName,
                    index: idealIdx.name,
                    kind: 'missing_index',
                    risk: 'safe',
                    autoApplicable: !!idealIdx.createSql,
                    description: `Index "${idealIdx.name}" (${idealIdx.columns.join(', ')}) is missing on "${tableName}".`,
                    suggestedDdl: idealIdx.createSql ? normalizeCreateIfNotExists(idealIdx.createSql) : undefined,
                });
            }
        }
        for (const liveIdx of liveTable.indexes) {
            const hasEquivalent = idealTable.indexes.some((i) => sameColumnList(i.columns, liveIdx.columns) && i.unique === liveIdx.unique);
            if (!hasEquivalent) {
                findings.push({
                    id: `extra_index:${tableName}.${liveIdx.name}`,
                    table: tableName,
                    index: liveIdx.name,
                    kind: 'extra_index',
                    risk: 'manual_review',
                    autoApplicable: false,
                    description: `Index "${liveIdx.name}" on "${tableName}" isn't part of the expected schema. Will not be removed automatically; review before deciding.`,
                });
            }
        }
        if (!sameForeignKeys(liveTable.foreignKeys, idealTable.foreignKeys)) {
            findings.push({
                id: `foreign_key_mismatch:${tableName}`,
                table: tableName,
                kind: 'foreign_key_mismatch',
                risk: 'manual_review',
                autoApplicable: false,
                description: `Foreign keys on "${tableName}" differ from the expected schema. SQLite can't add or alter constraints on an existing table without a full rebuild — review manually.`,
                currentState: liveTable.foreignKeys.map((f) => `${f.from} → ${f.table}.${f.to} (ON DELETE ${f.onDelete}, ON UPDATE ${f.onUpdate})`).join(', ') || 'none',
                idealState: idealTable.foreignKeys.map((f) => `${f.from} → ${f.table}.${f.to} (ON DELETE ${f.onDelete}, ON UPDATE ${f.onUpdate})`).join(', ') || 'none',
            });
        }
    }
    for (const tableName of Object.keys(live.tables)) {
        if (!ideal.tables[tableName]) {
            findings.push({
                id: `extra_table:${tableName}`,
                table: tableName,
                kind: 'extra_table',
                risk: 'manual_review',
                autoApplicable: false,
                description: `Table "${tableName}" isn't part of the expected schema — may be legitimate custom data or leftover from a removed feature. Will not be removed automatically; review before deciding.`,
            });
        }
    }
    return findings;
}
function runHealthCheck() {
    const liveDb = (0, db_1.getDatabase)();
    const idealDb = (0, db_1.buildIdealSchemaDb)();
    try {
        const live = snapshotSchema(liveDb);
        const ideal = snapshotSchema(idealDb);
        const findings = diffSchemas(live, ideal);
        return {
            generatedAt: new Date().toISOString(),
            liveSchemaVersion: live.schemaVersion,
            idealSchemaVersion: ideal.schemaVersion,
            findings,
            summary: {
                safeCount: findings.filter((f) => f.risk === 'safe').length,
                manualReviewCount: findings.filter((f) => f.risk === 'manual_review').length,
            },
        };
    }
    finally {
        idealDb.close();
    }
}
/**
 * Re-derives the report itself (rather than trusting client-supplied DDL) so a
 * tampered request body can, at worst, select which already-computed safe
 * fixes to apply — never inject arbitrary SQL.
 */
function applySafeFixes(findingIds) {
    const report = runHealthCheck();
    const db = (0, db_1.getDatabase)();
    const result = { applied: [], skipped: [], errors: [] };
    const targets = report.findings.filter((f) => f.autoApplicable && f.risk === 'safe' && (!findingIds || findingIds.includes(f.id)));
    if (targets.length === 0)
        return result;
    // Apply the whole batch inside one transaction so a failure partway through
    // cannot leave a partially repaired schema behind. SQLite DDL is
    // transactional, so CREATE TABLE / CREATE INDEX / ALTER TABLE all roll back
    // together if any single fix fails.
    db.exec('BEGIN IMMEDIATE');
    try {
        for (const finding of targets) {
            const identifiersSafe = (0, db_1.isSafeIdentifier)(finding.table)
                && (!finding.column || (0, db_1.isSafeIdentifier)(finding.column))
                && (!finding.index || (0, db_1.isSafeIdentifier)(finding.index));
            if (!identifiersSafe || !finding.suggestedDdl) {
                result.skipped.push(finding.id);
                continue;
            }
            try {
                db.exec(finding.suggestedDdl);
                result.applied.push(finding.id);
            }
            catch (error) {
                result.errors.push({ id: finding.id, error: error.message });
            }
        }
        if (result.errors.length > 0) {
            db.exec('ROLLBACK');
            result.applied = [];
        }
        else {
            db.exec('COMMIT');
        }
    }
    catch (error) {
        try {
            db.exec('ROLLBACK');
        }
        catch { }
        result.applied = [];
        result.errors.push({ id: 'transaction', error: error.message });
    }
    return result;
}
//# sourceMappingURL=schema-health.js.map