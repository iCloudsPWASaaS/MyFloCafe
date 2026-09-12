"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.menuCsvRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const node_crypto_1 = require("node:crypto");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const tax_1 = require("../services/tax");
const router = (0, express_1.Router)();
exports.menuCsvRoutes = router;
const VALID_TAX_BEHAVIORS = ['country_default', 'inclusive', 'exclusive', 'exempt'];
// Keep CSV imports below Express' default 100 KiB JSON body limit while also
// bounding the parser's work when it is mounted outside the production server.
const MAX_CSV_BYTES = 100_000;
const MAX_CSV_ROWS = 10_000;
const MAX_CSV_COLUMNS = 64;
const MAX_CSV_CELL_LENGTH = 10_000;
const NUMBER_TOKEN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
class CsvImportError extends Error {
    statusCode = 400;
    constructor(message) {
        super(message);
        this.name = 'CsvImportError';
    }
}
// ─── CSV helpers ─────────────────────────────────────────────────────────────
function parseCSV(text) {
    if (typeof text !== 'string')
        throw new CsvImportError('CSV data must be a string');
    if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) {
        throw new CsvImportError(`CSV exceeds the ${MAX_CSV_BYTES}-byte size limit`);
    }
    const rows = [];
    let fields = [];
    let field = '';
    let inQuotes = false;
    let afterClosingQuote = false;
    let lineNumber = 1;
    const append = (value) => {
        field += value;
        if (field.length > MAX_CSV_CELL_LENGTH) {
            throw new CsvImportError(`CSV cell on row ${lineNumber} exceeds the ${MAX_CSV_CELL_LENGTH}-character length limit`);
        }
    };
    const pushField = () => {
        if (fields.length >= MAX_CSV_COLUMNS) {
            throw new CsvImportError(`CSV row ${lineNumber} exceeds the ${MAX_CSV_COLUMNS}-cell limit`);
        }
        fields.push(field);
        field = '';
    };
    const pushRow = () => {
        pushField();
        if (fields.some((value) => value.trim())) {
            rows.push(fields);
            if (rows.length > MAX_CSV_ROWS) {
                throw new CsvImportError(`CSV exceeds the ${MAX_CSV_ROWS}-row limit`);
            }
        }
        fields = [];
        field = '';
    };
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"' && text[i + 1] === '"') {
                append('"');
                i++;
            }
            else if (char === '"') {
                inQuotes = false;
                afterClosingQuote = true;
            }
            else {
                append(char);
                if (char === '\n')
                    lineNumber++;
                else if (char === '\r') {
                    if (text[i + 1] === '\n') {
                        append('\n');
                        i++;
                    }
                    lineNumber++;
                }
            }
            continue;
        }
        if (afterClosingQuote) {
            if (char === ',') {
                pushField();
                afterClosingQuote = false;
            }
            else if (char === '\n' || char === '\r') {
                pushRow();
                if (char === '\r' && text[i + 1] === '\n')
                    i++;
                lineNumber++;
                afterClosingQuote = false;
            }
            else {
                throw new CsvImportError(`Malformed CSV: unexpected character after closing quote on row ${lineNumber}`);
            }
            continue;
        }
        if (char === '"') {
            if (field.length !== 0) {
                throw new CsvImportError(`Malformed CSV: unexpected quote on row ${lineNumber}`);
            }
            inQuotes = true;
        }
        else if (char === ',') {
            pushField();
        }
        else if (char === '\n' || char === '\r') {
            pushRow();
            if (char === '\r' && text[i + 1] === '\n')
                i++;
            lineNumber++;
        }
        else {
            append(char);
        }
    }
    if (inQuotes) {
        throw new CsvImportError(`Malformed CSV: unterminated quoted field on row ${lineNumber}`);
    }
    if (field.length > 0 || fields.length > 0 || afterClosingQuote)
        pushRow();
    return rows;
}
function toObjects(rows) {
    if (rows.length < 2)
        return [];
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    return rows.slice(1).map((row, index) => {
        if (row.length > headers.length) {
            throw new CsvImportError(`CSV row ${index + 2} has ${row.length} cells; expected at most ${headers.length}`);
        }
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (row[i] ?? '').trim(); });
        return obj;
    });
}
function parseNumericField(raw, fieldName, options = {}) {
    const rawValue = raw ?? '';
    const value = rawValue.trim();
    if (value === '') {
        if (options.optional)
            return { ok: true, value: options.defaultValue ?? 0 };
        return { ok: false, error: `invalid ${fieldName} "${rawValue}"` };
    }
    if (!NUMBER_TOKEN.test(value))
        return { ok: false, error: `invalid ${fieldName} "${rawValue}"` };
    const parsed = Number(value);
    if (!Number.isFinite(parsed)
        || (options.integer && !Number.isInteger(parsed))
        || (options.min !== undefined && parsed < options.min)
        || (options.max !== undefined && parsed > options.max)) {
        return { ok: false, error: `invalid ${fieldName} "${rawValue}"` };
    }
    return { ok: true, value: parsed };
}
function csvImportErrorResponse(res, error) {
    if (error instanceof CsvImportError) {
        return res.status(error.statusCode).json({
            error: error.message,
            errors: [error.message],
            created: 0,
            updated: 0,
            reactivated: 0,
            skipped: 0,
            failed: 1,
            groups_created: 0,
            addons_created: 0,
            groups_reactivated: 0,
            addons_reactivated: 0,
        });
    }
    console.error('[API] Menu CSV import failed:', error);
    return res.status(500).json({ error: 'Menu CSV import failed' });
}
function toCsvRow(fields) {
    return fields
        .map((f) => {
        let s = String(f ?? '');
        // Neutralize spreadsheet formula injection (CWE-1236 / GHSA-vrxh-633p-fhgm):
        // a cell beginning with = + - @ would be evaluated as a formula by Excel
        // or LibreOffice when the export is opened. Prefix with a single quote so
        // the cell is treated as literal text. Numeric fields are exempt so
        // legitimate negative numbers are not mangled.
        if (typeof f !== 'number' && /^[=+\-@]/.test(s)) {
            s = "'" + s;
        }
        return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
            ? '"' + s.replace(/"/g, '""') + '"'
            : s;
    })
        .join(',');
}
function isTruthy(v) {
    return ['yes', 'true', '1'].includes((v || '').toLowerCase());
}
// ─── Templates ───────────────────────────────────────────────────────────────
const TEMPLATES = {
    categories: [
        'name,description,color,icon,sort_order,parent',
        'Beverages,Hot and cold drinks,blue,☕,1,',
        'Food,Snacks and meals,green,🍔,2,',
        'Desserts,Sweet treats,pink,🍰,3,',
        'Combos,Meal deals and bundles,amber,🎁,4,',
        'Hot Coffee,Coffee beverages,orange,☕,1,Beverages',
    ].join('\n'),
    products: [
        'id,sku,name,category,price,description,cost,tax_category,tax_behavior,cashback_percent,tags,is_active',
        ',,Cappuccino,Beverages,150,Rich espresso with steamed milk,50,,,,"veg,bestseller",yes',
        ',,Espresso,Beverages,100,,40,,,,veg,yes',
        ',,Cold Coffee,Beverages,130,Chilled blended coffee,45,,,,"veg,new_arrival",yes',
        ',,Classic Burger,Food,250,Juicy patty with lettuce and tomato,100,,,,non_veg,yes',
        ',,Veg Sandwich,Food,180,Fresh vegetables in toasted bread,60,,,,"veg,new_arrival",yes',
        ',,Chocolate Cake,Desserts,120,Rich chocolate slice,,,,,veg,yes',
    ].join('\n'),
    addons: [
        'group_name,addon_name,price,group_required,group_min_select,group_max_select',
        'Size,Small,0,no,1,1',
        'Size,Regular,20,no,1,1',
        'Size,Large,40,no,1,1',
        'Milk Type,Full Cream,0,yes,1,1',
        'Milk Type,Oat Milk,30,yes,1,1',
        'Milk Type,Almond Milk,40,yes,1,1',
        'Extras,Extra Shot,30,no,0,3',
        'Extras,Extra Sugar,0,no,0,3',
        'Temperature,Hot,0,yes,1,1',
        'Temperature,Cold (Iced),10,yes,1,1',
    ].join('\n'),
};
router.get('/template/:type', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    const type = req.params.type;
    const csv = TEMPLATES[type];
    if (!csv)
        return res.status(404).json({ error: 'Unknown template type' });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-template.csv"`);
    res.send(csv);
});
// ─── Export ──────────────────────────────────────────────────────────────────
router.get('/export/categories', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (_req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const rows = db
            .prepare('SELECT * FROM categories WHERE deleted_at IS NULL')
            .all();
        // Depth-first walk keeps every subcategory right below its parent, and the
        // parent column lets an import reproduce the hierarchy without ids.
        const byId = new Map(rows.map((c) => [c.id, c]));
        const childrenByParent = new Map();
        const roots = [];
        for (const c of rows) {
            if (c.parent_id && byId.has(c.parent_id)) {
                const arr = childrenByParent.get(c.parent_id) || [];
                arr.push(c);
                childrenByParent.set(c.parent_id, arr);
            }
            else {
                roots.push(c);
            }
        }
        const sorter = (a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name);
        const ordered = [];
        const walk = (list) => {
            for (const c of [...list].sort(sorter)) {
                ordered.push(c);
                if (childrenByParent.has(c.id))
                    walk(childrenByParent.get(c.id));
            }
        };
        walk(roots);
        const lines = ['name,description,color,icon,sort_order,parent'];
        for (const c of ordered)
            lines.push(toCsvRow([c.name, c.description, c.color, c.icon, c.sort_order, c.parent_id ? byId.get(c.parent_id)?.name ?? '' : '']));
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="categories-export.csv"');
        res.send(lines.join('\n'));
    }
    catch (err) {
        console.error('[API] Menu CSV export failed:', err);
        res.status(500).json({ error: 'Menu CSV export failed' });
    }
});
router.get('/export/products', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (_req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const rows = db
            .prepare(`SELECT p.*, c.name AS category_name
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.deleted_at IS NULL
         ORDER BY c.sort_order, p.sort_order, p.name`)
            .all();
        const lines = ['id,sku,name,category,price,description,cost,tax_category,tax_behavior,cashback_percent,tags,is_active'];
        for (const p of rows) {
            let tags = '';
            if (p.tags) {
                try {
                    const t = JSON.parse(p.tags);
                    tags = Array.isArray(t) ? t.join(',') : p.tags;
                }
                catch {
                    tags = p.tags;
                }
            }
            lines.push(toCsvRow([p.id, p.sku, p.name, p.category_name, p.price, p.description, p.cost,
                p.tax_category_id ?? '', p.tax_behavior ?? '',
                p.cb_percent !== null ? p.cb_percent : '', tags, p.is_active ? 'yes' : 'no']));
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="products-export.csv"');
        res.send(lines.join('\n'));
    }
    catch (err) {
        console.error('[API] Menu CSV export failed:', err);
        res.status(500).json({ error: 'Menu CSV export failed' });
    }
});
router.get('/export/addons', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (_req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const groups = db
            .prepare('SELECT * FROM addon_groups WHERE is_active = 1 ORDER BY sort_order, name')
            .all();
        const lines = ['group_name,addon_name,price,group_required,group_min_select,group_max_select'];
        for (const g of groups) {
            const addons = db
                .prepare('SELECT * FROM addons WHERE addon_group_id = ? AND is_active = 1 ORDER BY sort_order, name')
                .all(g.id);
            for (const a of addons)
                lines.push(toCsvRow([g.name, a.name, a.price, g.is_required ? 'yes' : 'no', g.min_selection, g.max_selection]));
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="addons-export.csv"');
        res.send(lines.join('\n'));
    }
    catch (err) {
        console.error('[API] Menu CSV export failed:', err);
        res.status(500).json({ error: 'Menu CSV export failed' });
    }
});
// ─── Import ──────────────────────────────────────────────────────────────────
router.post('/import/categories', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { csv } = req.body;
        if (typeof csv !== 'string' || !csv)
            return res.status(400).json({ error: 'No CSV data provided' });
        const rows = toObjects(parseCSV(csv));
        if (!rows.length)
            return res.status(400).json({ error: 'CSV has no data rows' });
        const db = (0, db_1.getDatabase)();
        let created = 0, updated = 0, reactivated = 0, skipped = 0, failed = 0;
        const errors = [];
        // Pre-seed with existing category ids so an in-file row can resolve a
        // parent that already exists in the store even when the parent's own row
        // is skipped as a duplicate.
        const knownIds = new Map();
        for (const existing of db.prepare('SELECT id, name FROM categories WHERE deleted_at IS NULL').all()) {
            knownIds.set(existing.name.toLowerCase(), existing.id);
        }
        const pending = rows.map((r, index) => ({ r, rowNo: index + 2, name: (r.name || '').trim() }));
        db.transaction(() => {
            // Multi-pass topological insert: a row whose parent has not resolved yet
            // (parent appears later in the file) waits for the next pass. When a pass
            // makes no progress, the leftovers reference a missing parent or form a
            // cycle, so they are all rejected.
            while (pending.length) {
                const remainingBefore = pending.length;
                for (let i = pending.length - 1; i >= 0; i--) {
                    const { r, rowNo, name } = pending[i];
                    if (!name) {
                        failed++;
                        errors.push(`Row ${rowNo}: missing name`);
                        pending.splice(i, 1);
                        continue;
                    }
                    const sortOrder = parseNumericField(r.sort_order, 'sort_order', { optional: true, defaultValue: 0, integer: true });
                    if (!sortOrder.ok) {
                        failed++;
                        errors.push(`Row ${rowNo} (${name}): ${sortOrder.error}`);
                        pending.splice(i, 1);
                        continue;
                    }
                    let parentId = null;
                    if (r.parent) {
                        const resolvedParent = knownIds.get(r.parent.toLowerCase());
                        if (!resolvedParent)
                            continue;
                        parentId = resolvedParent;
                    }
                    const exists = db
                        .prepare('SELECT id FROM categories WHERE name = ? AND deleted_at IS NULL')
                        .get(name);
                    if (exists) {
                        knownIds.set(name.toLowerCase(), exists.id);
                        skipped++;
                        pending.splice(i, 1);
                        continue;
                    }
                    const id = (0, node_crypto_1.randomUUID)();
                    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                    db.prepare(`INSERT INTO categories (id, name, slug, description, color, icon, sort_order, parent_id, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(id, name, slug, r.description || null, r.color || null, r.icon || null, sortOrder.value, parentId, (0, db_1.now)(), (0, db_1.now)());
                    knownIds.set(name.toLowerCase(), id);
                    created++;
                    pending.splice(i, 1);
                }
                if (pending.length === remainingBefore) {
                    for (const { r, rowNo, name } of pending) {
                        failed++;
                        errors.push(`Row ${rowNo} (${name}): parent "${r.parent}" not found or forms a circular reference`);
                    }
                    pending.length = 0;
                }
            }
        })();
        res.json({ created, updated, reactivated, skipped, failed, errors });
    }
    catch (err) {
        return csvImportErrorResponse(res, err);
    }
});
router.post('/import/products', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { csv } = req.body;
        if (typeof csv !== 'string' || !csv)
            return res.status(400).json({ error: 'No CSV data provided' });
        const parsedCsv = parseCSV(csv);
        const headers = new Set((parsedCsv[0] || []).map((header) => header.trim().toLowerCase()));
        const hasTaxCategoryColumn = headers.has('tax_category');
        const hasTaxBehaviorColumn = headers.has('tax_behavior');
        const rows = toObjects(parsedCsv);
        if (!rows.length)
            return res.status(400).json({ error: 'CSV has no data rows' });
        const db = (0, db_1.getDatabase)();
        const catRows = db
            .prepare('SELECT id, name FROM categories WHERE deleted_at IS NULL')
            .all();
        const catMap = {};
        for (const c of catRows)
            catMap[c.name.toLowerCase()] = c.id;
        const country = (0, db_1.getSettingValue)('country') || 'IN';
        const businessType = (0, db_1.getSettingValue)('business_type') || 'restaurant';
        const activePack = (0, tax_1.getActiveCountryPack)(country);
        const taxCategoriesConfigured = (0, tax_1.hasConfiguredTaxCategories)(activePack, businessType);
        const taxCategoryIds = new Set(activePack.categories.map((category) => category.id));
        let created = 0, updated = 0, reactivated = 0, skipped = 0, failed = 0;
        const errors = [];
        db.transaction(() => {
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                if (!r.name) {
                    failed++;
                    errors.push(`Row ${i + 2}: missing name`);
                    continue;
                }
                const priceResult = parseNumericField(r.price, 'price', { min: 0 });
                if (!priceResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.name}): ${priceResult.error}`);
                    continue;
                }
                const price = priceResult.value;
                const costResult = parseNumericField(r.cost, 'cost', { optional: true, defaultValue: 0, min: 0 });
                if (!costResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.name}): ${costResult.error}`);
                    continue;
                }
                const cost = costResult.value;
                let categoryId = null;
                if (r.category) {
                    categoryId = catMap[r.category.toLowerCase()] ?? null;
                    if (!categoryId) {
                        failed++;
                        errors.push(`Row ${i + 2} (${r.name}): category "${r.category}" not found — import categories first`);
                        continue;
                    }
                }
                let tagsJson = null;
                if (r.tags) {
                    const arr = r.tags.split(',').map((t) => t.trim()).filter(Boolean);
                    if (arr.length)
                        tagsJson = JSON.stringify(arr);
                }
                const isActive = !r.is_active || isTruthy(r.is_active) ? 1 : 0;
                let cbPercent = null;
                if (r.cashback_percent !== undefined && r.cashback_percent !== null && r.cashback_percent.trim() !== '') {
                    const cashbackResult = parseNumericField(r.cashback_percent, 'cashback_percent', { min: 0, max: 100 });
                    if (!cashbackResult.ok) {
                        failed++;
                        errors.push(`Row ${i + 2} (${r.name}): ${cashbackResult.error}`);
                        continue;
                    }
                    cbPercent = cashbackResult.value;
                }
                const sku = r.sku || null;
                let taxCategoryId = null;
                if (r.tax_category) {
                    if (!taxCategoriesConfigured) {
                        failed++;
                        errors.push(`Row ${i + 2} (${r.name}): the active country pack (${activePack.id}) has no configured tax rules for business type ${businessType}`);
                        continue;
                    }
                    if (!taxCategoryIds.has(r.tax_category)) {
                        failed++;
                        errors.push(`Row ${i + 2} (${r.name}): tax_category "${r.tax_category}" is not defined in the active country pack (${activePack.id})`);
                        continue;
                    }
                    taxCategoryId = r.tax_category;
                }
                let taxBehavior = hasTaxBehaviorColumn ? 'country_default' : null;
                if (r.tax_behavior) {
                    if (!VALID_TAX_BEHAVIORS.includes(r.tax_behavior)) {
                        failed++;
                        errors.push(`Row ${i + 2} (${r.name}): tax_behavior "${r.tax_behavior}" must be one of: ${VALID_TAX_BEHAVIORS.join(', ')}`);
                        continue;
                    }
                    taxBehavior = r.tax_behavior;
                }
                // If an id is provided, try to update the existing product.
                if (r.id) {
                    const existing = db
                        .prepare('SELECT id, is_active FROM products WHERE id = ? AND deleted_at IS NULL')
                        .get(r.id);
                    if (!existing) {
                        failed++;
                        errors.push(`Row ${i + 2} (${r.name}): id "${r.id}" not found — leave id blank to create a new item`);
                        continue;
                    }
                    db.prepare(`UPDATE products SET name=?, category_id=?, price=?, description=?, cost=?,
           tax_type=?, tax_rate=?,
           tax_category_id=CASE WHEN ? = 1 THEN ? ELSE tax_category_id END,
           tax_behavior=CASE WHEN ? = 1 THEN ? ELSE tax_behavior END,
           cb_percent=?, tags=?, is_active=?, sku=?, updated_at=?
           WHERE id=?`).run(r.name, categoryId, price, r.description || null, cost, 'none', 0, hasTaxCategoryColumn ? 1 : 0, taxCategoryId, hasTaxBehaviorColumn ? 1 : 0, taxBehavior, cbPercent, tagsJson, isActive, sku, (0, db_1.now)(), r.id);
                    if (existing.is_active === 0 && isActive === 1)
                        reactivated++;
                    else
                        updated++;
                    continue;
                }
                // No id — insert as new, skip if name+category duplicate.
                const exists = db
                    .prepare('SELECT id FROM products WHERE name = ? AND category_id IS ? AND deleted_at IS NULL')
                    .get(r.name, categoryId);
                if (exists) {
                    skipped++;
                    continue;
                }
                db.prepare(`INSERT INTO products (id, name, category_id, price, description, cost, tax_type, tax_rate,
         tax_category_id, tax_behavior, cb_percent, tags, is_active, sku, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run((0, db_1.generateShortId)('products'), r.name, categoryId, price, r.description || null, cost, 'none', 0, taxCategoryId, taxBehavior || 'country_default', cbPercent, tagsJson, isActive, sku, (0, db_1.now)(), (0, db_1.now)());
                created++;
            }
        })();
        res.json({ created, updated, reactivated, skipped, failed, errors });
    }
    catch (err) {
        return csvImportErrorResponse(res, err);
    }
});
router.post('/import/addons', (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), (req, res) => {
    try {
        const { csv } = req.body;
        if (typeof csv !== 'string' || !csv)
            return res.status(400).json({ error: 'No CSV data provided' });
        const parsedCsv = parseCSV(csv);
        const headers = new Set((parsedCsv[0] || []).map((header) => header.trim().toLowerCase()));
        const hasGroupRequiredColumn = headers.has('group_required');
        const hasGroupMinColumn = headers.has('group_min_select');
        const hasGroupMaxColumn = headers.has('group_max_select');
        const rows = toObjects(parsedCsv);
        if (!rows.length)
            return res.status(400).json({ error: 'CSV has no data rows' });
        const db = (0, db_1.getDatabase)();
        let groupsCreated = 0, groupsUpdated = 0, addonsCreated = 0;
        let groupsReactivated = 0, addonsReactivated = 0;
        let skipped = 0, failed = 0;
        const errors = [];
        const groupCache = {};
        const groupPlans = new Map();
        for (const row of rows) {
            if (!row.group_name || !row.addon_name)
                continue;
            const priceResult = parseNumericField(row.price, 'price', { min: 0 });
            const minResult = parseNumericField(row.group_min_select, 'group_min_select', { optional: true, defaultValue: 0, integer: true, min: 0 });
            const maxResult = parseNumericField(row.group_max_select, 'group_max_select', { optional: true, defaultValue: 1, integer: true, min: 0 });
            if (!priceResult.ok || !minResult.ok || !maxResult.ok)
                continue;
            const key = row.group_name.toLowerCase();
            let plan = groupPlans.get(key);
            if (!plan) {
                const existing = db.prepare('SELECT id, is_active, is_required, min_selection, max_selection FROM addon_groups WHERE name = ?').get(row.group_name);
                const activeAddons = existing
                    ? db.prepare('SELECT name FROM addons WHERE addon_group_id = ? AND is_active = 1').all(existing.id)
                    : [];
                const minSelection = hasGroupMinColumn ? minResult.value : (existing?.min_selection ?? 0);
                const maxSelection = hasGroupMaxColumn ? maxResult.value : (existing?.max_selection ?? 1);
                if (minSelection > maxSelection)
                    continue;
                plan = {
                    existing,
                    activeAddonNames: new Set(activeAddons.map((addon) => addon.name)),
                    activeAddonCount: activeAddons.length,
                    importedAddonNames: new Set(),
                    minSelection,
                    maxSelection,
                    boundsError: null,
                };
                groupPlans.set(key, plan);
            }
            const rowMinSelection = hasGroupMinColumn ? minResult.value : (plan.existing?.min_selection ?? 0);
            const rowMaxSelection = hasGroupMaxColumn ? maxResult.value : (plan.existing?.max_selection ?? 1);
            if (rowMinSelection > rowMaxSelection)
                continue;
            plan.importedAddonNames.add(row.addon_name);
        }
        for (const plan of groupPlans.values()) {
            const finalActiveAddonCount = plan.activeAddonCount
                + [...plan.importedAddonNames].filter((name) => !plan.activeAddonNames.has(name)).length;
            if (plan.minSelection > plan.maxSelection) {
                plan.boundsError = 'group_min_select must not exceed group_max_select';
            }
            else if (plan.minSelection > finalActiveAddonCount) {
                plan.boundsError = `group_min_select cannot exceed the final number of active add-ons (${finalActiveAddonCount})`;
            }
        }
        db.transaction(() => {
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                if (!r.group_name || !r.addon_name) {
                    failed++;
                    errors.push(`Row ${i + 2}: missing group_name or addon_name`);
                    continue;
                }
                const priceResult = parseNumericField(r.price, 'price', { min: 0 });
                if (!priceResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): ${priceResult.error}`);
                    continue;
                }
                const price = priceResult.value;
                const minResult = parseNumericField(r.group_min_select, 'group_min_select', { optional: true, defaultValue: 0, integer: true, min: 0 });
                if (!minResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): ${minResult.error}`);
                    continue;
                }
                const maxResult = parseNumericField(r.group_max_select, 'group_max_select', { optional: true, defaultValue: 1, integer: true, min: 0 });
                if (!maxResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): ${maxResult.error}`);
                    continue;
                }
                const key = r.group_name.toLowerCase();
                const groupPlan = groupPlans.get(key);
                const effectiveMinSelection = hasGroupMinColumn ? minResult.value : (groupPlan?.existing?.min_selection ?? 0);
                const effectiveMaxSelection = hasGroupMaxColumn ? maxResult.value : (groupPlan?.existing?.max_selection ?? 1);
                if (effectiveMinSelection > effectiveMaxSelection) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): group_min_select must not exceed group_max_select`);
                    continue;
                }
                if (groupPlan?.boundsError) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): ${groupPlan.boundsError}`);
                    continue;
                }
                let groupId = groupCache[key];
                if (!groupId) {
                    const existing = db.prepare('SELECT id, is_active, is_required, min_selection, max_selection FROM addon_groups WHERE name = ?').get(r.group_name);
                    if (existing) {
                        groupId = existing.id;
                        const isRequired = hasGroupRequiredColumn ? (isTruthy(r.group_required) ? 1 : 0) : existing.is_required;
                        const minSelection = hasGroupMinColumn ? minResult.value : existing.min_selection;
                        const maxSelection = hasGroupMaxColumn ? maxResult.value : existing.max_selection;
                        const settingsChanged = existing.is_required !== isRequired
                            || existing.min_selection !== minSelection
                            || existing.max_selection !== maxSelection;
                        if (existing.is_active === 0) {
                            db.prepare(`UPDATE addon_groups SET is_required = ?, min_selection = ?, max_selection = ?, is_active = 1, updated_at = ? WHERE id = ?`).run(isRequired, minSelection, maxSelection, (0, db_1.now)(), groupId);
                            groupsReactivated++;
                        }
                        else if (settingsChanged) {
                            db.prepare(`UPDATE addon_groups SET is_required = ?, min_selection = ?, max_selection = ?, updated_at = ? WHERE id = ?`).run(isRequired, minSelection, maxSelection, (0, db_1.now)(), groupId);
                            groupsUpdated++;
                        }
                    }
                    else {
                        groupId = (0, node_crypto_1.randomUUID)();
                        db.prepare(`INSERT INTO addon_groups (id, name, is_required, min_selection, max_selection, is_active, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`).run(groupId, r.group_name, hasGroupRequiredColumn && isTruthy(r.group_required) ? 1 : 0, hasGroupMinColumn ? minResult.value : 0, hasGroupMaxColumn ? maxResult.value : 1, (0, db_1.now)(), (0, db_1.now)());
                        groupsCreated++;
                    }
                    groupCache[key] = groupId;
                }
                const addonExists = db
                    .prepare('SELECT id, is_active FROM addons WHERE addon_group_id = ? AND name = ?')
                    .get(groupId, r.addon_name);
                if (addonExists) {
                    if (addonExists.is_active === 0) {
                        db.prepare('UPDATE addons SET is_active = 1, price = ?, updated_at = ? WHERE id = ?')
                            .run(price, (0, db_1.now)(), addonExists.id);
                        addonsReactivated++;
                    }
                    else {
                        skipped++;
                    }
                    continue;
                }
                db.prepare(`INSERT INTO addons (id, addon_group_id, name, price, is_active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 0, ?, ?)`).run((0, node_crypto_1.randomUUID)(), groupId, r.addon_name, price, (0, db_1.now)(), (0, db_1.now)());
                addonsCreated++;
            }
        })();
        const created = groupsCreated + addonsCreated;
        const reactivated = groupsReactivated + addonsReactivated;
        res.json({
            created,
            updated: groupsUpdated,
            reactivated,
            skipped,
            failed,
            groups_created: groupsCreated,
            groups_updated: groupsUpdated,
            addons_created: addonsCreated,
            groups_reactivated: groupsReactivated,
            addons_reactivated: addonsReactivated,
            errors,
        });
    }
    catch (err) {
        return csvImportErrorResponse(res, err);
    }
});
//# sourceMappingURL=menu-csv.js.map