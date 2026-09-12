'use client';

import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useShiftStore } from '@/store/shifts';
import { hasRole, ROLE_ACCESS } from '@shared/role-permissions';
import { useTranslations } from 'use-intl';
import toast from 'react-hot-toast';
import { LogIn } from 'lucide-react';
import { useCurrencyUnitAdapter } from '@/hooks/useCurrencyUnitAdapter';
import TouchNumberPad from '@/components/pos/TouchNumberPad';
import { allowCurrencyDecimalKey } from '@/lib/currency-input';
import { Button } from '@/components/ui/button';

/**
 * Blocks the POS until a shift is open. Cashiers, managers, and owners all
 * become able to open a shift here (the backend permits owner/manager/cashier
 * for POST /shifts/open); closing stays owner/manager-only in the topbar.
 */
export default function ShiftGate({ children }: { children: ReactNode }) {
  const { currentTenant } = useAuthStore();
  const shift = useShiftStore((s) => s.shift);
  const loaded = useShiftStore((s) => s.loaded);
  const refresh = useShiftStore((s) => s.refresh);
  const setShift = useShiftStore((s) => s.setShift);
  const t = useTranslations('pos');
  const unitAdapter = useCurrencyUnitAdapter();
  const { toStored } = unitAdapter;
  // Opening cash is a plain money amount: the decimal key is enabled whenever
  // this currency has decimal places (mirrors the payment-modal numpad).
  const allowDecimal = allowCurrencyDecimalKey(unitAdapter.maxDecimals, 'payment', 'amount');

  const role = currentTenant?.role;
  const canView = hasRole(role, ROLE_ACCESS.ownerManagerCashier);

  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (canView && !loaded) refresh();
  }, [canView, loaded, refresh]);

  if (!canView) return <>{children}</>;

  if (!loaded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-card">
        <div className="h-8 w-8 border-3 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (shift) return <>{children}</>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const raw = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(raw) || raw < 0) {
      toast.error(t('discountInvalid'));
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/shifts/open', { opening_cash: toStored(raw), notes: notes.trim() || undefined });
      setShift(data.shift);
      toast.success(t('shiftOpened'));
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error(status === 409 ? t('shiftAlreadyOpen') : t('openShiftFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col items-center justify-center bg-card px-4 py-8">
      <form onSubmit={submit} className="flex w-full max-w-md flex-col items-center gap-5">
        <div className="w-full bg-background rounded-2xl border border-border p-6 text-center shadow-sm">
          <div className="mb-1 flex items-center justify-center gap-2 text-brand">
            <LogIn size={20} />
            <h1 className="text-lg font-bold text-foreground">{t('shiftRequiredToUsePos')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('shiftOpenHint')}</p>
        </div>

        <div className="w-full bg-background rounded-2xl border border-border p-5 shadow-sm">
          <div className="mb-4 text-center">
            <span className="mb-1.5 block text-sm font-medium text-muted-foreground">{t('openingCash')}</span>
            <span className="block text-3xl font-bold tabular-nums text-foreground">{amount || '0.00'}</span>
          </div>
          <TouchNumberPad
            value={amount}
            onChange={setAmount}
            ariaLabel={t('numericKeypad')}
            clearLabel={t('clearAmount')}
            backspaceLabel={t('backspaceAmount')}
            allowDecimal={allowDecimal}
          />
        </div>

        <div className="w-full bg-background rounded-2xl border border-border p-5 shadow-sm">
          <div>
            <label htmlFor="shift-gate-notes" className="mb-1.5 block text-sm font-medium">
              {t('notes')}
            </label>
            <textarea
              id="shift-gate-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('shiftNotesPlaceholder')}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <Button type="submit" className="mt-4 w-full" disabled={submitting}>
            {t('openShift')}
          </Button>
        </div>
      </form>
    </div>
  );
}