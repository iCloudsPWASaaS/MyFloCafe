"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = exports.ENGLISH_IDENTICAL_SEED_LANGUAGES = exports.MAX_EMAIL_LENGTH = void 0;
exports.clearJWTSecretCache = clearJWTSecretCache;
exports.getJWTSecret = getJWTSecret;
exports.parseCategoryIds = parseCategoryIds;
exports.isValidEmail = isValidEmail;
exports.seedSetupProfile = seedSetupProfile;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
const libphonenumber_js_1 = require("libphonenumber-js");
const db_1 = require("../db");
const master_pin_1 = require("../services/master-pin");
const security_1 = require("../middleware/security");
const countries_1 = require("../countries");
const country_provenance_1 = require("../services/country-provenance");
const cloud_sync_1 = require("../services/cloud-sync");
const async_handler_1 = require("../middleware/async-handler");
const phone_1 = require("../lib/phone");
const router = (0, express_1.Router)();
const JWT_EXPIRES_IN = '24h';
const JWT_REMEMBER_EXPIRES_IN = '10d';
const JWT_REMEMBER_EXPIRES_IN_SECONDS = 10 * 24 * 60 * 60;
function expiresInFor(remember) {
    return remember ? JWT_REMEMBER_EXPIRES_IN : JWT_EXPIRES_IN;
}
function dialCodeFor(country) {
    if (!country)
        return '+1';
    try {
        return `+${(0, libphonenumber_js_1.getCountryCallingCode)(country.toUpperCase())}`;
    }
    catch {
        return '+1';
    }
}
const INITIAL_ADMIN_ROLE = 'owner';
const VALID_BUSINESS_TYPES = new Set(['restaurant']);
const VALID_SETUP_PROFILES = new Set(['empty', 'express', 'demo']);
const VALID_SERVICE_MODELS = new Set(['qsr', 'finedine']);
const LOCAL_SETUP_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/**
 * Lazy-loaded JWT secret. On first access, reads from the settings table.
 * If no secret exists (first launch), generates a random 32-byte hex string
 * and persists it. This ensures every install gets a unique secret without
 * requiring manual configuration.
 */
let _jwtSecret = null;
function clearJWTSecretCache() {
    _jwtSecret = null;
}
function getJWTSecret() {
    if (_jwtSecret)
        return _jwtSecret;
    // Environment variable always wins (for CI/testing)
    if (process.env.JWT_SECRET) {
        _jwtSecret = process.env.JWT_SECRET;
        return _jwtSecret;
    }
    try {
        const db = (0, db_1.getDatabase)();
        const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get();
        if (row?.value) {
            _jwtSecret = row.value;
        }
        else {
            // First launch: generate and persist a random secret
            _jwtSecret = (0, crypto_1.randomBytes)(32).toString('hex');
            db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('jwt_secret', ?, ?)")
                .run(_jwtSecret, (0, db_1.now)());
            console.log('[Auth] Generated new JWT secret for this install');
        }
    }
    catch (err) {
        // Database not ready — refuse to operate with a static secret.
        // JWT operations will fail until the database is accessible.
        console.error('[Auth] Database not ready — JWT secret unavailable:', err);
        throw new Error('Database not ready — authentication unavailable');
    }
    return _jwtSecret;
}
/**
 * Build a synthetic "tenant" object from local settings.
 * FloDesktop is single-tenant — there is always exactly one "business".
 * The frontend expects this shape to determine routing (chef → KDS, others → POS).
 */
function buildLocalTenant(db, userRole) {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
        id: 1,
        business_name: s.business_name || 'Store',
        slug: 'local',
        database_name: 'local',
        business_type: s.business_type || 'restaurant',
        country: s.country || 'IN',
        currency: s.currency || 'INR',
        currency_symbol: (0, countries_1.getCurrencySymbol)(s.currency || 'INR', (0, countries_1.getCountryByCode)(s.country)?.locale) || '₹',
        timezone: s.timezone || 'Asia/Kolkata',
        language: s.language || 'en',
        // Include print policies in the authenticated tenant snapshot so the
        // renderer can bootstrap them before the first print, without requiring a
        // visit to Settings.
        bill_language_policy: s.bill_language_policy || null,
        kot_language_policy: s.kot_language_policy || null,
        service_model: s.service_model || 'finedine',
        currency_display: s.currency_display || 'rial',
        number_digits: s.number_digits || 'locale',
        calendar: s.calendar || 'locale',
        plan: 'desktop',
        status: 'active',
        role: userRole, // user's role — AuthGuard uses this for routing
    };
}
function getUserCount(db) {
    return db.prepare('SELECT COUNT(*) as count FROM users').get().count;
}
function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}
function parseCategoryIds(value) {
    if (typeof value !== 'string' || value.length === 0)
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    }
    catch {
        return [];
    }
}
// RFC 5321 caps a mailbox at 254 octets. Bound the length before applying the
// email regex so an attacker-supplied email cannot drive `[^\s@]+` backtracking
// into super-linear time (CodeQL js/polynomial-redos).
exports.MAX_EMAIL_LENGTH = 254;
function isValidEmail(email) {
    return email.length <= exports.MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function upsertSettings(db, entries) {
    const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
    for (const [key, value] of Object.entries(entries)) {
        if (value !== undefined && value !== null)
            stmt.run(key, String(value), (0, db_1.now)());
    }
}
function insertCategory(db, id, name, color, icon, sortOrder) {
    db.prepare(`
    INSERT OR IGNORE INTO categories (id, name, color, icon, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, name, color, icon, sortOrder, (0, db_1.now)(), (0, db_1.now)());
}
function insertProduct(db, id, categoryId, name, price, sortOrder) {
    db.prepare(`
    INSERT OR IGNORE INTO products (id, category_id, name, price, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, categoryId, name, price, sortOrder, (0, db_1.now)(), (0, db_1.now)());
}
function insertTable(db, id, number, capacity) {
    db.prepare(`
    INSERT OR IGNORE INTO tables (id, number, capacity, status, created_at, updated_at)
    VALUES (?, ?, ?, 'available', ?, ?)
  `).run(id, number, capacity, (0, db_1.now)(), (0, db_1.now)());
}
function insertCustomer(db, id, name, rawPhone, fallbackDialCode, country = 'IN') {
    const norm = (0, phone_1.normalizeOptionalPhone)(rawPhone, country);
    const finalPhone = norm.valid && norm.e164 ? norm.e164 : rawPhone;
    const finalCountryCode = norm.valid && norm.countryCode ? norm.countryCode : fallbackDialCode;
    db.prepare(`
    INSERT OR IGNORE INTO customers (id, name, phone, country_code, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(id, name, finalPhone, finalCountryCode, (0, db_1.now)(), (0, db_1.now)());
}
function insertStaffUser(db, id, name, email, role, password, isActive = 1) {
    db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, email, bcryptjs_1.default.hashSync(password, 10), role, isActive, (0, db_1.now)(), (0, db_1.now)());
}
/** Filipino intentionally uses the English sample data as its reviewed exception. */
exports.ENGLISH_IDENTICAL_SEED_LANGUAGES = ['fil'];
function resolveSeedLanguage(language) {
    return language === 'es' || language === 'fr' || language === 'pt' || language === 'de'
        || language === 'tr' || language === 'fil' || language === 'fa'
        ? language
        : 'en';
}
function seedExpressRestaurant(db, serviceModel, language) {
    const lang = resolveSeedLanguage(language);
    const labels = {
        en: ['Food', 'Beverages', 'Meal', 'Tea'],
        es: ['Comida', 'Bebidas', 'Comida', 'Té'],
        fr: ['Plats', 'Boissons', 'Plat', 'Thé'],
        pt: ['Comidas', 'Bebidas', 'Refeição', 'Chá'],
        de: ['Speisen', 'Getränke', 'Mahlzeit', 'Tee'],
        tr: ['Yiyecekler', 'İçecekler', 'Yemek', 'Çay'],
        fil: ['Food', 'Beverages', 'Meal', 'Tea'],
        fa: ['غذاها', 'نوشیدنی‌ها', 'غذا', 'چای'],
    };
    const [food, beverages, meal, tea] = labels[lang];
    const coffee = lang === 'es' ? 'Café' : lang === 'fr' ? 'Café' : lang === 'pt' ? 'Café'
        : lang === 'de' ? 'Kaffee' : lang === 'tr' ? 'Kahve' : lang === 'fa' ? 'قهوه' : 'Coffee';
    const snack = lang === 'es' ? 'Bocadillo' : lang === 'fr' ? 'Snack' : lang === 'pt' ? 'Lanche'
        : lang === 'de' ? 'Snack' : lang === 'tr' ? 'Atıştırmalık' : lang === 'fa' ? 'میان‌وعده' : 'Snack';
    insertCategory(db, 'cat-express-food', food, '#F97316', '🍽️', 1);
    insertCategory(db, 'cat-express-beverages', beverages, '#0EA5E9', '🥤', 2);
    insertProduct(db, 'prod-express-meal', 'cat-express-food', meal, 150, 1);
    insertProduct(db, 'prod-express-snack', 'cat-express-food', snack, 80, 2);
    insertProduct(db, 'prod-express-tea', 'cat-express-beverages', tea, 25, 1);
    insertProduct(db, 'prod-express-coffee', 'cat-express-beverages', coffee, 40, 2);
    if (serviceModel === 'finedine') {
        insertTable(db, 'tbl-express-1', 'T1', 4);
        insertTable(db, 'tbl-express-2', 'T2', 4);
        insertTable(db, 'tbl-express-3', 'T3', 6);
    }
}
function seedDemoRestaurant(db, serviceModel, language, country) {
    const lang = resolveSeedLanguage(language);
    const cats = lang === 'es'
        ? [
            ['cat-demo-starters', 'Entradas', '#FF6B6B', '🍟', 1],
            ['cat-demo-burger', 'Hamburguesas', '#4ECDC4', '🍔', 2],
            ['cat-demo-beverages', 'Bebidas', '#45B7D1', '🥤', 3],
            ['cat-demo-desserts', 'Postres', '#96CEB4', '🍰', 4],
        ]
        : lang === 'fr'
            ? [
                ['cat-demo-starters', 'Entrées', '#FF6B6B', '🍟', 1],
                ['cat-demo-burger', 'Hamburgers', '#4ECDC4', '🍔', 2],
                ['cat-demo-beverages', 'Boissons', '#45B7D1', '🥤', 3],
                ['cat-demo-desserts', 'Desserts', '#96CEB4', '🍰', 4],
            ]
            : lang === 'pt'
                ? [
                    ['cat-demo-starters', 'Entradas', '#FF6B6B', '🍟', 1],
                    ['cat-demo-burger', 'Hambúrgueres', '#4ECDC4', '🍔', 2],
                    ['cat-demo-beverages', 'Bebidas', '#45B7D1', '🥤', 3],
                    ['cat-demo-desserts', 'Sobremesas', '#96CEB4', '🍰', 4],
                ]
                : lang === 'de'
                    ? [
                        ['cat-demo-starters', 'Vorspeisen', '#FF6B6B', '🍟', 1],
                        ['cat-demo-burger', 'Burger', '#4ECDC4', '🍔', 2],
                        ['cat-demo-beverages', 'Getränke', '#45B7D1', '🥤', 3],
                        ['cat-demo-desserts', 'Desserts', '#96CEB4', '🍰', 4],
                    ]
                    : lang === 'tr'
                        ? [
                            ['cat-demo-starters', 'Başlangıçlar', '#FF6B6B', '🍟', 1],
                            ['cat-demo-main', 'Ana Yemekler', '#4ECDC4', '🍛', 2],
                            ['cat-demo-beverages', 'İçecekler', '#45B7D1', '🥤', 3],
                            ['cat-demo-desserts', 'Tatlılar', '#96CEB4', '🍰', 4],
                        ]
                        : lang === 'fa'
                            ? [
                                ['cat-demo-starters', 'پیش‌غذاها', '#FF6B6B', '🍟', 1],
                                ['cat-demo-main', 'غذاهای اصلی', '#4ECDC4', '🍛', 2],
                                ['cat-demo-beverages', 'نوشیدنی‌ها', '#45B7D1', '🥤', 3],
                                ['cat-demo-desserts', 'دسرها', '#96CEB4', '🍰', 4],
                            ]
                            : [
                                ['cat-demo-starters', 'Starters', '#FF6B6B', '🍔', 1],
                                ['cat-demo-main', 'Main Course', '#4ECDC4', '🍛', 2],
                                ['cat-demo-beverages', 'Beverages', '#45B7D1', '🥤', 3],
                                ['cat-demo-desserts', 'Desserts', '#96CEB4', '🍰', 4],
                            ];
    for (const [id, name, color, icon, sort] of cats)
        insertCategory(db, id, name, color, icon, sort);
    const products = lang === 'es'
        ? [
            ['prod-demo-empanadas', 'cat-demo-starters', 'Empanadas de Carne', 280, 1],
            ['prod-demo-papas', 'cat-demo-starters', 'Papas Fritas', 250, 2],
            ['prod-demo-hamburguesa-clasica', 'cat-demo-burger', 'Hamburguesa Clásica', 800, 1],
            ['prod-demo-doble', 'cat-demo-burger', 'Hamburguesa Doble', 1100, 2],
            ['prod-demo-bbq', 'cat-demo-burger', 'Hamburguesa BBQ', 1200, 3],
            ['prod-demo-gaseosa', 'cat-demo-beverages', 'Gaseosa Cola', 350, 1],
            ['prod-demo-agua', 'cat-demo-beverages', 'Agua Mineral', 200, 2],
            ['prod-demo-flan', 'cat-demo-desserts', 'Flan Casero', 400, 1],
        ]
        : lang === 'fr'
            ? [
                ['prod-demo-quiche', 'cat-demo-starters', 'Quiche Lorraine', 280, 1],
                ['prod-demo-frites', 'cat-demo-starters', 'Frites Maison', 250, 2],
                ['prod-demo-burger', 'cat-demo-burger', 'Burger Classique', 800, 1],
                ['prod-demo-burger-double', 'cat-demo-burger', 'Burger Double', 1100, 2],
                ['prod-demo-burger-bbq', 'cat-demo-burger', 'Burger BBQ', 1200, 3],
                ['prod-demo-citronnade', 'cat-demo-beverages', 'Citronnade', 350, 1],
                ['prod-demo-eau', 'cat-demo-beverages', 'Eau Minérale', 200, 2],
                ['prod-demo-mousse', 'cat-demo-desserts', 'Mousse au Chocolat', 400, 1],
            ]
            : lang === 'pt'
                ? [
                    ['prod-demo-coxinha', 'cat-demo-starters', 'Coxinha de Frango', 280, 1],
                    ['prod-demo-pastel', 'cat-demo-starters', 'Pastel de Queijo', 250, 2],
                    ['prod-demo-x-burger', 'cat-demo-burger', 'X-Burger', 800, 1],
                    ['prod-demo-x-dobro', 'cat-demo-burger', 'X-Dobro', 1100, 2],
                    ['prod-demo-x-bacon', 'cat-demo-burger', 'X-Bacon', 1200, 3],
                    ['prod-demo-refri', 'cat-demo-beverages', 'Refrigerante Cola', 350, 1],
                    ['prod-demo-agua', 'cat-demo-beverages', 'Água Mineral', 200, 2],
                    ['prod-demo-pudim', 'cat-demo-desserts', 'Pudim de Leite', 400, 1],
                ]
                : lang === 'de'
                    ? [
                        ['prod-demo-currywurst', 'cat-demo-starters', 'Currywurst', 280, 1],
                        ['prod-demo-kartoffelecken', 'cat-demo-starters', 'Kartoffelecken', 250, 2],
                        ['prod-demo-schnitzel', 'cat-demo-burger', 'Schnitzel', 800, 1],
                        ['prod-demo-bratwurst', 'cat-demo-burger', 'Bratwurst', 1100, 2],
                        ['prod-demo-burger', 'cat-demo-burger', 'Klassischer Burger', 1200, 3],
                        ['prod-demo-apfelschorle', 'cat-demo-beverages', 'Apfelschorle', 350, 1],
                        ['prod-demo-mineralwasser', 'cat-demo-beverages', 'Mineralwasser', 200, 2],
                        ['prod-demo-apfelstrudel', 'cat-demo-desserts', 'Apfelstrudel', 400, 1],
                    ]
                    : lang === 'tr'
                        ? [
                            ['prod-demo-patates', 'cat-demo-starters', 'Patates Kızartması', 280, 1],
                            ['prod-demo-sigara-boregi', 'cat-demo-starters', 'Sigara Böreği', 250, 2],
                            ['prod-demo-kofte', 'cat-demo-main', 'Izgara Köfte', 800, 1],
                            ['prod-demo-doner', 'cat-demo-main', 'Döner', 1100, 2],
                            ['prod-demo-burger', 'cat-demo-main', 'Klasik Burger', 1200, 3],
                            ['prod-demo-kola', 'cat-demo-beverages', 'Kola', 350, 1],
                            ['prod-demo-su', 'cat-demo-beverages', 'Maden Suyu', 200, 2],
                            ['prod-demo-baklava', 'cat-demo-desserts', 'Baklava', 400, 1],
                        ]
                        : lang === 'fa'
                            ? [
                                ['prod-demo-kashk', 'cat-demo-starters', 'کشک بادمجان', 280, 1],
                                ['prod-demo-sibzamini', 'cat-demo-starters', 'سیب‌زمینی سرخ‌کرده', 250, 2],
                                ['prod-demo-ghormeh', 'cat-demo-main', 'قرمه‌سبزی', 800, 1],
                                ['prod-demo-zereshk', 'cat-demo-main', 'زرشک‌پلو با مرغ', 1100, 2],
                                ['prod-demo-kebab', 'cat-demo-main', 'کباب کوبیده', 1200, 3],
                                ['prod-demo-doogh', 'cat-demo-beverages', 'دوغ', 350, 1],
                                ['prod-demo-water', 'cat-demo-beverages', 'آب معدنی', 200, 2],
                                ['prod-demo-sholeh', 'cat-demo-desserts', 'شله‌زرد', 400, 1],
                            ]
                            : [
                                ['prod-demo-paneer-tikka', 'cat-demo-starters', 'Paneer Tikka', 250, 1],
                                ['prod-demo-chicken-wings', 'cat-demo-starters', 'Chicken Wings', 280, 2],
                                ['prod-demo-butter-chicken', 'cat-demo-main', 'Butter Chicken', 320, 1],
                                ['prod-demo-dal-makhani', 'cat-demo-main', 'Dal Makhani', 220, 2],
                                ['prod-demo-jeera-rice', 'cat-demo-main', 'Jeera Rice', 150, 3],
                                ['prod-demo-cola', 'cat-demo-beverages', 'Cola', 60, 1],
                                ['prod-demo-lemon-soda', 'cat-demo-beverages', 'Lemon Soda', 70, 2],
                                ['prod-demo-gulab-jamun', 'cat-demo-desserts', 'Gulab Jamun', 80, 1],
                            ];
    for (const [id, categoryId, name, price, sort] of products)
        insertProduct(db, id, categoryId, name, price, sort);
    if (serviceModel === 'finedine') {
        const tableLabel = lang === 'es' ? 'M' : lang === 'pt' ? 'M' : 'T';
        insertTable(db, 'tbl-demo-1', `${tableLabel}1`, 4);
        insertTable(db, 'tbl-demo-2', `${tableLabel}2`, 4);
        insertTable(db, 'tbl-demo-3', `${tableLabel}3`, 6);
        insertTable(db, 'tbl-demo-4', `${tableLabel}4`, 2);
    }
    // Country selection is independent from UI language. When callers omit it,
    // use the setup country's default (India) rather than deriving a country from
    // the language selected for the setup wizard.
    const demoCountry = country || 'IN';
    const dialCode = dialCodeFor(demoCountry);
    if (lang === 'es') {
        insertCustomer(db, 'cust-demo-1', 'Juan Pérez', '1145678901', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-2', 'María González', '1145678902', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-3', 'Carlos Rodríguez', '1145678903', dialCode, demoCountry);
    }
    else if (lang === 'fr') {
        insertCustomer(db, 'cust-demo-1', 'Camille Martin', '+33145678901', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-2', 'Julien Bernard', '+33145678902', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-3', 'Sophie Dubois', '+33145678903', dialCode, demoCountry);
    }
    else if (lang === 'pt') {
        insertCustomer(db, 'cust-demo-1', 'João Silva', '1198765432', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-2', 'Maria Santos', '1198765433', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-3', 'Carlos Oliveira', '1198765434', dialCode, demoCountry);
    }
    else if (lang === 'de') {
        insertCustomer(db, 'cust-demo-1', 'Anna Müller', '15123456789', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-2', 'Lukas Schneider', '15123456790', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-3', 'Sophie Weber', '15123456791', dialCode, demoCountry);
    }
    else if (lang === 'tr') {
        insertCustomer(db, 'cust-demo-1', 'Ayşe Yılmaz', '5321234567', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-2', 'Mehmet Kaya', '5321234568', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-3', 'Elif Demir', '5321234569', dialCode, demoCountry);
    }
    else if (lang === 'fa') {
        insertCustomer(db, 'cust-demo-1', 'علی رضایی', '9121234567', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-2', 'سارا محمدی', '9121234568', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-3', 'مریم کریمی', '9121234569', dialCode, demoCountry);
    }
    else {
        insertCustomer(db, 'cust-demo-1', 'Aarav Sharma', '9876543210', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-2', 'Maya Iyer', '9876543211', dialCode, demoCountry);
        insertCustomer(db, 'cust-demo-3', 'Kabir Khan', '9876543212', dialCode, demoCountry);
    }
    const managerName = lang === 'es' ? 'Gerente Demo' : lang === 'fr' ? 'Gérant Démo' : lang === 'pt' ? 'Gerente Demo'
        : lang === 'de' ? 'Demo-Manager' : lang === 'tr' ? 'Demo Müdürü' : lang === 'fa' ? 'مدیر نمایشی' : 'Demo Manager';
    const cashierName = lang === 'es' ? 'Cajero Demo' : lang === 'fr' ? 'Caissier Démo' : lang === 'pt' ? 'Caixa Demo'
        : lang === 'de' ? 'Demo-Kassierer' : lang === 'tr' ? 'Demo Kasiyer' : lang === 'fa' ? 'صندوقدار نمایشی' : 'Demo Cashier';
    const chefName = lang === 'es' ? 'Cocinero Demo' : lang === 'fr' ? 'Chef Démo' : lang === 'pt' ? 'Cozinheiro Demo'
        : lang === 'de' ? 'Demo-Koch' : lang === 'tr' ? 'Demo Aşçı' : lang === 'fa' ? 'آشپز نمایشی' : 'Demo Chef';
    // Demo staff remains useful as localized sample rows, but must never ship with
    // a reusable public credential. The inactive rows can be explicitly replaced
    // by an owner during setup if staff access is wanted.
    insertStaffUser(db, 'user-demo-manager', managerName, 'manager@flo.local', 'manager', (0, crypto_1.randomBytes)(32).toString('hex'), 0);
    insertStaffUser(db, 'user-demo-cashier', cashierName, 'cashier@flo.local', 'cashier', (0, crypto_1.randomBytes)(32).toString('hex'), 0);
    insertStaffUser(db, 'user-demo-chef', chefName, 'chef@flo.local', 'chef', (0, crypto_1.randomBytes)(32).toString('hex'), 0);
}
function seedSetupProfile(db, profile, serviceModel, language, country) {
    if (profile === 'express') {
        seedExpressRestaurant(db, serviceModel, language);
    }
    else if (profile === 'demo') {
        seedDemoRestaurant(db, serviceModel, language, country);
    }
}
function isLocalSetupRequest(req) {
    const remoteAddress = req.socket.remoteAddress || req.ip || '';
    return LOCAL_SETUP_HOSTS.has(remoteAddress) || remoteAddress.startsWith('127.');
}
function requireLocalSetup(req, res) {
    if (isLocalSetupRequest(req))
        return true;
    res.status(403).json({ error: 'Initial setup must be completed on the POS computer.' });
    return false;
}
// ── Rate Limiting (In-Memory for local offline apps) ──────────────────────────
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const passwordChangeAttempts = new Map();
const PASSWORD_CHANGE_MAX_ATTEMPTS = 5;
const PASSWORD_CHANGE_LOCKOUT_MINUTES = 5;
function checkRateLimit(ip) {
    const nowMs = Date.now();
    let record = loginAttempts.get(ip);
    if (record) {
        if (record.lockedUntil > nowMs) {
            const waitMinutes = Math.ceil((record.lockedUntil - nowMs) / 60000);
            return { allowed: false, waitMinutes };
        }
        // If lock expired, reset
        if (record.lockedUntil > 0 && record.lockedUntil <= nowMs) {
            record = { count: 0, lockedUntil: 0 };
            loginAttempts.set(ip, record);
        }
    }
    return { allowed: true };
}
function incrementFailedLogin(ip) {
    const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    record.count += 1;
    if (record.count >= MAX_ATTEMPTS) {
        record.lockedUntil = Date.now() + LOCKOUT_MINUTES * 60000;
    }
    loginAttempts.set(ip, record);
    return Math.max(0, MAX_ATTEMPTS - record.count);
}
function resetSuccessfulLogin(ip) {
    loginAttempts.delete(ip);
}
function checkPasswordChangeRateLimit(userId) {
    const nowMs = Date.now();
    const record = passwordChangeAttempts.get(userId);
    if (record?.lockedUntil && record.lockedUntil > nowMs) {
        return { allowed: false, waitMinutes: Math.ceil((record.lockedUntil - nowMs) / 60000) };
    }
    if (record?.lockedUntil && record.lockedUntil <= nowMs) {
        passwordChangeAttempts.delete(userId);
    }
    return { allowed: true };
}
function incrementFailedPasswordChange(userId) {
    const record = passwordChangeAttempts.get(userId) || { count: 0, lockedUntil: 0 };
    record.count += 1;
    if (record.count >= PASSWORD_CHANGE_MAX_ATTEMPTS) {
        record.lockedUntil = Date.now() + PASSWORD_CHANGE_LOCKOUT_MINUTES * 60000;
    }
    passwordChangeAttempts.set(userId, record);
    return Math.max(0, PASSWORD_CHANGE_MAX_ATTEMPTS - record.count);
}
function resetPasswordChangeRateLimit(userId) {
    passwordChangeAttempts.delete(userId);
}
// ─────────────────────────────────────────────────────────────────────────────
// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', (0, security_1.authRateLimit)(), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const rateLimit = checkRateLimit(ip);
        if (!rateLimit.allowed) {
            return res.status(429).json({ error: `Too many failed attempts. Try again in ${rateLimit.waitMinutes} minutes.` });
        }
        const email = normalizeEmail(req.body?.email);
        const { password, rememberMe } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        const db = (0, db_1.getDatabase)();
        const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
        let passwordMatches = false;
        if (user) {
            try {
                passwordMatches = await bcryptjs_1.default.compare(password, user.password);
            }
            catch {
                passwordMatches = false;
            }
        }
        if (!user || !passwordMatches) {
            const attemptsRemaining = incrementFailedLogin(ip);
            return res.status(401).json({
                error: 'Invalid credentials',
                attempts_remaining: attemptsRemaining,
                lockout_minutes: attemptsRemaining === 0 ? LOCKOUT_MINUTES : undefined,
            });
        }
        resetSuccessfulLogin(ip);
        const remember = !!rememberMe;
        const token = jsonwebtoken_1.default.sign({ userId: user.id, email: user.email, role: user.role, remember, jti: (0, crypto_1.randomUUID)() }, getJWTSecret(), { expiresIn: expiresInFor(remember) });
        const tenant = buildLocalTenant(db, user.role);
        res.json({
            access_token: token,
            token_type: 'bearer',
            expires_in: remember ? JWT_REMEMBER_EXPIRES_IN_SECONDS : 86400,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                category_ids: parseCategoryIds(user.category_ids),
            },
            // Single tenant — frontend auto-selects when tenants.length === 1
            tenants: [tenant],
        });
    }
    catch (error) {
        console.error('[Auth] Login error:', error);
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}));
// ── POST /api/auth/login-pin ─────────────────────────────────────────────────
const PIN_LOGIN_REGEX = /^\d{4,6}$/;
router.post('/login-pin', (0, security_1.authRateLimit)(), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const rateLimit = checkRateLimit(ip);
        if (!rateLimit.allowed) {
            return res.status(429).json({ error: `Too many failed attempts. Try again in ${rateLimit.waitMinutes} minutes.` });
        }
        const { pin } = req.body || {};
        if (!pin || !PIN_LOGIN_REGEX.test(String(pin))) {
            return res.status(400).json({ error: 'A 4-6 digit PIN is required' });
        }
        const db = (0, db_1.getDatabase)();
        const candidates = db.prepare("SELECT * FROM users WHERE is_active = 1 AND pin_hash IS NOT NULL AND role IN ('owner', 'manager')").all();
        const matched = candidates.find((u) => (0, db_1.verifyPin)(u.pin_hash, pin));
        if (!matched) {
            const attemptsRemaining = incrementFailedLogin(ip);
            return res.status(401).json({
                error: 'Invalid PIN',
                attempts_remaining: attemptsRemaining,
                lockout_minutes: attemptsRemaining === 0 ? LOCKOUT_MINUTES : undefined,
            });
        }
        resetSuccessfulLogin(ip);
        const remember = !!req.body?.rememberMe;
        const token = jsonwebtoken_1.default.sign({ userId: matched.id, email: matched.email, role: matched.role, remember, jti: (0, crypto_1.randomUUID)() }, getJWTSecret(), { expiresIn: expiresInFor(remember) });
        const tenant = buildLocalTenant(db, matched.role);
        res.json({
            access_token: token,
            token_type: 'bearer',
            expires_in: remember ? JWT_REMEMBER_EXPIRES_IN_SECONDS : 86400,
            user: {
                id: matched.id,
                name: matched.name,
                email: matched.email,
                role: matched.role,
                category_ids: parseCategoryIds(matched.category_ids),
            },
            tenants: [tenant],
        });
    }
    catch (error) {
        console.error('[Auth] PIN login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// ── POST /api/auth/tenants/select ─────────────────────────────────────────────
// Frontend calls this after login (even when auto-selecting the single tenant).
router.post('/tenants/select', (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        if ((0, security_1.isTokenRevoked)(token)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const decoded = jsonwebtoken_1.default.verify(token, getJWTSecret());
        const db = (0, db_1.getDatabase)();
        const user = db.prepare('SELECT id, name, email, role, is_active, tokens_valid_after FROM users WHERE id = ?').get(decoded.userId);
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        if (user.is_active !== 1 || (0, security_1.isTokenStale)(decoded.iat, user.tokens_valid_after)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const tenant = buildLocalTenant(db, user.role);
        // Re-issue token with tenant context embedded (same payload — desktop is single-tenant)
        const remember = !!decoded.remember;
        const newToken = jsonwebtoken_1.default.sign({ userId: user.id, email: user.email, role: user.role, tenantId: 1, remember, jti: (0, crypto_1.randomUUID)() }, getJWTSecret(), { expiresIn: expiresInFor(remember) });
        res.json({
            access_token: newToken,
            token_type: 'bearer',
            tenant,
        });
    }
    catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});
// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice('Bearer '.length);
        try {
            const decoded = jsonwebtoken_1.default.verify(token, getJWTSecret());
            (0, security_1.revokeToken)(token, typeof decoded.exp === 'number' ? decoded.exp * 1000 : undefined);
        }
        catch {
            // Logout is intentionally idempotent; invalid credentials are not
            // persisted as revocations and are still answered successfully.
        }
    }
    res.json({ message: 'Logged out successfully' });
});
// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        if ((0, security_1.isTokenRevoked)(token)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const decoded = jsonwebtoken_1.default.verify(token, getJWTSecret());
        // Without this, a token minted before a password/PIN change (#173) could
        // keep refreshing itself into new tokens forever, bypassing revocation entirely.
        const db = (0, db_1.getDatabase)();
        const user = db.prepare('SELECT is_active, tokens_valid_after FROM users WHERE id = ?').get(decoded.userId);
        if (!user || user.is_active !== 1 || (0, security_1.isTokenStale)(decoded.iat, user.tokens_valid_after)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const remember = !!decoded.remember;
        const newToken = jsonwebtoken_1.default.sign({ userId: decoded.userId, email: decoded.email, role: decoded.role, tenantId: decoded.tenantId, remember, jti: (0, crypto_1.randomUUID)() }, getJWTSecret(), { expiresIn: expiresInFor(remember) });
        res.json({
            access_token: newToken,
            token_type: 'bearer',
            expires_in: remember ? JWT_REMEMBER_EXPIRES_IN_SECONDS : 86400,
        });
    }
    catch {
        res.status(401).json({ error: 'Invalid token' });
    }
});
// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        if ((0, security_1.isTokenRevoked)(token)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const decoded = jsonwebtoken_1.default.verify(token, getJWTSecret());
        const db = (0, db_1.getDatabase)();
        const user = db.prepare('SELECT id, name, email, role, is_active, tokens_valid_after FROM users WHERE id = ?').get(decoded.userId);
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        if (user.is_active !== 1 || (0, security_1.isTokenStale)(decoded.iat, user.tokens_valid_after)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const tenant = buildLocalTenant(db, user.role);
        res.json({
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
            tenants: [tenant],
        });
    }
    catch {
        res.status(401).json({ error: 'Invalid token' });
    }
});
// ── POST /api/auth/password/change ────────────────────────────────────────────
router.post('/password/change', (0, security_1.authRateLimit)(), (req, res) => {
    try {
        const { current_password, password } = req.body || {};
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        if ((0, security_1.isTokenRevoked)(token)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const decoded = jsonwebtoken_1.default.verify(token, getJWTSecret());
        const db = (0, db_1.getDatabase)();
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        if (user.is_active !== 1 || (0, security_1.isTokenStale)(decoded.iat, user.tokens_valid_after)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const passwordChangeRateLimit = checkPasswordChangeRateLimit(user.id);
        if (!passwordChangeRateLimit.allowed) {
            return res.status(429).json({
                error: `Too many password change attempts. Try again in ${passwordChangeRateLimit.waitMinutes} minutes.`,
            });
        }
        if (typeof current_password !== 'string' || !current_password) {
            return res.status(400).json({ error: 'Current password is required' });
        }
        if (typeof password !== 'string' || !password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        if (!bcryptjs_1.default.compareSync(current_password, user.password)) {
            const attemptsRemaining = incrementFailedPasswordChange(user.id);
            return res.status(400).json({
                error: 'Current password is incorrect',
                attempts_remaining: attemptsRemaining,
                lockout_minutes: attemptsRemaining === 0 ? PASSWORD_CHANGE_LOCKOUT_MINUTES : undefined,
            });
        }
        resetPasswordChangeRateLimit(user.id);
        if (!(0, security_1.validatePassword)(password)) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number.' });
        }
        const hashedPassword = bcryptjs_1.default.hashSync(password, 10);
        const changedAt = (0, db_1.now)();
        db.prepare('UPDATE users SET password = ?, tokens_valid_after = ?, updated_at = ? WHERE id = ?')
            .run(hashedPassword, changedAt, changedAt, decoded.userId);
        (0, security_1.invalidateUserAuthCache)(decoded.userId);
        res.json({ message: 'Password changed successfully' });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ── POST /api/auth/recover-password ───────────────────────────────────────────
// Local, unauthenticated-but-PIN-gated recovery for a locked-out owner (#127).
//
// Deliberately does NOT require a JWT/session — that's the whole point: the
// owner has no working credentials. Local proof of ownership is the Master
// PIN instead (see main/services/master-pin.ts). When no active owner remains,
// this endpoint restores owner role to one active account. It can never create,
// reinitialize, or wipe anything — that stays behind /api/db-tools/initialize
// (owner session + Master PIN + explicit confirmation phrase).
//
// No remote backdoor: nothing here lets a Flo cloud server or anyone without
// physical/local access to this machine set the password. See #128 for the
// signup-time copy explaining this to the owner, and the scope note in this
// PR for why the optional cloud/email identity-verification tier described in
// the issue is intentionally NOT implemented here (no cloud server exists in
// this repo to issue the short-lived signed grant safely).
router.post('/recover-password', (0, security_1.authRateLimit)(), (req, res) => {
    try {
        if (!requireLocalSetup(req, res))
            return;
        const db = (0, db_1.getDatabase)();
        // First-run setup is the only recovery path when there is no owner yet —
        // never let this endpoint substitute for /setup/initialize.
        if (getUserCount(db) === 0) {
            return res.status(409).json({ error: 'Setup has not been completed yet. Use first-run setup to create the owner account.' });
        }
        const email = normalizeEmail(req.body?.email);
        const { master_pin, new_password } = req.body || {};
        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ error: 'A valid email is required' });
        }
        if (!new_password || !(0, security_1.validatePassword)(new_password)) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number.' });
        }
        // Rate-limit key is IP-scoped only (not email-scoped) so an attacker can't
        // reset the Master PIN attempt counter simply by guessing a different
        // email address on each request.
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const pinResult = (0, master_pin_1.authorizeMasterPin)(master_pin, `auth:recover-password:${ip}`);
        if (!pinResult.ok) {
            return res.status(pinResult.status).json({ error: pinResult.error });
        }
        const activeOwnerCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND is_active = 1").get().count;
        const user = activeOwnerCount === 0
            ? db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email)
            : db.prepare('SELECT * FROM users WHERE email = ? AND role = ? AND is_active = 1').get(email, INITIAL_ADMIN_ROLE);
        if (!user) {
            return res.status(404).json({ error: 'No active owner account found with that email on this install' });
        }
        const hashedPassword = bcryptjs_1.default.hashSync(new_password, 10);
        const changedAt = (0, db_1.now)();
        let restoredOwnerAccess = false;
        const updated = db.transaction(() => {
            const currentOwnerCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND is_active = 1").get().count;
            if (currentOwnerCount > 0) {
                return db.prepare('UPDATE users SET password = ?, tokens_valid_after = ?, updated_at = ? WHERE id = ? AND role = ? AND is_active = 1')
                    .run(hashedPassword, changedAt, changedAt, user.id, INITIAL_ADMIN_ROLE);
            }
            restoredOwnerAccess = true;
            return db.prepare(`
        UPDATE users SET password = ?, role = ?, tokens_valid_after = ?, updated_at = ?
        WHERE id = ? AND is_active = 1
          AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner' AND is_active = 1)
      `).run(hashedPassword, INITIAL_ADMIN_ROLE, changedAt, changedAt, user.id);
        })();
        if (updated.changes === 0) {
            return res.status(409).json({ error: 'Owner access changed during recovery. Try again.' });
        }
        (0, security_1.invalidateUserAuthCache)(user.id);
        // Local audit trail — this codebase has no dedicated audit-events table,
        // so we follow its existing convention: a tagged console log (grep-able
        // in the app's log file) plus a timestamp/identity pair in `settings`,
        // the same generic key/value mechanism already used for e.g.
        // `telemetry_last_ping_at`.
        upsertSettings(db, {
            last_password_recovery_at: (0, db_1.now)(),
            last_password_recovery_user_id: String(user.id),
            ...(restoredOwnerAccess ? {
                last_owner_recovery_at: (0, db_1.now)(),
                last_owner_recovery_user_id: String(user.id),
            } : {}),
        });
        console.warn(`[Auth] Password recovery: ${restoredOwnerAccess ? 'owner access' : 'owner password'} was reset locally via Master PIN for user ${user.id}`);
        res.json({ message: restoredOwnerAccess
                ? 'Owner access restored. You can now log in with your new password.'
                : 'Password reset successfully. You can now log in with your new password.' });
    }
    catch (error) {
        console.error('[Auth] Password recovery error:', error);
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ── GET /api/auth/setup/status ──────────────────────────────────────────────────
// Returns whether the app needs setup (no users exist yet)
router.get('/setup/status', (_req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const userCount = getUserCount(db);
        const needsSetup = userCount === 0;
        res.json({
            needsSetup,
            userCount,
            initialRole: INITIAL_ADMIN_ROLE,
            schemaVersion: (0, db_1.getCurrentSchemaVersion)(),
            masterPinAvailable: (0, master_pin_1.isMasterPinAvailable)(),
        });
    }
    catch (error) {
        console.error("[API] Internal error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ── POST /api/auth/setup/initialize ─────────────────────────────────────────────
// Creates the initial owner user. This endpoint is disabled after any user exists.
router.post('/setup/initialize', (req, res) => {
    try {
        if (!requireLocalSetup(req, res))
            return;
        // Guard the disabled-setup state before any payload validation: once an
        // owner exists this endpoint must always answer 403, and an invalid field
        // (e.g. a bad timezone) must not downgrade that to a 400.
        const db = (0, db_1.getDatabase)();
        if (getUserCount(db) > 0) {
            return res.status(403).json({ error: 'Setup already complete. This endpoint is disabled.' });
        }
        const { name, password, business_type = 'restaurant', setup_profile = 'express', service_model = 'qsr', language, business_name, store_name, country = 'IN', currency = 'INR', currency_symbol, timezone = 'Asia/Kolkata', business_address, address, business_phone, phone, tax_registration_number, state_code, tax_registered, billing_type, terms_accepted, master_pin, cloud_server_url, email_product_updates, email_marketing, } = req.body;
        const email = normalizeEmail(req.body.email);
        const displayName = String(name || '').trim();
        const normalizedBusinessType = String(business_type || 'restaurant').trim();
        const normalizedSetupProfile = String(setup_profile || 'express').trim().toLowerCase();
        const normalizedServiceModel = String(service_model || 'qsr').trim().toLowerCase();
        const normalizedCurrency = String(currency || 'INR').trim().toUpperCase();
        if (!(0, countries_1.isValidTimeZone)(timezone)) {
            return res.status(400).json({ error: 'Invalid timezone' });
        }
        const storeName = String(store_name || business_name || '').trim();
        const resolvedStoreName = storeName || 'Store';
        const outletAddress = String(business_address || address || '').trim();
        const rawOutletPhone = String(business_phone || phone || '').trim();
        let outletPhone = '';
        if (rawOutletPhone) {
            const normPhone = (0, phone_1.normalizeOptionalPhone)(rawOutletPhone, country);
            if (!normPhone.valid) {
                return res.status(400).json({ error: normPhone.error || 'Invalid business phone number' });
            }
            outletPhone = normPhone.e164 || '';
        }
        if (!displayName || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        if (!(0, security_1.validatePassword)(password)) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number.' });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'A valid email is required' });
        }
        if (terms_accepted !== true) {
            return res.status(400).json({ error: 'You must accept the Terms and Conditions, Privacy Policy, and No Warranty Disclaimer to continue.' });
        }
        const masterPinRequired = (0, master_pin_1.isMasterPinAvailable)();
        if (masterPinRequired && !/^\d{4}$/.test(String(master_pin || ''))) {
            return res.status(400).json({ error: 'A 4-digit Master PIN is required to complete setup' });
        }
        if (!VALID_BUSINESS_TYPES.has(normalizedBusinessType)) {
            return res.status(400).json({ error: 'FloCafe setup only supports restaurant businesses' });
        }
        if (!VALID_SETUP_PROFILES.has(normalizedSetupProfile)) {
            return res.status(400).json({ error: 'Invalid setup profile' });
        }
        if (!VALID_SERVICE_MODELS.has(normalizedServiceModel)) {
            return res.status(400).json({ error: 'Invalid service model' });
        }
        // Cloud v2 registers the POS automatically on first boot. There is no
        // pending/claim step, so new installs start with cloud coordination on.
        const cloudSyncEnabled = true;
        let normalizedCloudServerUrl;
        if (cloudSyncEnabled) {
            try {
                normalizedCloudServerUrl = (0, cloud_sync_1.normalizeCloudServerUrl)(cloud_server_url || cloud_sync_1.DEFAULT_CLOUD_SERVER_URL);
            }
            catch {
                return res.status(400).json({ error: 'Cloud server URL must be a valid HTTPS URL' });
            }
        }
        let userId = '';
        const hashedPassword = bcryptjs_1.default.hashSync(password, 10);
        // Persist the external Master PIN before committing the owner transaction.
        // A keyring/filesystem failure must leave setup retryable rather than
        // returning 500 after the database already contains an owner.
        if (masterPinRequired) {
            (0, master_pin_1.setMasterPin)(String(master_pin));
        }
        db.transaction(() => {
            const userCount = getUserCount(db);
            if (userCount > 0) {
                throw new Error('Setup already complete. This endpoint is disabled.');
            }
            const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
            if (existingUser) {
                throw new Error('User with this email already exists');
            }
            userId = (0, crypto_1.randomUUID)();
            db.prepare(`
        INSERT INTO users (id, name, email, password, role, is_active, terms_accepted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, displayName, email, hashedPassword, INITIAL_ADMIN_ROLE, 1, (0, db_1.now)(), (0, db_1.now)(), (0, db_1.now)());
            upsertSettings(db, {
                business_name: resolvedStoreName,
                business_type: normalizedBusinessType,
                country,
                currency: normalizedCurrency,
                currency_symbol: currency_symbol || (0, countries_1.getCurrencySymbol)(normalizedCurrency, (0, countries_1.getCountryByCode)(country)?.locale),
                timezone,
                language,
                business_address: outletAddress,
                business_phone: outletPhone,
                address: outletAddress,
                phone: outletPhone,
                email,
                tax_registration_number,
                state_code,
                tax_registered,
                billing_type: billing_type || (normalizedServiceModel === 'qsr' ? 'prepaid' : 'postpaid'),
                tables_required: normalizedServiceModel === 'finedine' ? 'true' : 'false',
                service_model: normalizedServiceModel,
                setup_profile: normalizedSetupProfile,
                onboarding_completed: 'true',
                // Completing setup is not by itself a country choice: the wizard
                // preselects IN and submits it whether or not the picker was touched.
                // Only a country that differs from the seeded default — or a client
                // that reports the selection outright — counts.
                ...(0, country_provenance_1.countryConfirmationPatch)(country, (0, db_1.getSettingValue)('country'), req.body.country_selected),
                anonymous_data_consent: 'true',
                telemetry_enabled: 'true',
                telemetry_scope: 'usage_stats,country,app_version,platform,session_duration,feature_usage,error_diagnostics',
                split_checks_enabled: 'false',
                // '1'/'0', not 'true'/'false' — mirrors FloAdmin's own `stores` table and
                // matches how cloud-sync.ts reads this key everywhere else.
                cloud_sync_enabled: cloudSyncEnabled ? '1' : '0',
                cloud_server_url: normalizedCloudServerUrl || cloud_sync_1.DEFAULT_CLOUD_SERVER_URL,
                email_product_updates: email_product_updates === true ? 'true' : 'false',
                email_marketing: email_marketing === true ? 'true' : 'false',
                cloud_services_disabled_by_user: 'false',
            });
            seedSetupProfile(db, normalizedSetupProfile, normalizedServiceModel, language, country);
        })();
        // Pick up the cloud settings just written without requiring a restart —
        // mirrors PUT /api/settings/cloud's own reload() call. Cloud coordination
        // is best-effort: a network/profile failure must not make a completed local
        // setup appear to have failed.
        try {
            cloud_sync_1.cloudSync.reload();
        }
        catch (error) {
            console.warn('[Auth] Cloud settings reload deferred after setup:', error);
        }
        try {
            cloud_sync_1.cloudSync.refreshRegistrationProfile();
        }
        catch (error) {
            console.warn('[Auth] Cloud registration profile refresh deferred after setup:', error);
        }
        const token = jsonwebtoken_1.default.sign({ userId, email, role: INITIAL_ADMIN_ROLE, jti: (0, crypto_1.randomUUID)() }, getJWTSecret(), { expiresIn: JWT_EXPIRES_IN });
        const tenant = buildLocalTenant(db, INITIAL_ADMIN_ROLE);
        res.json({
            access_token: token,
            token_type: 'bearer',
            expires_in: 86400,
            user: { id: userId, name: displayName, email, role: INITIAL_ADMIN_ROLE },
            tenant,
            tenants: [tenant],
        });
    }
    catch (error) {
        console.error('[Auth] Setup error:', error);
        const message = error.message || 'Setup failed';
        const status = message.includes('already complete') ? 403
            : message.includes('already exists') ? 400
                : 500;
        res.status(status).json({ error: status === 500 ? 'Setup failed' : message });
    }
});
// ── POST /api/auth/setup/seed ───────────────────────────────────────────────────
// Legacy endpoint retained only to return a clear error. First-run setup must
// create the owner through /setup/initialize and pass the selected seed profile.
router.post('/setup/seed', (req, res) => {
    res.status(410).json({ error: 'Use /api/auth/setup/initialize with setup_profile and owner details.' });
});
exports.authRoutes = router;
//# sourceMappingURL=auth.js.map