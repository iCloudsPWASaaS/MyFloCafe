"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoryRoutes = void 0;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const db_1 = require("../db");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const router = (0, express_1.Router)();
const categoryWriteRateLimit = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
function hasOwn(body, field) {
    return Object.prototype.hasOwnProperty.call(body, field);
}
function normalizeOptionalString(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value !== 'string')
        return String(value);
    const trimmed = value.trim();
    return trimmed || null;
}
function normalizeCategoryName(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed || null;
}
function slugForName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function validateParentCategory(db, parentId, categoryId) {
    if (parentId === null || parentId === undefined || parentId === '')
        return null;
    if (typeof parentId !== 'string')
        return 'parent_id must be a string or null';
    if (categoryId && parentId === categoryId)
        return 'Category cannot be its own parent';
    let current = db.prepare('SELECT id, parent_id FROM categories WHERE id = ? AND deleted_at IS NULL AND is_active = 1').get(parentId);
    if (!current)
        return 'Parent category not found or inactive';
    const seen = new Set();
    while (current?.parent_id) {
        if (categoryId && current.parent_id === categoryId)
            return 'Category parent cannot create a cycle';
        if (seen.has(current.parent_id))
            return 'Category tree already contains a cycle';
        seen.add(current.parent_id);
        current = db.prepare('SELECT id, parent_id FROM categories WHERE id = ? AND deleted_at IS NULL').get(current.parent_id);
    }
    return null;
}
function isDescendantCategory(db, categoryId, possibleDescendantId) {
    let current = db.prepare('SELECT parent_id FROM categories WHERE id = ? AND deleted_at IS NULL').get(possibleDescendantId);
    const seen = new Set();
    while (current?.parent_id) {
        if (current.parent_id === categoryId)
            return true;
        if (seen.has(current.parent_id))
            return false;
        seen.add(current.parent_id);
        current = db.prepare('SELECT parent_id FROM categories WHERE id = ? AND deleted_at IS NULL').get(current.parent_id);
    }
    return false;
}
function serializeCategory(category) {
    if (!category)
        return category;
    return {
        ...category,
        is_active: Boolean(category.is_active),
        children: Array.isArray(category.children) ? category.children.map(serializeCategory) : category.children,
        products: Array.isArray(category.products)
            ? category.products.map((product) => ({
                ...product,
                is_active: Boolean(product.is_active),
                track_inventory: Boolean(product.track_inventory),
            }))
            : category.products,
    };
}
router.get('/', (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        let query = 'SELECT * FROM categories WHERE deleted_at IS NULL';
        const params = [];
        if (req.query.active === 'true' || req.query.active === '1') {
            query += ' AND is_active = 1';
        }
        if (req.query.root === 'true') {
            query += ' AND parent_id IS NULL';
        }
        if (req.query.parent_id) {
            query += ' AND parent_id = ?';
            params.push(req.query.parent_id);
        }
        query += ' ORDER BY sort_order, name';
        const categories = db.prepare(query).all(...params);
        const childRowsByParent = new Map();
        if (categories.length > 0) {
            const placeholders = categories.map(() => '?').join(',');
            const children = db.prepare(`SELECT * FROM categories
         WHERE parent_id IN (${placeholders}) AND deleted_at IS NULL
         ORDER BY parent_id, sort_order, name`).all(...categories.map((cat) => cat.id));
            for (const child of children) {
                const rows = childRowsByParent.get(child.parent_id) || [];
                rows.push(child);
                childRowsByParent.set(child.parent_id, rows);
            }
        }
        const categoriesWithChildren = categories.map((cat) => serializeCategory({
            ...cat,
            children: childRowsByParent.get(cat.id) || [],
        }));
        res.json({ categories: categoriesWithChildren });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/:id', (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const category = db.prepare('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }
        const children = db.prepare('SELECT * FROM categories WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_order, name').all(req.params.id);
        const products = db.prepare('SELECT * FROM products WHERE category_id = ? AND deleted_at IS NULL').all(req.params.id);
        res.json({ category: serializeCategory({ ...category, children, products }) });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
function createCategory(req, res) {
    try {
        const { name, description, parent_id, sort_order, is_active, color, icon } = req.body;
        const categoryName = normalizeCategoryName(name);
        if (!categoryName) {
            return res.status(400).json({ error: 'Name is required' });
        }
        const db = (0, db_1.getDatabase)();
        const parentError = validateParentCategory(db, parent_id);
        if (parentError) {
            return res.status(400).json({ error: parentError });
        }
        const slug = slugForName(categoryName);
        const id = (0, db_1.generateShortId)('categories');
        db.prepare(`
      INSERT INTO categories (id, name, slug, description, parent_id, sort_order, is_active, color, icon, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, categoryName, slug, normalizeOptionalString(description), normalizeOptionalString(parent_id), sort_order || 0, is_active !== false ? 1 : 0, normalizeOptionalString(color), normalizeOptionalString(icon), (0, db_1.now)(), (0, db_1.now)());
        const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
        res.status(201).json({ category: serializeCategory(category) });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}
router.post('/', categoryWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), createCategory);
function updateCategory(req, res) {
    try {
        const { name, description, parent_id, sort_order, is_active, color, icon } = req.body;
        const db = (0, db_1.getDatabase)();
        const categoryId = String(req.params.id);
        const category = db.prepare('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL').get(categoryId);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }
        const hasName = hasOwn(req.body, 'name');
        const categoryName = hasName ? normalizeCategoryName(name) : null;
        if (hasName && !categoryName) {
            return res.status(400).json({ error: 'Name is required' });
        }
        if (hasOwn(req.body, 'parent_id')) {
            const parentError = validateParentCategory(db, parent_id, categoryId);
            if (parentError) {
                return res.status(400).json({ error: parentError });
            }
        }
        const slug = categoryName ? slugForName(categoryName) : category.slug;
        const activeInt = is_active !== undefined ? (is_active ? 1 : 0) : undefined;
        db.prepare(`
      UPDATE categories SET
      name = CASE WHEN @has_name = 1 THEN @name ELSE name END,
      slug = @slug,
      description = CASE WHEN @has_description = 1 THEN @description ELSE description END,
      parent_id = CASE WHEN @has_parent_id = 1 THEN @parent_id ELSE parent_id END,
      sort_order = CASE WHEN @has_sort_order = 1 THEN @sort_order ELSE sort_order END,
      is_active = CASE WHEN @has_is_active = 1 THEN @is_active ELSE is_active END,
      color = CASE WHEN @has_color = 1 THEN @color ELSE color END,
      icon = CASE WHEN @has_icon = 1 THEN @icon ELSE icon END,
      updated_at = @updated_at
      WHERE id = @id
    `).run({
            has_name: hasName ? 1 : 0,
            name: categoryName,
            slug,
            has_description: hasOwn(req.body, 'description') ? 1 : 0,
            description: normalizeOptionalString(description),
            has_parent_id: hasOwn(req.body, 'parent_id') ? 1 : 0,
            parent_id: normalizeOptionalString(parent_id),
            has_sort_order: hasOwn(req.body, 'sort_order') ? 1 : 0,
            sort_order: sort_order ?? null,
            has_is_active: hasOwn(req.body, 'is_active') ? 1 : 0,
            is_active: activeInt ?? null,
            has_color: hasOwn(req.body, 'color') ? 1 : 0,
            color: normalizeOptionalString(color),
            has_icon: hasOwn(req.body, 'icon') ? 1 : 0,
            icon: normalizeOptionalString(icon),
            updated_at: (0, db_1.now)(),
            id: categoryId,
        });
        const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
        res.json({ category: serializeCategory(updated) });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}
router.put('/:id', categoryWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), updateCategory);
function deleteCategory(req, res) {
    try {
        const db = (0, db_1.getDatabase)();
        const categoryId = String(req.params.id);
        const category = db.prepare('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL').get(categoryId);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }
        const { action, reassign_to } = req.query;
        const { count: productCount } = db.prepare('SELECT COUNT(*) as count FROM products WHERE category_id = ? AND deleted_at IS NULL').get(categoryId);
        const { count: childCount } = db.prepare('SELECT COUNT(*) as count FROM categories WHERE parent_id = ? AND deleted_at IS NULL').get(categoryId);
        if ((productCount > 0 || childCount > 0) && !action) {
            return res.status(400).json({
                error: 'Category has active product(s) or child categories. Choose an action.',
                productCount,
                childCount,
            });
        }
        const deleteCategory = db.transaction(() => {
            if (action === 'reassign') {
                if (!reassign_to)
                    throw new Error('reassign_to is required for reassign action');
                if (reassign_to === categoryId)
                    throw new Error('Cannot reassign a category to itself');
                const targetCategory = db.prepare('SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL').get(reassign_to);
                if (!targetCategory)
                    throw new Error('Target category not found or deleted');
                if (isDescendantCategory(db, categoryId, reassign_to)) {
                    throw new Error('Cannot reassign a category to one of its descendants');
                }
                db.prepare('UPDATE products SET category_id = ?, updated_at = ? WHERE category_id = ? AND deleted_at IS NULL')
                    .run(reassign_to, (0, db_1.now)(), categoryId);
                db.prepare('UPDATE categories SET parent_id = ?, updated_at = ? WHERE parent_id = ? AND deleted_at IS NULL')
                    .run(reassign_to, (0, db_1.now)(), categoryId);
            }
            else if (action === 'delete_all') {
                db.prepare('UPDATE products SET deleted_at = ?, updated_at = ? WHERE category_id = ? AND deleted_at IS NULL')
                    .run((0, db_1.now)(), (0, db_1.now)(), categoryId);
                db.prepare('UPDATE categories SET parent_id = NULL, updated_at = ? WHERE parent_id = ? AND deleted_at IS NULL')
                    .run((0, db_1.now)(), categoryId);
            }
            else if (!action && productCount === 0 && childCount === 0) {
                // Empty categories have no dependent rows to resolve.
            }
            else {
                throw new Error('Invalid action. Must be reassign or delete_all.');
            }
            db.prepare('UPDATE categories SET deleted_at = ?, updated_at = ? WHERE id = ?').run((0, db_1.now)(), (0, db_1.now)(), categoryId);
        });
        try {
            deleteCategory();
        }
        catch (error) {
            return res.status(400).json({ error: error.message });
        }
        res.json({ message: 'Category deleted' });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}
router.delete('/:id', categoryWriteRateLimit, (0, security_1.requireRole)(...role_permissions_1.ROLE_ACCESS.ownerManager), deleteCategory);
exports.categoryRoutes = router;
//# sourceMappingURL=categories.js.map