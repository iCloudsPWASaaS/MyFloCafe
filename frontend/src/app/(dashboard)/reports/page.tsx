'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import { Banknote, CalendarDays, Printer, ReceiptText, RotateCcw, ShoppingBag, Wallet, ClipboardList, ArrowRightLeft, Package, List } from 'lucide-react';
import { useTranslations, useLocale, type AppConfig } from 'use-intl';
import toast from 'react-hot-toast';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useFormatDate } from '@/hooks/useFormatDate';
import { PAYMENT_METHODS } from '@/lib/payment-methods';
import { ORDER_STATUS_LABEL_KEYS } from '@/lib/i18n-enums';
import { ORDER_TYPE_LABEL_KEYS } from '@/lib/order-types';
import { ROLE_ACCESS, hasRole } from '@shared/role-permissions';

interface PaymentMethodBreakdown {
  method: string | null;
  count: number;
  total: number;
}

interface TaxComponent {
  title: string;
  rate: number;
  amount: number;
}

interface ShiftReport {
  id: number;
  opened_at: string;
  opened_by: string;
  opened_by_name: string | null;
  closed_at: string | null;
  closed_by: string | null;
  closed_by_name: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number;
  variance: number | null;
  notes: string | null;
  status: 'open' | 'closed';
}

interface ZReport {
  date: string;
  generatedAt: string;
  counts: {
    orders: number;
    bills: number;
    paidBills: number;
    refunds: number;
    newCustomers: number;
  };
  sales: {
    grossSales: number;
    discounts: number;
    taxAmount: number;
    grossCollected: number;
    refunded: number;
    netCollected: number;
    averageOrderValue: number;
  };
  paymentMethods: PaymentMethodBreakdown[];
  ordersByStatus: { status: string; count: number }[];
  orderTypes: { type: string; count: number; total: number }[];
  taxComponents: TaxComponent[];
  shifts: ShiftReport[];
  shiftTotals: {
    count: number;
    open_count: number;
    closed_count: number;
    opening_cash: number;
    closing_cash: number;
    expected_cash: number;
    variance: number;
  };
}

interface XReport {
  sales: number;
  runningOrders: number;
  pendingOrders: number;
  tablesOccupied: number;
  avgTableTurnMinutes: number | null;
  avgCurrentOccupancyMinutes: number | null;
  paymentMethods: PaymentMethodBreakdown[];
}

/** Today's date as YYYY-MM-DD in a given IANA timezone (not UTC — avoids an
 *  off-by-one-day default near midnight relative to the tenant's locale). */
function getLocalDateString(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD by convention — a convenient built-in shortcut.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

type OrdersKey = keyof AppConfig['Messages']['orders'];
type PosKey = keyof AppConfig['Messages']['pos'];

// Built-in payment method label keys mapped to typed `pos` leaf keys.
const BUILT_IN_PAYMENT_KEYS = {
  cash: 'methodCash',
  card: 'methodCard',
} as const satisfies Record<'cash' | 'card', PosKey>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default function ReportsPage() {
  const { currentTenant } = useAuthStore();
  const t = useTranslations('reports');
  const tCommon = useTranslations('common');
  const tDashboard = useTranslations('dashboard');
  const tPos = useTranslations('pos');
  const tOrders = useTranslations('orders');
  const router = useRouter();
  const [zData, setZData] = useState<ZReport | null>(null);
  const [xData, setXData] = useState<XReport | null>(null);
  const [loading, setLoading] = useState(true);
  const dayInputRef = useRef<HTMLInputElement>(null);
  const [itemsData, setItemsData] = useState<{ product_id: number; product_name: string; total_quantity: number; total_revenue: number; order_count: number }[] | null>(null);

  const isOwner = hasRole(currentTenant?.role, ROLE_ACCESS.owner);
  const fmt = useFormatCurrency();
  const { formatDateTime } = useFormatDate();
  const locale = useLocale();
  const timeZone = currentTenant?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayLocal = getLocalDateString(new Date(), timeZone);

  const [activeTab, setActiveTab] = useState<'z' | 'x' | 'shifts' | 'items'>('z');
  const [itemsStartDate, setItemsStartDate] = useState(todayLocal);
  const [itemsEndDate, setItemsEndDate] = useState(todayLocal);
  const [selectedDate, setSelectedDate] = useState(todayLocal);

  // Noon in machine-local time maps to the tenant-local midday for every
  // real-world timezone offset (±12h), so the tenant-local calendar date
  // column renders without drifting a day at DST/timezone boundaries.
  const dateDisplay = (dateString: string) =>
    formatDateTime(new Date(`${dateString}T12:00:00`), { year: 'numeric', month: 'short', day: 'numeric' });

  const openPicker = (input: HTMLInputElement | null) => {
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };

  useEffect(() => {
    if (currentTenant && !isOwner) {
      router.replace('/pos');
    }
  }, [currentTenant, isOwner, router]);

  useEffect(() => {
    if (!isOwner) return;
    const controller = new AbortController();
    const fetchData = async () => {
      try {
        if (activeTab === 'z' || activeTab === 'shifts') {
          const res = await api.get('/reports/z-report', { params: { date: selectedDate }, signal: controller.signal });
          setZData(res.data.zReport);
        } else if (activeTab === 'x') {
          const res = await api.get('/reports/daily-stats', { params: { date: selectedDate }, signal: controller.signal });
          setXData(res.data);
        } else if (activeTab === 'items') {
          const res = await api.get('/reports/topProducts', { params: { start_date: itemsStartDate, end_date: itemsEndDate, limit: 100 }, signal: controller.signal });
          setItemsData(res.data.topProducts);
        }
      } catch (err: unknown) {
        if (err instanceof Error && (err.name === 'CanceledError' || err.name === 'AbortError')) return;
        toast.error(tCommon('somethingWrong'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    fetchData();
    return () => controller.abort();
  }, [isOwner, selectedDate, activeTab, itemsStartDate, itemsEndDate]);

  if (!isOwner) return null;

  const z = activeTab === 'z' || activeTab === 'shifts' ? zData : null;
  const x = activeTab === 'x' ? xData : null;
  const items = activeTab === 'items' ? itemsData : null;
  const data = activeTab === 'z' ? zData : activeTab === 'x' ? xData : activeTab === 'items' ? itemsData : zData;
  if (!data && activeTab !== 'shifts') return null;

  const isZ = activeTab === 'z';
  const isX = activeTab === 'x';
  const isShifts = activeTab === 'shifts';
  const isItems = activeTab === 'items';

  const paymentMethodsTotal = (z?.paymentMethods ?? x?.paymentMethods ?? []).reduce((sum, pm) => sum + Number(pm.total), 0);
  const orderTypeLabel = (type: string): string => {
    const k = (ORDER_TYPE_LABEL_KEYS as Record<string, OrdersKey | undefined>)[type];
    return k ? tOrders(k) : type;
  };
  const paymentMethodLabel = (method: string | null): string => {
    const meta = PAYMENT_METHODS.find((m) => m.key === method);
    if (meta) return tPos(BUILT_IN_PAYMENT_KEYS[meta.key as keyof typeof BUILT_IN_PAYMENT_KEYS] ?? 'methodCard');
    return method === 'wallet' ? tPos('methodWallet') : String(method || tCommon('unknown'));
  };

  // Z Report tiles (collections-focused)
  const zTiles = z ? [
    { label: tDashboard('netCollections'), value: fmt(z.sales.netCollected), icon: Banknote, color: 'bg-green-50 border-green-200', iconColor: 'text-green-600' },
    { label: tDashboard('grossCollections'), value: fmt(z.sales.grossCollected), icon: Banknote, color: 'bg-emerald-50 border-emerald-200', iconColor: 'text-emerald-700' },
    { label: tDashboard('refunds'), value: fmt(-z.sales.refunded), icon: RotateCcw, color: 'bg-red-50 border-red-200', iconColor: 'text-red-600' },
    { label: tDashboard('billsCollected'), value: z.counts.paidBills, icon: ReceiptText, color: 'bg-blue-50 border-blue-200', iconColor: 'text-blue-600' },
  ] : [];

  // X Report tiles (live snapshot)
  const xTiles = x ? [
    { label: tDashboard('runningOrders'), value: x.runningOrders, icon: ClipboardList, color: 'bg-amber-50 border-amber-200', iconColor: 'text-amber-600' },
    { label: tDashboard('pendingOrders'), value: x.pendingOrders, icon: ClipboardList, color: 'bg-orange-50 border-orange-200', iconColor: 'text-orange-600' },
    { label: tDashboard('tablesOccupied'), value: x.tablesOccupied, icon: ShoppingBag, color: 'bg-purple-50 border-purple-200', iconColor: 'text-purple-600' },
    { label: tDashboard('avgTableTurn'), value: x.avgTableTurnMinutes ? `${x.avgTableTurnMinutes} min` : '—', icon: ArrowRightLeft, color: 'bg-cyan-50 border-cyan-200', iconColor: 'text-cyan-600' },
  ] : [];

  // Shifts tiles
  const shiftsTiles = z ? [
    { label: tDashboard('shiftsSection'), value: z.shiftTotals.count, icon: CalendarDays, color: 'bg-indigo-50 border-indigo-200', iconColor: 'text-indigo-600' },
    { label: tDashboard('shiftOpenStatus'), value: z.shiftTotals.open_count, icon: Package, color: 'bg-emerald-50 border-emerald-200', iconColor: 'text-emerald-600' },
    { label: tDashboard('shiftClosedStatus'), value: z.shiftTotals.closed_count, icon: Package, color: 'bg-amber-50 border-amber-200', iconColor: 'text-amber-600' },
    { label: tDashboard('shiftVariance'), value: fmt(z.shiftTotals.variance), icon: RotateCcw, color: 'bg-red-50 border-red-200', iconColor: 'text-red-600' },
  ] : [];

  // Items tiles
  const itemsTiles = items ? [
    { label: t('itemsSold'), value: items.reduce((sum, i) => sum + i.total_quantity, 0), icon: Package, color: 'bg-teal-50 border-teal-200', iconColor: 'text-teal-600' },
    { label: t('itemsRevenue'), value: fmt(items.reduce((sum, i) => sum + i.total_revenue, 0)), icon: Banknote, color: 'bg-green-50 border-green-200', iconColor: 'text-green-600' },
    { label: t('uniqueItems'), value: items.length, icon: List, color: 'bg-blue-50 border-blue-200', iconColor: 'text-blue-600' },
    { label: t('itemsOrders'), value: items.reduce((sum, i) => sum + i.order_count, 0), icon: ReceiptText, color: 'bg-purple-50 border-purple-200', iconColor: 'text-purple-600' },
  ] : [];

  const tiles = isZ ? zTiles : isX ? xTiles : isShifts ? shiftsTiles : itemsTiles;

  const zSalesRows = z ? [
    { label: t('grossSales'), value: fmt(z.sales.grossSales) },
    { label: t('discounts'), value: `-${fmt(z.sales.discounts)}` },
    { label: tCommon('tax'), value: fmt(z.sales.taxAmount) },
    { label: tDashboard('netCollections'), value: fmt(z.sales.netCollected) },
    { label: tDashboard('aov'), value: fmt(z.sales.averageOrderValue) },
    { label: tDashboard('orders'), value: String(z.counts.orders) },
    { label: t('bills'), value: String(z.counts.bills) },
    { label: tDashboard('newCustomers'), value: String(z.counts.newCustomers) },
  ] : [];

  const zCollectionRows = z ? [
    { label: tDashboard('grossCollections'), value: fmt(z.sales.grossCollected) },
    { label: tDashboard('refunds'), value: `-${fmt(z.sales.refunded)}` },
    { label: tDashboard('netCollections'), value: fmt(z.sales.netCollected) },
    { label: tDashboard('billsCollected'), value: String(z.counts.paidBills) },
  ] : [];

  const xRows = x ? [
    { label: t('liveSnapshot'), value: fmt(x.sales) },
    { label: tDashboard('runningOrders'), value: String(x.runningOrders) },
    { label: tDashboard('pendingOrders'), value: String(x.pendingOrders) },
    { label: tDashboard('tablesOccupied'), value: String(x.tablesOccupied) },
    { label: tDashboard('avgTableTurn'), value: x.avgTableTurnMinutes ? `${x.avgTableTurnMinutes} min` : '—' },
    { label: tDashboard('avgCurrentOccupancy'), value: x.avgCurrentOccupancyMinutes ? `${x.avgCurrentOccupancyMinutes} min` : '—' },
  ] : [];

  // Shifts rows for detailed view
  const shiftsRows = z ? [
    { label: tDashboard('shiftsSection'), value: String(z.shiftTotals.count) },
    { label: tDashboard('shiftOpenStatus'), value: String(z.shiftTotals.open_count) },
    { label: tDashboard('shiftClosedStatus'), value: String(z.shiftTotals.closed_count) },
    { label: tDashboard('shiftExpected'), value: fmt(z.shiftTotals.expected_cash) },
    { label: tDashboard('shiftVariance'), value: fmt(z.shiftTotals.variance) },
  ] : [];

  // Items rows for detailed view
  const itemsRows = items ? [
    { label: t('itemsSold'), value: String(items.reduce((sum, i) => sum + i.total_quantity, 0)) },
    { label: t('itemsRevenue'), value: fmt(items.reduce((sum, i) => sum + i.total_revenue, 0)) },
    { label: t('uniqueItems'), value: String(items.length) },
    { label: t('itemsOrders'), value: String(items.reduce((sum, i) => sum + i.order_count, 0)) },
  ] : [];

  const printZReport = () => {
    const printWindow = window.open('', '_blank', 'width=560,height=760');
    if (!printWindow) {
      toast.error(tCommon('somethingWrong'));
      return;
    }
    const section = (title: string, bodyRows: Array<[string, string] | { label: string; value: string }>) => `
      <h2>${escapeHtml(title)}</h2>
      ${bodyRows.map((row) => {
        const [label, value] = Array.isArray(row) ? row : [row.label, row.value];
        return `
        <div class="row">
          <span class="label">${escapeHtml(label)}</span>
          <span class="dots"></span>
          <span class="value">${escapeHtml(value)}</span>
        </div>`;
      }).join('')}`;
    const reportTitle = isZ ? t('zReportTitle') : isX ? t('xReportTitle') : isShifts ? t('shiftsReportTitle') : t('itemsReportTitle');
    const dateLabel = isItems
      ? `${dateDisplay(itemsStartDate)} — ${dateDisplay(itemsEndDate)}`
      : dateDisplay((isZ ? z?.date : isShifts ? z?.date : selectedDate) ?? selectedDate);
    printWindow.document.write(`<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(reportTitle)}</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 11px; margin-bottom: 18px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin: 18px 0 6px; border-top: 1px solid #ddd; padding-top: 8px; }
  .row { display: flex; align-items: baseline; margin: 3px 0; }
  .label { white-space: nowrap; }
  .dots { flex: 1; border-bottom: 1px dotted #bbb; margin: 0 6px; }
  .value { white-space: nowrap; font-weight: 600; }
</style>
</head>
<body>
  <h1>${escapeHtml(reportTitle)}</h1>
  <div class="sub">${escapeHtml(t('generatedOn', { date: dateLabel }))}</div>
  ${isZ ? `
    ${section(t('salesOverview'), zSalesRows)}
    ${section(t('collections'), zCollectionRows)}
    ${section(tDashboard('paymentMethods'), z?.paymentMethods.map((pm) => [paymentMethodLabel(pm.method), fmt(Number(pm.total))] as [string, string]) ?? [])}
    ${section(t('ordersByStatus'), z?.ordersByStatus.map((s) => {
      const k = (ORDER_STATUS_LABEL_KEYS as Record<string, OrdersKey | undefined>)[s.status];
      return [k ? tOrders(k) : s.status, String(s.count)] as [string, string];
    }) ?? [])}
    ${section(t('orderTypes'), z?.orderTypes.map((o) => [orderTypeLabel(o.type), fmt(Number(o.total))] as [string, string]) ?? [])}
    ${section(t('taxBreakdown'), [
      ...z?.taxComponents.map((tc) => [tc.title, fmt(Number(tc.amount))] as [string, string]) ?? [],
      [t('total'), fmt(z?.taxComponents.reduce((sum, tc) => sum + Number(tc.amount || 0), 0) ?? 0)] as [string, string],
    ])}
  ` : isX ? `
    ${section(t('liveSnapshot'), xRows)}
    ${section(tDashboard('paymentMethods'), x?.paymentMethods.map((pm) => [paymentMethodLabel(pm.method), fmt(Number(pm.total))] as [string, string]) ?? [])}
  ` : isShifts ? `
    ${section(tDashboard('shiftsSection'), shiftsRows)}
    ${section(tDashboard('shiftsSection'), [
      ...z?.shifts.map((s) => [
        `${formatDateTime(s.opened_at)} — ${s.closed_by_name ? tDashboard('shiftClosedBy') + ': ' + s.closed_by_name : tDashboard('shiftOpenStatus')}`,
        fmt(Number(s.closing_cash ?? s.opening_cash) || 0),
      ] as [string, string]) ?? [],
      [tDashboard('shiftVariance'), fmt(Number(z?.shiftTotals.variance) || 0)] as [string, string],
    ])}
  ` : `
    ${section(t('itemsReport'), itemsRows)}
    ${section(t('itemsList'), items?.map((i) => [`${i.product_name} (x${i.total_quantity})`, fmt(i.total_revenue)] as [string, string]) ?? [])}
  `}
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  const renderGridCard = (title: string, icon: React.ReactNode, children: React.ReactNode) => (
    <div className="bg-card rounded-xl border border-border dark:border-border p-4">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );

  const renderRows = (rows: { label: string; value: string }[]) => (
    <div className="divide-y divide-gray-50">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between py-2.5">
          <span className="text-sm text-muted-foreground">{row.label}</span>
          <span className="text-sm font-semibold text-foreground">{row.value}</span>
        </div>
      ))}
    </div>
  );

  const zHasData = z && (z.counts.orders > 0 || z.counts.paidBills > 0 || z.counts.bills > 0);
  const xHasData = x && (x.sales > 0 || x.runningOrders > 0 || x.pendingOrders > 0 || x.tablesOccupied > 0);
  const shiftsHasData = z && (z.shiftTotals.count > 0);
  const itemsHasData = items && items.length > 0;
  const hasData = isZ ? zHasData : isX ? xHasData : isShifts ? shiftsHasData : itemsHasData;
  const reportDate = isItems ? undefined : isZ ? z?.date : isShifts ? z?.date : selectedDate;

  // Z Report branch (full details)
  const zBranch = z ? (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderGridCard(t('salesOverview'), <ShoppingBag size={16} className="text-gray-400" />, renderRows(zSalesRows))}

        <div className="bg-card rounded-xl border border-border dark:border-border p-4">
          <div className="flex items-center gap-2 mb-4">
            <Wallet size={16} className="text-gray-400" />
            <h2 className="font-semibold text-foreground">{t('collections')}</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {zCollectionRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between py-2.5">
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className="text-sm font-semibold text-foreground">{row.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <Wallet size={16} className="text-gray-400" />
              <h3 className="font-semibold text-foreground text-sm">{tDashboard('paymentMethods')}</h3>
            </div>
            {z.paymentMethods.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">{t('noData')}</p>
            ) : (
              <div className="space-y-3">
                {z.paymentMethods.map((pm) => {
                  const percent = paymentMethodsTotal > 0
                    ? Math.max(0, Math.min(100, Math.round((Number(pm.total) / paymentMethodsTotal) * 100)))
                    : 0;
                  return (
                    <div key={pm.method ?? 'unknown'}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground">{paymentMethodLabel(pm.method)}</span>
                        <span className="text-sm font-semibold text-foreground">{fmt(Number(pm.total))}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-brand rounded-full" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">
                          {tDashboard('paymentMethodCount', { count: pm.count, percent })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {renderGridCard(t('ordersByStatus'), <ReceiptText size={16} className="text-gray-400" />, (
          z.ordersByStatus.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">{t('noData')}</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {z.ordersByStatus.map((s) => {
                const k = (ORDER_STATUS_LABEL_KEYS as Record<string, OrdersKey | undefined>)[s.status];
                return (
                  <div key={s.status} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-muted-foreground">{k ? tOrders(k) : s.status}</span>
                    <span className="text-sm font-semibold text-foreground">{s.count}</span>
                  </div>
                );
              })}
            </div>
          )
        ))}

        {renderGridCard(t('orderTypes'), <ShoppingBag size={16} className="text-gray-400" />, (
          z.orderTypes.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">{t('noData')}</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {z.orderTypes.map((o) => (
                <div key={o.type} className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-muted-foreground">{orderTypeLabel(o.type)}</span>
                  <span className="text-sm font-semibold text-foreground">
                    {o.count} · {fmt(Number(o.total))}
                  </span>
                </div>
              ))}
            </div>
          )
        ))}

        {renderGridCard(t('taxBreakdown'), <ReceiptText size={16} className="text-gray-400" />, (
          z.taxComponents.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">{t('noData')}</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {z.taxComponents.map((tc) => (
                <div key={tc.title} className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-muted-foreground">
                    {tc.title}
                    {tc.rate ? ` (${tc.rate}%)` : ''}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{fmt(Number(tc.amount))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm font-semibold text-foreground">{t('total')}</span>
                <span className="text-sm font-bold text-foreground">
                  {fmt(z.taxComponents.reduce((sum, tc) => sum + Number(tc.amount || 0), 0) ?? 0)}
                </span>
              </div>
            </div>
          )
        ))}

      </div>
    </div>
  ) : null;

  // X Report branch (live snapshot)
  const xBranch = x ? (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderGridCard(t('liveSnapshot'), <ShoppingBag size={16} className="text-gray-400" />, renderRows(xRows))}

        <div className="bg-card rounded-xl border border-border dark:border-border p-4">
          <div className="flex items-center gap-2 mb-4">
            <Wallet size={16} className="text-gray-400" />
            <h2 className="font-semibold text-foreground">{tDashboard('paymentMethods')}</h2>
          </div>
          {x.paymentMethods.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">{t('noData')}</p>
          ) : (
            <div className="space-y-3">
              {x.paymentMethods.map((pm) => {
                const percent = paymentMethodsTotal > 0
                  ? Math.max(0, Math.min(100, Math.round((Number(pm.total) / paymentMethodsTotal) * 100)))
                  : 0;
                return (
                  <div key={pm.method ?? 'unknown'}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-foreground">{paymentMethodLabel(pm.method)}</span>
                      <span className="text-sm font-semibold text-foreground">{fmt(Number(pm.total))}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-brand rounded-full" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">
                        {tDashboard('paymentMethodCount', { count: pm.count, percent })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  // Shifts branch
  const shiftsBranch = z ? (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderGridCard(tDashboard('shiftsSection'), <CalendarDays size={16} className="text-gray-400" />, renderRows(shiftsRows))}

        <div className="bg-card rounded-xl border border-border dark:border-border p-4">
          <div className="flex items-center gap-2 mb-4">
            <Wallet size={16} className="text-gray-400" />
            <h2 className="font-semibold text-foreground">{tDashboard('paymentMethods')}</h2>
          </div>
          {z.paymentMethods.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">{t('noData')}</p>
          ) : (
            <div className="space-y-3">
              {z.paymentMethods.map((pm) => {
                const percent = paymentMethodsTotal > 0
                  ? Math.max(0, Math.min(100, Math.round((Number(pm.total) / paymentMethodsTotal) * 100)))
                  : 0;
                return (
                  <div key={pm.method ?? 'unknown'}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-foreground">{paymentMethodLabel(pm.method)}</span>
                      <span className="text-sm font-semibold text-foreground">{fmt(Number(pm.total))}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-brand rounded-full" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">
                        {tDashboard('paymentMethodCount', { count: pm.count, percent })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {renderGridCard(tDashboard('shiftsSection'), <CalendarDays size={16} className="text-gray-400" />, (
            z.shifts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">{t('noData')}</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {z.shifts.map((s) => (
                  <div key={s.id} className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">
                        {formatDateTime(s.opened_at)}
                        {s.closed_at ? ` — ${formatDateTime(s.closed_at)}` : ''}
                      </span>
                      <span className={`text-xs font-medium ${s.status === 'open' ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                        {s.status === 'open' ? tDashboard('shiftOpenStatus') : tDashboard('shiftClosedStatus')}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{tPos('openingCash')}</span>
                        <span className="font-semibold text-foreground">{fmt(Number(s.opening_cash) || 0)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{tPos('closingCash')}</span>
                        <span className="font-semibold text-foreground">
                          {s.closing_cash === null ? '—' : fmt(Number(s.closing_cash) || 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{tDashboard('shiftExpected')}</span>
                        <span className="font-semibold text-foreground">{fmt(Number(s.expected_cash) || 0)}</span>
                      </div>
                      {s.variance !== null && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{tDashboard('shiftVariance')}</span>
                          <span className={`font-semibold ${Number(s.variance) < 0 ? 'text-red-600' : Number(s.variance) > 0 ? 'text-amber-600' : 'text-foreground'}`}>
                            {fmt(Number(s.variance) || 0)}
                          </span>
                        </div>
                      )}
                      {(s.opened_by_name || s.closed_by_name) && (
                        <div className="pt-0.5 text-xs text-muted-foreground">
                          {[
                            s.opened_by_name ? `${tDashboard('shiftOpenedBy')}: ${s.opened_by_name}` : null,
                            s.closed_by_name ? `${tDashboard('shiftClosedBy')}: ${s.closed_by_name}` : null,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      )}
                      {s.notes && <div className="text-xs italic text-muted-foreground">{s.notes}</div>}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-semibold text-foreground">
                    {tDashboard('shiftTotals')} · {z.shiftTotals.count} {z.shiftTotals.count === 1 ? tDashboard('shiftSingular') : tDashboard('shiftPlural')}
                  </span>
                  <span className="text-sm font-bold text-foreground">{fmt(Number(z.shiftTotals.variance) || 0)}</span>
                </div>
              </div>
            )
          ))}
        </div>
      </div>
    </div>
  ) : null;

  // Items branch
  const itemsBranch = items ? (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderGridCard(t('itemsReport'), <Package size={16} className="text-gray-400" />, renderRows(itemsRows))}

        <div className="bg-card rounded-xl border border-border dark:border-border p-4">
          <div className="flex items-center gap-2 mb-4">
            <Wallet size={16} className="text-gray-400" />
            <h2 className="font-semibold text-foreground">{tDashboard('paymentMethods')}</h2>
          </div>
          {z?.paymentMethods.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">{t('noData')}</p>
          ) : (
            <div className="space-y-3">
              {(z?.paymentMethods ?? []).map((pm) => {
                const percent = paymentMethodsTotal > 0
                  ? Math.max(0, Math.min(100, Math.round((Number(pm.total) / paymentMethodsTotal) * 100)))
                  : 0;
                return (
                  <div key={pm.method ?? 'unknown'}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-foreground">{paymentMethodLabel(pm.method)}</span>
                      <span className="text-sm font-semibold text-foreground">{fmt(Number(pm.total))}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-brand rounded-full" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">
                        {tDashboard('paymentMethodCount', { count: pm.count, percent })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {renderGridCard(t('itemsList'), <List size={16} className="text-gray-400" />, (
            items.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">{t('noData')}</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {items.map((item) => (
                  <div key={item.product_id} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-muted-foreground">{item.product_name}</span>
                    <span className="text-sm font-semibold text-foreground">
                      x{item.total_quantity} · {fmt(item.total_revenue)}
                    </span>
                  </div>
                ))}
              </div>
            )
          ))}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('generatedOn', { date: isItems ? `${dateDisplay(itemsStartDate)} — ${dateDisplay(itemsEndDate)}` : dateDisplay(reportDate ?? selectedDate) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              ref={dayInputRef}
              type="date"
              value={selectedDate}
              max={todayLocal}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="h-9 ps-3 pe-10 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-brand/30"
              aria-label={tDashboard('selectDate')}
            />
            <button
              type="button"
              onClick={() => openPicker(dayInputRef.current)}
              className="absolute inset-y-0 end-0 z-10 flex w-9 items-center justify-center rounded-e-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={tDashboard('openDatePicker')}
            >
              <CalendarDays size={16} />
            </button>
          </div>
          <button
            type="button"
            onClick={printZReport}
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Printer size={16} />
            {tCommon('print')}
          </button>
        </div>
      </div>

      <div className="mb-4 border-b border-border">
        <nav className="flex gap-4" aria-label={t('reportTabs')}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'z'}
            onClick={() => setActiveTab('z')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'z' ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t('zReportTab')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'x'}
            onClick={() => setActiveTab('x')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'x' ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t('xReportTab')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'shifts'}
            onClick={() => setActiveTab('shifts')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'shifts' ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {tDashboard('shiftsSection')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'items'}
            onClick={() => setActiveTab('items')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'items' ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t('itemsReportTab')}
          </button>
        </nav>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !hasData ? (
        <div className="flex items-center justify-center py-20 text-sm text-gray-400">{t('noData')}</div>
      ) : (
        <div>
          {/* Date range picker for items tab */}
          {isItems && (
            <div className="mb-4 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground">{tDashboard('startDate')}</label>
                <input
                  type="date"
                  value={itemsStartDate}
                  max={itemsEndDate}
                  onChange={(e) => e.target.value && setItemsStartDate(e.target.value)}
                  className="h-9 ps-3 pe-10 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground">{tDashboard('endDate')}</label>
                <input
                  type="date"
                  value={itemsEndDate}
                  min={itemsStartDate}
                  max={todayLocal}
                  onChange={(e) => e.target.value && setItemsEndDate(e.target.value)}
                  className="h-9 ps-3 pe-10 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {tiles.map((tile) => (
              <div key={tile.label} className={`rounded-xl border p-5 ${tile.color}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">{tile.label}</span>
                  <tile.icon size={20} className={tile.iconColor} />
                </div>
                <p className="text-3xl font-bold text-gray-900">
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          {isZ ? zBranch : isX ? xBranch : isShifts ? shiftsBranch : itemsBranch}
        </div>
      )}
    </div>
  );
}