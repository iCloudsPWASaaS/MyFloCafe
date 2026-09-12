import type { Category } from '@/lib/types';

/**
 * Shared helpers for nested (multi-level) product categories.
 *
 * The API returns categories as a flat list keyed by `parent_id` (with a
 * redundant one-level `children` array). POS, the Products page, and the
 * Server App rebuild arbitrary-depth trees from the flat list so hierarchy
 * never depends on the depth the API happened to pre-attach.
 */

function compareCategories(a: Category, b: Category): number {
  const byOrder = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  if (byOrder !== 0) return byOrder;
  return a.name.localeCompare(b.name);
}

function sortTree(nodes: Category[]) {
  nodes.sort(compareCategories);
  for (const node of nodes) {
    if (node.children && node.children.length > 0) sortTree(node.children);
  }
}

/** Build a depth-first sorted tree of root categories from a flat list. */
export function buildCategoryTree(categories: Category[]): Category[] {
  const byId = new Map<string, Category>();
  const roots: Category[] = [];
  for (const cat of categories) {
    const node: Category = { ...cat, children: [] };
    byId.set(cat.id, node);
  }
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) {
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  sortTree(roots);
  return roots;
}

export interface FlattenedCategory {
  category: Category;
  depth: number;
  /** Direct children count (0 = leaf). */
  childCount: number;
  /** Parent id as reported by the flat list, or null for roots. */
  parentId: string | null;
}

/** Depth-first pre-order flattening used by tree chips and tree tables. */
export function flattenCategoryTree(roots: Category[]): FlattenedCategory[] {
  const out: FlattenedCategory[] = [];
  const walk = (nodes: Category[], depth: number) => {
    for (const node of nodes) {
      out.push({
        category: node,
        depth,
        childCount: node.children ? node.children.length : 0,
        parentId: node.parent_id ?? null,
      });
      if (node.children && node.children.length > 0) walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

/** Minimal shape the tree helpers need: only identity and the parent link. */
export interface CategoryReference {
  id: string;
  parent_id: string | null;
}

/** Set of every descendant category id (excludes the given category itself). */
export function getCategoryDescendantIds(categories: readonly CategoryReference[], categoryId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const cat of categories) {
    if (!cat.parent_id) continue;
    const children = childrenByParent.get(cat.parent_id) || [];
    children.push(cat.id);
    childrenByParent.set(cat.parent_id, children);
  }
  const result = new Set<string>();
  const stack = [categoryId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const child of childrenByParent.get(current) || []) {
      result.add(child);
      stack.push(child);
    }
  }
  return result;
}

/** Ancestor ids ordered from the root down to (but excluding) categoryId. */
export function getCategoryAncestorIds(categories: Category[], categoryId: string): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const ancestors: string[] = [];
  let current = byId.get(categoryId);
  const seen = new Set<string>();
  while (current && current.parent_id && !seen.has(current.parent_id)) {
    seen.add(current.parent_id);
    ancestors.unshift(current.parent_id);
    current = byId.get(current.parent_id);
  }
  return ancestors;
}

/** "Beverages / Hot / Tea" path for a category, useful for titles and tooltips. */
export function getCategoryPathName(categories: Category[], categoryId: string | null): string {
  if (categoryId == null) return '';
  const byId = new Map(categories.map((c) => [c.id, c]));
  const names: string[] = [];
  let current = byId.get(categoryId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return names.join(' / ');
}

/**
 * Category ids a selection should include. A parent category is treated as a
 * group, so selecting it also surfaces every product in its subtree. Returns
 * null when no category is selected (i.e. "All categories").
 */
export function getCategorySelectionIds(
  categories: readonly CategoryReference[],
  categoryId: string | null,
): Set<string> | null {
  if (categoryId == null) return null;
  const ids = new Set<string>([categoryId]);
  for (const descendant of getCategoryDescendantIds(categories, categoryId)) ids.add(descendant);
  return ids;
}

/**
 * Indent label for picker dropdowns (parent selectors, reassign targets).
 * Uses non-breaking spaces so the tree depth survives HTML option rendering.
 */
export function categoryIndentLabel(depth: number): string {
  return depth > 0 ? '\u00A0\u00A0'.repeat(depth) : '';
}