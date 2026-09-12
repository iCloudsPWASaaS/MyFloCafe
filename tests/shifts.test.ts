/**
 * /api/shifts — open/close shift lifecycle.
 *
 * Verifies role gating, single-open-shift enforcement, amount validation, and
 * the cash expectation for a shift window (opening cash + net cash collections,
 * excluding non-cash methods and activity outside the window).
 *
 * Usage: node tests/run-electron-node-test.cjs tests/shifts.test.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-shifts-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-shifts';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { initDatabase, getDatabase, closeDatabase, now } = require('../main/db');
const { getJWTSecret } = require('../main/routes/auth');
const { shiftRoutes } = require('../main/routes/shifts');

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition: boolean, message: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  total++;
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function isNativeAbiMismatch(error: any): boolean {
  return error?.code === 'ERR_DLOPEN_FAILED' && String(error?.message || '').includes('NODE_MODULE_VERSION');
}

// Round to the nearest integer major unit (avoids float drift in assertions).
function round(n: number): number {
  return Math.round(n);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('/api/shifts — open/close shift lifecycle');
  console.log('='.repeat(56));

  try {
    initDatabase();
  } catch (error: any) {
    if (isNativeAbiMismatch(error)) {
      console.log('  ⚠ Skipping: better-sqlite3 ABI mismatch (run via Electron)');
      process.exit(77);
    }
    throw error;
  }

  const db = getDatabase();

  // ── Seed staff ────────────────────────────────────────────────────────
  const ownerId = 'owner-shifts';
  db.prepare(`INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(ownerId, 'Owner', 'owner-shifts@test.local', bcrypt.hashSync('pw', 10), 'owner', now(), now());
  const managerId = 'manager-shifts';
  db.prepare(`INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(managerId, 'Manager', 'manager-shifts@test.local', bcrypt.hashSync('pw', 10), 'manager', now(), now());
  const cashierId = 'cashier-shifts';
  db.prepare(`INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(cashierId, 'Cashier', 'cashier-shifts@test.local', bcrypt.hashSync('pw', 10), 'cashier', now(), now());

  const app = express();
  app.use(express.json());
  app.use((req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    try {
      req.user = jwt.verify(authHeader.split(' ')[1], getJWTSecret());
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });
  app.use('/api/shifts', shiftRoutes);

  const ownerToken = jwt.sign({ userId: ownerId, email: 'owner-shifts@test.local', role: 'owner' }, getJWTSecret(), { expiresIn: '1h' });
  const managerToken = jwt.sign({ userId: managerId, email: 'manager-shifts@test.local', role: 'manager' }, getJWTSecret(), { expiresIn: '1h' });
  const cashierToken = jwt.sign({ userId: cashierId, email: 'cashier-shifts@test.local', role: 'cashier' }, getJWTSecret(), { expiresIn: '1h' });

  let firstShiftId: number;
  let reopenedShiftId: number;

  try {
    console.log('\n1. Role gating');
    {
      const empty = await request(app).get('/api/shifts/current').set('Authorization', `Bearer ${cashierToken}`);
      assertEqual(empty.status, 200, `cashier may read current shift (got ${empty.status})`);
      assertEqual(empty.body.shift, null, 'no shift is open before the first open');

      // A cashier must be able to open a shift so the forced POS gate can't
      // lock a cashier-only shop out; closing stays owner/manager-only.
      const cashierOpen = await request(app).post('/api/shifts/open').set('Authorization', `Bearer ${cashierToken}`).send({ opening_cash: 100 });
      assertEqual(cashierOpen.status, 201, `cashier may open a shift (got ${cashierOpen.status})`);
      const cashierShiftId = cashierOpen.body.shift.id;

      const cashierClose = await request(app).post(`/api/shifts/${cashierShiftId}/close`).set('Authorization', `Bearer ${cashierToken}`).send({ closing_cash: 100 });
      assertEqual(cashierClose.status, 403, `cashier still cannot close a shift (got ${cashierClose.status})`);

      const ownerClose = await request(app).post(`/api/shifts/${cashierShiftId}/close`).set('Authorization', `Bearer ${ownerToken}`).send({ closing_cash: 100 });
      assertEqual(ownerClose.status, 200, `owner closes the cashier-opened shift (got ${ownerClose.status})`);

      const afterClose = await request(app).get('/api/shifts/current').set('Authorization', `Bearer ${cashierToken}`);
      assertEqual(afterClose.body.shift, null, 'no open shift remains after closing');

      const unauthenticated = await request(app).get('/api/shifts/current');
      assertEqual(unauthenticated.status, 401, 'unauthenticated request is rejected (got 401)');
    }

    console.log('\n2. Amount validation');
    {
      const bad = await request(app).post('/api/shifts/open').set('Authorization', `Bearer ${ownerToken}`).send({ opening_cash: 'abc' });
      assertEqual(bad.status, 400, `non-numeric opening_cash rejected (got ${bad.status})`);

      const negative = await request(app).post('/api/shifts/open').set('Authorization', `Bearer ${ownerToken}`).send({ opening_cash: -5 });
      assertEqual(negative.status, 400, `negative opening_cash rejected (got ${negative.status})`);

      // INR has 2 decimals, so a 3-decimal value must fail.
      const tooFine = await request(app).post('/api/shifts/open').set('Authorization', `Bearer ${ownerToken}`).send({ opening_cash: '12.345' });
      assertEqual(tooFine.status, 400, `over-precise opening_cash rejected (got ${tooFine.status})`);
    }

    console.log('\n3. Open a shift (manager)');
    const openRes = await request(app)
      .post('/api/shifts/open')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ opening_cash: 1000, notes: 'Morning shift' });
    assertEqual(openRes.status, 201, `manager opens a shift (got ${openRes.status}, ${JSON.stringify(openRes.body)})`);
    const shift = openRes.body.shift;
    assertEqual(shift.status, 'open', 'opened shift reports status open');
    assertEqual(Number(shift.opening_cash), 1000, 'opening cash echoes back');
    assertEqual(shift.opened_by, managerId, 'shift records the opening user');
    assertEqual(shift.notes, 'Morning shift', 'shift notes echo back');
    firstShiftId = shift.id;

    const current = await request(app).get('/api/shifts/current').set('Authorization', `Bearer ${cashierToken}`);
    assertEqual(current.status, 200, `cashier reads the open shift (got ${current.status})`);
    assertEqual(current.body.shift.id, firstShiftId, 'current shift is the one just opened');

    const duplicate = await request(app).post('/api/shifts/open').set('Authorization', `Bearer ${ownerToken}`).send({ opening_cash: 500 });
    assertEqual(duplicate.status, 409, `second open while one is active returns 409 (got ${duplicate.status})`);

    console.log('\n4. Cash expectation over the shift window');
    // Move into a fresh clock second so the seeded transactions land strictly
    // inside the shift window regardless of second-resolution boundaries.
    await sleep(1100);
    // A cash bill + a cash refund inside the window, a card bill inside the
    // window (non-cash, excluded), and a cash bill before the window (excluded).
    const openedAt = shift.opened_at;
    const beforeOpen = new Date(Date.parse(openedAt.replace(' ', 'T') + 'Z') - 3600 * 1000).toISOString();
    const inWindow = new Date().toISOString();

    const seedOrder = (orderNumber: string, userId: string) =>
      (db.prepare(`
        INSERT INTO orders (order_number, user_id, type, status, subtotal, total, created_at, updated_at)
        VALUES (?, ?, 'takeaway', 'completed', 0, 0, ?, ?)
      `).run(orderNumber, userId, now(), now())).lastInsertRowid;

    const seedBill = (orderId: number | bigint, number: string, total: number, details: string, ts: string) =>
      (db.prepare(`
        INSERT INTO bills (bill_number, order_id, subtotal, discount_amount, discount_type, total, paid_amount, balance, payment_status, payment_details, paid_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'paid', ?, ?, ?, ?)
      `).run(number, orderId, total, 0, 'flat', total, total, details, ts, ts, ts)).lastInsertRowid;

    // In-window cash bill (500) + refund on it (5000 cents = 50).
    const cashOrder = seedOrder('ORD-S-1', cashierId);
    const cashBillId = seedBill(cashOrder, 'BILL-S-1', 500, JSON.stringify([{ method: 'cash', amount: 500, timestamp: inWindow }]), inWindow);
    db.prepare(`
      INSERT INTO refunds (bill_id, amount_cents, method, reason, shift_id, approved_by, created_by, created_at)
      VALUES (?, ?, 'cash', 'test cash refund', NULL, ?, ?, ?)
    `).run(cashBillId, 5000, ownerId, ownerId, inWindow);

    // In-window card bill (300) — excluded from the drawer expectation.
    const cardOrder = seedOrder('ORD-S-2', cashierId);
    seedBill(cardOrder, 'BILL-S-2', 300, JSON.stringify([{ method: 'card', amount: 300, timestamp: inWindow }]), inWindow);

    // Pre-window cash bill (900) — excluded from the drawer expectation.
    const beforeOrder = seedOrder('ORD-S-3', cashierId);
    seedBill(beforeOrder, 'BILL-S-3', 900, JSON.stringify([{ method: 'cash', amount: 900, timestamp: beforeOpen }]), beforeOpen);

    // Move into a fresh clock second so the closing moment is strictly after
    // the seeded transactions.
    await sleep(1100);

    console.log('\n5. Close the first shift (owner), no variance');
    const closeRes = await request(app)
      .post(`/api/shifts/${firstShiftId}/close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ closing_cash: 1450 });
    assertEqual(closeRes.status, 200, `owner closes the shift (got ${closeRes.status}, ${JSON.stringify(closeRes.body)})`);
    const closed = closeRes.body.shift;
    assertEqual(closed.status, 'closed', 'closed shift reports status closed');
    assertEqual(closed.closed_by, ownerId, 'shift records the closing user');
    assertEqual(Number(closed.expected_cash), 1450, `expected cash = opening (1000) + cash (500) - refund (50) (got ${closed.expected_cash})`);
    assertEqual(round(Number(closed.variance)), 0, `no variance when drawer matches expectation (got ${closed.variance})`);
    assertEqual(closed.notes, 'Morning shift', 'notes are retained when not provided on close');

    const row = db.prepare(`SELECT status, closing_cash, notes FROM shifts WHERE id = ?`).get(firstShiftId) as any;
    assertEqual(row.status, 'closed', 'shift row persisted as closed');
    assertEqual(Number(row.closing_cash ?? 0), 1450, 'closing cash persisted');

    console.log('\n6. Closing an already-closed shift is an idempotent no-op');
    const reopenedById = db.prepare(`SELECT closed_at FROM shifts WHERE id = ?`).get(firstShiftId) as any;
    const closeAgain = await request(app)
      .post(`/api/shifts/${firstShiftId}/close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ closing_cash: 999 });
    assertEqual(closeAgain.status, 200, `re-close returns 200 (got ${closeAgain.status})`);
    assertEqual(closeAgain.body.shift.status, 'closed', 're-close reports closed');
    assertEqual(closeAgain.body.shift.closed_at, reopenedById.closed_at, 'closed_at is not moved by a re-close');
    const rowAfter = db.prepare(`SELECT closing_cash FROM shifts WHERE id = ?`).get(firstShiftId) as any;
    assertEqual(Number(rowAfter.closing_cash), 1450, 're-close does not overwrite the recorded closing cash');

    console.log('\n7. Missing shift + reopen + cashier cannot close');
    const missing = await request(app).post('/api/shifts/999999/close').set('Authorization', `Bearer ${ownerToken}`).send({ closing_cash: 1 });
    assertEqual(missing.status, 404, `closing a nonexistent shift returns 404 (got ${missing.status})`);

    const reopenRes = await request(app).post('/api/shifts/open').set('Authorization', `Bearer ${ownerToken}`).send({ opening_cash: 1000 });
    assertEqual(reopenRes.status, 201, `a new shift can open after the previous closed (got ${reopenRes.status})`);
    reopenedShiftId = reopenRes.body.shift.id;

    const cashierClose = await request(app)
      .post(`/api/shifts/${reopenedShiftId}/close`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ closing_cash: 1000 });
    assertEqual(cashierClose.status, 403, `cashier cannot close a shift (got ${cashierClose.status})`);

    const negClose = await request(app)
      .post(`/api/shifts/${reopenedShiftId}/close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ closing_cash: -100 });
    assertEqual(negClose.status, 400, `negative closing_cash rejected (got ${negClose.status})`);

    console.log('\n8. Second shift closes with a positive variance');
    const closeSecond = await request(app)
      .post(`/api/shifts/${reopenedShiftId}/close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ closing_cash: 1300 });
    assertEqual(closeSecond.status, 200, `second shift closes (got ${closeSecond.status})`);
    assertEqual(Number(closeSecond.body.shift.expected_cash), 1000, `second shift window holds only opening cash (got ${closeSecond.body.shift.expected_cash})`);
    assertEqual(round(Number(closeSecond.body.shift.variance)), 300, `variance is closing - expected (got ${closeSecond.body.shift.variance})`);

    const afterClose = await request(app).get('/api/shifts/current').set('Authorization', `Bearer ${cashierToken}`);
    assertEqual(afterClose.body.shift, null, 'no shift is open after all shifts closed');

  } finally {
    closeDatabase();
  }

  console.log('\n' + '='.repeat(56));
  console.log(`${passed}/${total} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});