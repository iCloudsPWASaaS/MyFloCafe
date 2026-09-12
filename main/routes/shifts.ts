import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { getTenantCurrency } from '../services/refund';
import { requireRole } from '../middleware/security';
import { ROLE_ACCESS } from '../../shared/role-permissions';
import { getCurrencyFractionDigits } from '../countries';

const router = Router();

const MAX_SHIFT_NOTES = 500;

function parseAmountMinorUnits(value: unknown, currency: string, field: string, allowZero: boolean): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw Object.assign(new Error(`${field} must be an amount`), { statusCode: 400 });
  }
  const decimals = getCurrencyFractionDigits(currency);
  const factor = 10 ** decimals;
  const text = String(value).trim();
  const pattern = decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(text)) {
    const decDesc = decimals === 0 ? 'without decimals' : `with at most ${decimals} decimal places`;
    throw Object.assign(new Error(`${field} must be a finite number ${allowZero === false ? 'greater than zero ' : ''}${decDesc}`), { statusCode: 400 });
  }
  const parsed = Number(text);
  const minorUnits = Math.round(parsed * factor);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed <= 0) || !Number.isSafeInteger(minorUnits)) {
    throw Object.assign(new Error(`${field} must be a finite ${allowZero === false ? 'positive ' : 'non-negative '}number`), { statusCode: 400 });
  }
  return minorUnits;
}

function getOpenShift(db: ReturnType<typeof getDatabase>): any | undefined {
  return db.prepare(`SELECT * FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1`).get() as any | undefined;
}

/**
 * Cash expected in the register for a shift's window: opening cash plus the
 * net cash collections (cash paid minus cash refunds) recorded while the
 * shift was open. Non-cash methods are excluded from the drawer expectation.
 */
export function computeShiftNetCollections(db: ReturnType<typeof getDatabase>, shift: any): number {
  const start = shift.opened_at;
  const end = shift.closed_at || now();
  const minorFactor = 10 ** getCurrencyFractionDigits(getTenantCurrency(db));
  const row = db.prepare(`
    WITH payment_lines AS (
      SELECT je.value AS line
      FROM bills b
      JOIN json_each(CASE
        WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array'
          THEN b.payment_details
        WHEN json_valid(b.payment_details)
          THEN json_array(b.payment_details)
        ELSE '[]'
      END) je
      WHERE b.payment_details IS NOT NULL
        AND COALESCE(
          datetime(NULLIF(json_extract(je.value, '$.timestamp'), '')),
          datetime(NULLIF(b.paid_at, '')),
          datetime(NULLIF(b.created_at, ''))
        ) >= datetime(?)
        AND COALESCE(
          datetime(NULLIF(json_extract(je.value, '$.timestamp'), '')),
          datetime(NULLIF(b.paid_at, '')),
          datetime(NULLIF(b.created_at, ''))
        ) < datetime(?, '+1 second')
    ),
    normalized AS (
      SELECT
        COALESCE(NULLIF(json_extract(line, '$.method'), ''), 'unknown') AS method,
        CAST(json_extract(line, '$.amount') AS REAL) AS amount
      FROM payment_lines
      UNION ALL
      SELECT r.method, -(CAST(r.amount_cents AS REAL) / ?)
      FROM refunds r
      JOIN bills b ON b.id = r.bill_id
      WHERE datetime(COALESCE(NULLIF(b.paid_at, ''), NULLIF(b.created_at, ''))) >= datetime(?)
        AND datetime(COALESCE(NULLIF(b.paid_at, ''), NULLIF(b.created_at, ''))) < datetime(?, '+1 second')
    )
    SELECT COALESCE(SUM(CASE WHEN method = 'cash' AND typeof(amount) IN ('integer', 'real') THEN amount ELSE 0 END), 0) AS cash_collected
    FROM normalized
  `).get(start, end, minorFactor, start, end) as { cash_collected: number };
  return Number(row.cash_collected || 0);
}

router.get('/current', requireRole(...ROLE_ACCESS.ownerManagerCashier), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const openShift = getOpenShift(db);
    res.json({
      shift: openShift ? {
        id: openShift.id,
        opened_at: openShift.opened_at,
        opened_by: openShift.opened_by,
        opening_cash: Number(openShift.opening_cash || 0),
        status: openShift.status,
      } : null,
    });
  } catch (error: any) {
    console.error('[API] Get current shift error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/open', requireRole(...ROLE_ACCESS.ownerManagerCashier), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const currency = getTenantCurrency(db);
    const userId = String((req as any).user?.userId || '');

    const openingCashMinor = parseAmountMinorUnits(req.body.opening_cash, currency, 'opening_cash', true);
    const openingCash = openingCashMinor / (10 ** getCurrencyFractionDigits(currency));
    const notes = typeof req.body.notes === 'string' && req.body.notes.trim() ? req.body.notes.trim().slice(0, MAX_SHIFT_NOTES) : null;

    if (getOpenShift(db)) {
      return res.status(409).json({ error: 'A shift is already open' });
    }

    const openedAt = now();
    const result = db.prepare(`
      INSERT INTO shifts (opened_at, opened_by, opening_cash, notes, status)
      VALUES (?, ?, ?, ?, 'open')
    `).run(openedAt, userId, openingCash, notes);

    res.status(201).json({
      shift: {
        id: result.lastInsertRowid,
        status: 'open',
        opened_at: openedAt,
        opened_by: userId,
        opening_cash: openingCash,
        notes,
      },
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Unable to open shift' });
  }
});

router.post('/:id/close', requireRole(...ROLE_ACCESS.ownerManager), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const currency = getTenantCurrency(db);
    const userId = String((req as any).user?.userId || '');
    const id = String(req.params.id);

    const shift = db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(id) as any | undefined;
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (shift.status === 'closed') {
      // Closing an already-closed shift is a safe idempotent no-op.
      return res.json({ shift: { id: shift.id, status: 'closed', closed_at: shift.closed_at } });
    }

    const closingCashMinor = parseAmountMinorUnits(req.body.closing_cash, currency, 'closing_cash', true);
    const closingCash = closingCashMinor / (10 ** getCurrencyFractionDigits(currency));
    const notes = typeof req.body.notes === 'string' && req.body.notes.trim() ? req.body.notes.trim().slice(0, MAX_SHIFT_NOTES) : shift.notes || null;

    const expectedCash = (Number(shift.opening_cash) || 0) + computeShiftNetCollections(db, shift);
    const variance = closingCash - expectedCash;
    const closedAt = now();

    db.prepare(`
      UPDATE shifts SET closed_at = ?, closed_by = ?, closing_cash = ?, notes = ?, status = 'closed' WHERE id = ?
    `).run(closedAt, userId, closingCash, notes, id);

    res.json({
      shift: {
        id: shift.id,
        status: 'closed',
        opened_at: shift.opened_at,
        closed_at: closedAt,
        opened_by: shift.opened_by,
        closed_by: userId,
        opening_cash: Number(shift.opening_cash || 0),
        closing_cash: closingCash,
        expected_cash: expectedCash,
        variance,
        notes,
      },
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Unable to close shift' });
  }
});

export { router as shiftRoutes };