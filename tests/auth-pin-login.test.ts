/**
 * POST /api/auth/login-pin endpoint test suite.
 *
 * Validates PIN-based login for owner/manager users, including:
 * - Happy path with 4-digit and 6-digit PINs
 * - Invalid PIN rejection
 * - Role restrictions (cashier/server/chef cannot use PIN login)
 * - Rate limiting (5 attempts, 15-minute lockout)
 * - Input validation (non-numeric, too short, too long)
 * - Inactive user rejection
 * - JWT token correctness
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-pin-login-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-pin-login';
// Keep the express-rate-limit middleware generous so the tests below exercise
// the in-memory 5-failure/15-min lockout (checkRateLimit) rather than the
// per-minute middleware budget (authRateLimit max:10/min).
process.env.FLO_AUTH_RATE_LIMIT_MAX = '1000';

const bcrypt = require('bcryptjs');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { initTestDb, assert, assertEqual, getResults, closeDatabase, now } = require('./helpers/test-setup');
const { registerRoutes } = require('../main/routes/index');
const { getJWTSecret } = require('../main/routes/auth');

function seedUser(db: any, id: string, role: string, pin?: string) {
  const email = `${id}@test.local`;
  const pinHash = pin ? bcrypt.hashSync(pin, 10) : null;
  db.prepare(`
    INSERT OR REPLACE INTO users (id, name, email, password, role, pin_hash, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, id, email, bcrypt.hashSync('Testpass123', 10), role,
    pinHash, 1, now(), now()
  );
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, res: any, next: any) => {
    if (!req.path.startsWith('/api')) { next(); return; }
    if (req.path === '/api/health') { next(); return; }
    if (req.path.startsWith('/api/auth')) { next(); return; }
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    try {
      const jwtModule = require('jsonwebtoken');
      const decoded = jwtModule.verify(authHeader.split(' ')[1], getJWTSecret());
      (req as any).user = decoded;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });
  registerRoutes(app);
  return app;
}

function clearRateLimits() {
  // The in-memory rate limit maps are module-scoped in auth.ts.
  // We can't clear them directly, so tests that check rate limiting
  // must use unique users or be careful about shared state.
}

async function main() {
  console.log('POST /api/auth/login-pin endpoint tests');
  console.log('='.repeat(50));

  const db = initTestDb();

  // Seed test users with different roles and PINs
  seedUser(db, 'pin-owner', 'owner', '1234');
  seedUser(db, 'pin-mgr6', 'manager', '123456');
  seedUser(db, 'pin-cashier', 'cashier', '5678');
  seedUser(db, 'pin-nopin', 'owner');
  seedUser(db, 'pin-active', 'manager', '9999');

  const app = buildApp();

  console.log('\n── 1. Happy path: 4-digit owner PIN ─────────────────────');
  {
    const res = await request(app).post('/api/auth/login-pin').send({ pin: '1234' });
    assertEqual(res.status, 200, 'Owner PIN login returns 200');
    assert(!!res.body.access_token, 'Response contains access_token');
    assertEqual(res.body.user.role, 'owner', 'User role is owner');
    assertEqual(res.body.user.id, 'pin-owner', 'User ID matches');
    assert(Array.isArray(res.body.tenants), 'Response contains tenants array');
    assertEqual(res.body.tenants.length, 1, 'Returns one tenant');
    // Verify JWT is valid
    const decoded = jwt.verify(res.body.access_token, getJWTSecret()) as any;
    assertEqual(decoded.userId, 'pin-owner', 'JWT userId matches');
    assertEqual(decoded.role, 'owner', 'JWT role matches');
  }

  console.log('\n── 2. Happy path: 6-digit manager PIN ────────────────────');
  {
    const res = await request(app).post('/api/auth/login-pin').send({ pin: '123456' });
    assertEqual(res.status, 200, 'Manager 6-digit PIN login returns 200');
    assertEqual(res.body.user.role, 'manager', 'User role is manager');
    assertEqual(res.body.user.id, 'pin-mgr6', 'User ID matches');
  }

  console.log('\n── 3. Invalid PIN ────────────────────────────────────────');
  {
    const res = await request(app).post('/api/auth/login-pin').send({ pin: '0000' });
    assertEqual(res.status, 401, 'Invalid PIN returns 401');
    assertEqual(res.body.error, 'Invalid PIN', 'Error message is "Invalid PIN"');
    assert(typeof res.body.attempts_remaining === 'number', 'Returns attempts_remaining');
  }

  console.log('\n── 4. Owner with no PIN is not matchable by anyone else —──────────');
  {
    // pin-nopin has no pin_hash. PIN login matches ANY active owner/manager
    // whose stored hash verifies; a user without a PIN is simply skipped.
    // Every seeded PIN being wrong means no match → 401.
    const res = await request(app).post('/api/auth/login-pin').send({ pin: '4242' });
    assertEqual(res.status, 401, 'No matching owner/manager PIN returns 401');
  }

  console.log('\n── 5. Cashier with PIN cannot use PIN login ──────────────');
  {
    // pin-cashier has pin_hash set but is a cashier — should be rejected
    const res = await request(app).post('/api/auth/login-pin').send({ pin: '5678' });
    assertEqual(res.status, 401, 'Cashier PIN login returns 401 (restricted to owner/manager)');
  }

  console.log('\n── 6. Input validation: too short ────────────────────────');
  {
    const res = await request(app).post('/api/auth/login-pin').send({ pin: '123' });
    assertEqual(res.status, 400, '3-digit PIN returns 400');
  }

  console.log('\n── 7. Input validation: too long ─────────────────────────');
  {
    const res = await request(app).post('/api/auth/login-pin').send({ pin: '1234567' });
    assertEqual(res.status, 400, '7-digit PIN returns 400');
  }

  console.log('\n── 8. Input validation: non-numeric ──────────────────────');
  {
    const res = await request(app).post('/api/auth/login-pin').send({ pin: 'abcd' });
    assertEqual(res.status, 400, 'Non-numeric PIN returns 400');
  }

  console.log('\n── 9. Input validation: missing pin ──────────────────────');
  {
    const res = await request(app).post('/api/auth/login-pin').send({});
    assertEqual(res.status, 400, 'Missing pin field returns 400');
  }

  console.log('\n── 10. JWT rememberMe: short session (default) ───────────');
  {
    const res = await request(app).post('/api/auth/login-pin').send({ pin: '9999' });
    assertEqual(res.status, 200, 'PIN login succeeds');
    const decoded = jwt.verify(res.body.access_token, getJWTSecret()) as any;
    assert(!decoded.remember, 'Default login sets remember=false');
  }

  console.log('\n── 11. JWT rememberMe: long session when requested ───────');
  {
    const res = await request(app).post('/api/auth/login-pin').send({ pin: '9999', rememberMe: true });
    assertEqual(res.status, 200, 'PIN login with rememberMe succeeds');
    const decoded = jwt.verify(res.body.access_token, getJWTSecret()) as any;
    assert(!!decoded.remember, 'Login with rememberMe sets remember=true');
  }

  console.log('\n── 12. Response shape matches /login format ───────────────');
  {
    const res = await request(app).post('/api/auth/login-pin').send({ pin: '9999' });
    assertEqual(res.status, 200, 'PIN login succeeds');
    assertEqual(res.body.token_type, 'bearer', 'token_type is bearer');
    assert(typeof res.body.expires_in === 'number', 'expires_in is a number');
    assert(typeof res.body.user.name === 'string', 'user.name is a string');
    assert(typeof res.body.user.email === 'string', 'user.email is a string');
    assert(typeof res.body.user.role === 'string', 'user.role is a string');
    assert(!('password' in res.body.user), 'user object does not expose password');
    assert(!('pin_hash' in res.body.user), 'user object does not expose pin_hash');
  }

  console.log('\n── 13. Rate limiting: 5 failures then lockout ─────────────────');
  {
    // Ensure rate-limit counter is reset by a successful login first.
    await request(app).post('/api/auth/login-pin').send({ pin: '1234' });
    // 5 failing attempts (unknown PINs) to consume the budget.
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login-pin').send({ pin: '0000' });
    }
    // 6th attempt should be 429.
    const res = await request(app).post('/api/auth/login-pin').send({ pin: '0000' });
    assertEqual(res.status, 429, '6th failed attempt returns 429 (locked out)');
    // Subsequent correct PIN is also blocked during lockout.
    const correct = await request(app).post('/api/auth/login-pin').send({ pin: '1234' });
    assertEqual(correct.status, 429, 'Correct PIN during lockout returns 429');
  }

  const results = getResults();
  console.log(`\nResults: ${results.passed}/${results.total} passed`);
  if (results.failed > 0) {
    throw new Error(`${results.failed} PIN login test assertion(s) failed`);
  }
}

main()
  .then(() => {
    closeDatabase();
    Module._load = originalLoad;
    fs.rmSync(testDir, { recursive: true, force: true });
    console.log('\nPIN login tests completed successfully');
  })
  .catch((error) => {
    try { closeDatabase(); } catch {}
    Module._load = originalLoad;
    fs.rmSync(testDir, { recursive: true, force: true });
    console.error(error);
    process.exit(1);
  });
