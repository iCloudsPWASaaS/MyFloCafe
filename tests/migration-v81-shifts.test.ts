/**
 * Migration v81 coverage — upgrade path for `add_shifts`.
 *
 * Shift open/close reconciliation (#279, minimal scope) adds a `shifts`
 * table with a `status IN ('open', 'closed')` CHECK constraint and
 * indexes on `opened_at`/`status`. The table is pure additive: existing
 * bills/orders are left untouched, and only one shift may be open at a
 * time is enforced by the API layer rather than by a partial index, so
 * the migration itself only needs to create the table + indexes.
 *
 * This test simulates the upgrade: apply migrations up to v80, verify no
 * `shifts` table exists, then apply v81 and assert the table works end to
 * end (insert open shift, transition to closed, CHECK rejects junk).
 *
 * Usage: node tests/run-electron-node-test.cjs tests/migration-v81-shifts.test.ts
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const activeTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-migration-v81-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => activeTestDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const { initDatabase, getDatabase, getCurrentSchemaVersion, MIGRATIONS, closeDatabase, now } = require('../main/db');

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

function runPendingMigrations() {
  const db = getDatabase();
  for (const migration of MIGRATIONS) {
    if (migration.version <= getCurrentSchemaVersion()) continue;
    db.transaction(() => {
      migration.up();
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}

function main() {
  const originalMigrations = MIGRATIONS.slice();

  // ── Upgrade path: v80 store has no shifts table ────────────────────────
  MIGRATIONS.length = 0;
  MIGRATIONS.push(...originalMigrations.filter((migration: any) => migration.version <= 80));
  initDatabase();
  const db = getDatabase();
  assert(getCurrentSchemaVersion() === 80, 'setup: store starts at schema v80');
  const hasShiftsBefore = !!db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shifts'`).get();
  assert(!hasShiftsBefore, 'setup: no shifts table at v80');

  const ownerId = 'owner-v81';
  db.prepare(`INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(ownerId, 'Owner', 'owner-v81@test.local', 'pw-placeholder', 'owner', now(), now());

  // ── Apply v81 via the normal migration chain ───────────────────────────
  MIGRATIONS.length = 0;
  MIGRATIONS.push(...originalMigrations);
  runPendingMigrations();

  assert(getCurrentSchemaVersion() === originalMigrations[originalMigrations.length - 1].version, 'upgrade reaches latest schema');
  const hasShiftsAfter = !!db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shifts'`).get();
  assert(hasShiftsAfter, 'v81 creates the shifts table');

  const openedAt = now();
  const shiftId = db.prepare(`
    INSERT INTO shifts (opened_at, opened_by, opening_cash, notes, status)
    VALUES (?, ?, 1000, 'Morning', 'open')
  `).run(openedAt, ownerId).lastInsertRowid;
  const openRow = db.prepare(`SELECT opened_at, opened_by, opening_cash, notes, status FROM shifts WHERE id = ?`).get(shiftId) as any;
  assert(openRow.status === 'open', 'open shift persists via the new table');
  assert(Number(openRow.opening_cash) === 1000, 'opening cash count persists');
  assert(openRow.opened_by === ownerId, 'opening user persists');

  db.prepare(`UPDATE shifts SET status = 'closed', closed_at = ?, closing_cash = 1450 WHERE id = ?`).run(now(), shiftId);
  const closedRow = db.prepare(`SELECT status, closing_cash FROM shifts WHERE id = ?`).get(shiftId) as any;
  assert(closedRow.status === 'closed', 'shift transitions to closed');
  assert(Number(closedRow.closing_cash) === 1450, 'closing cash count persists');

  let rejected = false;
  try {
    db.prepare(`INSERT INTO shifts (opened_at, opened_by, status) VALUES (?, ?, 'bogus')`).run(now(), ownerId);
  } catch {
    rejected = true;
  }
  assert(rejected, 'status CHECK constraint rejects unknown statuses');

  closeDatabase();
  fs.rmSync(activeTestDir, { recursive: true, force: true });
  console.log(`\n${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: any) => {
  console.error('Migration test crashed:', err);
  process.exit(1);
});