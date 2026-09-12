/**
 * GET /api/reports/z-report — owner daily close snapshot.
 *
 * Verifies role gating, the day's rung-up sales / money-in-out attribution
 * (refunds counted against the bill's paid_at date), payment-method and
 * order breakdowns, and invalid‑date handling.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/reports-z-report.test.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-reports-z-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-reports-z';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { initDatabase, getDatabase, closeDatabase, now, localDateInTimezone } = require('../main/db');
const { getJWTSecret } = require('../main/routes/auth');
const { reportRoutes } = require('../main/routes/reports');

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

async function main() {
  console.log('GET /api/reports/z-report');
  console.log('='.repeat(50));

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
  db.prepare(`UPDATE settings SET value = 'Asia/Kolkata' WHERE key = 'timezone'`).run();

  // ── Seed staff ────────────────────────────────────────────────────────
  const ownerId = 'owner-zreport';
  db.prepare(`INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(ownerId, 'Owner', 'owner-zreport@test.local', bcrypt.hashSync('pw', 10), 'owner', now(), now());
  const cashierId = 'cashier-zreport';
  db.prepare(`INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(cashierId, 'Cashier', 'cashier-zreport@test.local', bcrypt.hashSync('pw', 10), 'cashier', now(), now());

  // ── Seed one paid takeaway order + bill + refund on that bill ─────────
  const orderId = (db.prepare(`
    INSERT INTO orders (order_number, user_id, type, status, subtotal, total, created_at, updated_at)
    VALUES (?, ?, 'takeaway', 'completed', 190, 200, ?, ?)
  `).run('ORD-Z-1', cashierId, now(), now())).lastInsertRowid;

  // Timestamps use the DB's canonical UTC space form so the report's
  // day-bound comparisons (also space form) match; ISO `T`/`Z` strings
  // lexically sort above space-form values and would drop the rows.
  const timestamp = now();
  const billId = (db.prepare(`
    INSERT INTO bills (bill_number, order_id, subtotal, discount_amount, discount_type, total, paid_amount, balance, payment_status, payment_details, paid_at, created_at, updated_at)
    VALUES (?, ?, 190, 10, 'flat', 200, 200, 0, 'paid', ?, ?, ?, ?)
  `).run('BILL-Z-1', orderId, JSON.stringify([{ method: 'cash', amount: 200, timestamp }]), timestamp, timestamp, timestamp)).lastInsertRowid;

  db.prepare(`
    INSERT INTO refunds (bill_id, amount_cents, method, reason, shift_id, approved_by, created_by, created_at)
    VALUES (?, ?, 'cash', 'test refund', NULL, ?, ?, ?)
  `).run(billId, 2000, ownerId, ownerId, timestamp);

  // ── Seed one shift covering the day's cash activity ────────────────────
  // Opening cash 0; the 200 cash bill minus the 20 cash refund means the
  // drawer expectation is 180; count exactly 180 so variance is zero.
  const shiftOpenedAt = now();
  const shiftId = (db.prepare(`
    INSERT INTO shifts (opened_at, opened_by, opening_cash, notes, status)
    VALUES (?, ?, 0, 'Morning shift', 'open')
  `).run(shiftOpenedAt, cashierId)).lastInsertRowid;
  const shiftClosedAt = now();
  db.prepare(`
    UPDATE shifts SET closed_at = ?, closed_by = ?, closing_cash = 180, status = 'closed' WHERE id = ?
  `).run(shiftClosedAt, ownerId, shiftId);

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
  app.use('/api/reports', reportRoutes);

  const ownerToken = jwt.sign({ userId: ownerId, email: 'owner-zreport@test.local', role: 'owner' }, getJWTSecret(), { expiresIn: '1h' });
  const cashierToken = jwt.sign({ userId: cashierId, email: 'cashier-zreport@test.local', role: 'cashier' }, getJWTSecret(), { expiresIn: '1h' });

  try {
    console.log('\n1. Role gating');
    {
      const forbidden = await request(app).get('/api/reports/z-report').set('Authorization', `Bearer ${cashierToken}`);
      assertEqual(forbidden.status, 403, `cashier is forbidden (got ${forbidden.status})`);
    }

    console.log('\n2. GET /api/reports/z-report (today, tenant-local Asia/Kolkata)');
    const res = await request(app).get('/api/reports/z-report').set('Authorization', `Bearer ${ownerToken}`);
    assertEqual(res.status, 200, `owner gets 200 (got ${res.status}, ${JSON.stringify(res.body)})`);
    const z = res.body.zReport;
    assertEqual(z.date, localDateInTimezone(new Date(), 'Asia/Kolkata'), 'report date resolves to the tenant-local calendar date');

    console.log('\n3. Rung-up sales (bills created today, order not cancelled)');
    assertEqual(z.sales.grossSales, 200, `gross sales is the sum of bill totals (got ${z.sales?.grossSales})`);
    assertEqual(z.sales.discounts, 10, 'discounts are read from the bill discount_amount');
    assertEqual(z.counts.bills, 1, 'one bill was rung up');

    console.log('\n4. Money in/out during the day');
    assertEqual(z.sales.grossCollected, 200, 'gross collected sums paid_amount on paid_at today');
    assertEqual(z.sales.refunded, 20, 'refund is 2000 cents converted by the currency minor-unit factor');
    assertEqual(z.sales.netCollected, 180, 'net collected = gross collected - refunded');
    assertEqual(z.counts.refunds, 1, 'one refund attributed to the bill site date');

    console.log('\n5. Payment method + order breakdowns');
    const cash = (z.paymentMethods ?? []).find((pm: any) => pm.method === 'cash');
    assert(cash && Number(cash.total) === 180, 'payment-method breakdown nets the refund against cash (200 - 20 = 180)');
    assert(z.ordersByStatus.some((s: any) => s.status === 'completed' && s.count >= 1), 'completed order appears in orders-by-status');
    assert(z.orderTypes.some((o: any) => o.type === 'takeaway' && Number(o.total) === 200), 'takeaway order type shows count and total');
    assert(Array.isArray(z.taxComponents), 'tax-components breakdown is present');

    console.log('\n6. Date scoping + validation');
    {
      const old = await request(app).get('/api/reports/z-report?date=2000-01-01').set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(old.status, 200, `past date returns 200 (got ${old.status})`);
      assertEqual(old.body.zReport.counts.orders, 0, 'no orders exist on a long-past date');

      const bad = await request(app).get('/api/reports/z-report?date=not-a-date').set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(bad.status, 400, `malformed date returns 400 (got ${bad.status})`);
    }

    console.log('\n7. Shifts folded into the Z-report');
    {
      assert(Array.isArray(z.shifts), 'zReport.shifts is an array');
      assertEqual(z.shiftTotals.count, 1, 'one shift opened during the report day');
      assertEqual(z.shiftTotals.open_count, 0, 'no open shift among the day contributions');
      assertEqual(z.shiftTotals.closed_count, 1, 'the day has one closed shift');

      const shift = z.shifts[0];
      assert(shift, 'the closed shift is present in the report');
      assertEqual(shift.status, 'closed', 'shift row reports its status');
      assertEqual(shift.opened_by, cashierId, 'shift records the opening staff id');
      assertEqual(shift.opened_by_name, 'Cashier', 'shift resolves the opening staff name');
      assertEqual(shift.closed_by, ownerId, 'shift records the closing staff id');
      assertEqual(Number(shift.opening_cash), 0, 'shift opening cash is echoed');
      assertEqual(Math.round(Number(shift.expected_cash)), 180, 'expected cash = opening + net cash collections (200 - 20)');
      assertEqual(Math.round(Number(shift.closing_cash)), 180, 'closing cash is echoed');
      assertEqual(Math.round(Number(shift.variance)), 0, 'counted cash matches the drawer expectation');

      assertEqual(Math.round(Number(z.shiftTotals.variance)), 0, 'shift totals variance aggregates');
      assertEqual(Math.round(Number(z.shiftTotals.expected_cash)), 180, 'shift totals expected cash aggregates');
    }

  } finally {
    closeDatabase();
  }

  console.log('\n' + '='.repeat(50));
  console.log(`${passed}/${total} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});