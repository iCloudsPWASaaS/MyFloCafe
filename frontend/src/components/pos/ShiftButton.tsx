'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useShiftStore } from '@/store/shifts';
import { useTranslations } from 'use-intl';
import toast from 'react-hot-toast';
import { CalendarClock, LogIn, LogOut } from 'lucide-react';
import { hasRole, ROLE_ACCESS } from '@shared/role-permissions';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useCurrencyUnitAdapter } from '@/hooks/useCurrencyUnitAdapter';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export default function ShiftButton() {
  const { currentTenant } = useAuthStore();
  const t = useTranslations('pos');
  const tCommon = useTranslations('common');
  const fmt = useFormatCurrency();
  const unitAdapter = useCurrencyUnitAdapter();
  const { toStored: toStoredUnit, step: inputCurrencyStep, label: inputCurrencyLabel } = unitAdapter;

  const role = currentTenant?.role;
  const canView = hasRole(role, ROLE_ACCESS.ownerManagerCashier);
  const canManage = hasRole(role, ROLE_ACCESS.ownerManager);

  const shift = useShiftStore((s) => s.shift);
  const loaded = useShiftStore((s) => s.loaded);
  const refresh = useShiftStore((s) => s.refresh);
  const setShift = useShiftStore((s) => s.setShift);

  const [dialog, setDialog] = useState<'open' | 'close' | null>(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (canView && !loaded) refresh();
  }, [canView, loaded, refresh]);

  const loading = canView && !loaded;

  const openDialog = (mode: 'open' | 'close') => {
    setAmount('');
    setNotes('');
    setDialog(mode);
  };

  const submit = async () => {
    const raw = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(raw) || raw < 0) {
      toast.error(t('discountInvalid'));
      return;
    }
    setSubmitting(true);
    try {
      if (dialog === 'open') {
        const { data } = await api.post('/shifts/open', { opening_cash: toStoredUnit(raw), notes: notes.trim() || undefined });
        setShift(data.shift);
        toast.success(t('shiftOpened'));
      } else if (shift) {
        const { data } = await api.post(`/shifts/${shift.id}/close`, { closing_cash: toStoredUnit(raw), notes: notes.trim() || undefined });
        const closed = data.shift;
        toast.success(
          t('shiftClosedWithVariance', {
            expected: fmt(Number(closed.expected_cash) || 0),
            counted: fmt(Number(closed.closing_cash) || 0),
            variance: fmt(Number(closed.variance) || 0),
          }),
        );
        setShift(null);
      }
      setDialog(null);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const message = (err as { message?: string })?.message || '';
      if (dialog === 'open' && status === 409) {
        toast.error(t('shiftAlreadyOpen'));
      } else if (status === 400 && /already closed/i.test(message)) {
        toast.error(t('shiftAlreadyClosed'));
      } else if (dialog === 'open') {
        toast.error(t('openShiftFailed'));
      } else {
        toast.error(t('closeShiftFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!canView || loading) {
    // Keep layout stable while the current-shift state is loading.
    return canView ? (
      <div className="shrink-0 h-9 w-32 rounded-lg border border-border bg-card" aria-hidden="true" />
    ) : null;
  }

  // Cashiers and servers see a read-only indicator when a shift is open.
  if (!canManage) {
    if (!shift) return null;
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-medium text-emerald-700">
        <CalendarClock size={14} />
        {t('shiftOpen')}
      </span>
    );
  }

  return (
    <>
      {shift ? (
        <button
          type="button"
          onClick={() => openDialog('close')}
          className="touch-target shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-50 px-3 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100"
          aria-label={t('closeShift')}
        >
          <LogOut size={14} />
          {t('closeShift')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => openDialog('open')}
          className="touch-target shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-400 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
          aria-label={t('openShift')}
        >
          <LogIn size={14} />
          {t('openShift')}
        </button>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog === 'open' ? t('shiftOpenTitle') : t('shiftCloseTitle')}</DialogTitle>
            <DialogDescription>
              {dialog === 'open' ? t('shiftOpenHint') : t('shiftCloseHint')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {dialog === 'close' && shift && (
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t('shiftOpeningCashLabel')}</span>
                <span className="font-semibold">{fmt(Number(shift.opening_cash) || 0)}</span>
              </div>
            )}
            <div>
              <label htmlFor="shift-amount" className="mb-1.5 block text-sm font-medium">
                {dialog === 'open' ? t('openingCash') : t('closingCash')}
              </label>
              <input
                id="shift-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step={inputCurrencyStep}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand/30"
                placeholder={inputCurrencyLabel}
              />
            </div>
            <div>
              <label htmlFor="shift-notes" className="mb-1.5 block text-sm font-medium">
                {t('notes')}
              </label>
              <textarea
                id="shift-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('shiftNotesPlaceholder')}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={submitting}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {dialog === 'open' ? t('openShift') : t('closeShift')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}