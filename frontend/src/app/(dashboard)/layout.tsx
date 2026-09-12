'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import AppSidebar from '@/components/layout/Sidebar';
import AuthGuard from '@/components/layout/AuthGuard';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import StatusBar from '@/components/layout/StatusBar';
import GlobalNotifications from '@/components/layout/GlobalNotifications';
import TitleBar from '@/components/layout/TitleBar';
import { usePrinterStatusSync } from '@/hooks/usePrinter';

// The desktop static export runs with trailingSlash: true, so usePathname()
// returns "/pos/" (not "/pos"). Normalize before comparing so route checks
// work identically in the export and the cloud server build.
const normalizeRoute = (path: string) => (path === '/' ? path : path.replace(/\/+$/, ''));

// POS is a busy workspace: the sidebar collapses to icons on the /pos route
// (desktop only) so product grid and cart get maximum width. The initial
// render is collapsed via defaultOpen={!isPos} and this component re-collapses
// on SPA navigation into /pos. The operator can still expand it on demand via
// the rail or Ctrl/Cmd+B, and the pathname transition guard keeps it that way
// while they're on the POS page. Mobile keeps the off-canvas sheet untouched.
function PosSidebarAutoCollapse() {
  const pathname = usePathname();
  const { setOpen, isMobile } = useSidebar();
  const prevPathname = useRef<string | null>(null);

  useEffect(() => {
    const current = normalizeRoute(pathname);
    const wasOutsidePos = prevPathname.current !== '/pos';
    prevPathname.current = current;
    if (!isMobile && wasOutsidePos && current === '/pos') {
      setOpen(false);
    }
  }, [pathname, isMobile, setOpen]);

  return null;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const normalized = normalizeRoute(pathname);
  const isPos = normalized === '/pos' || normalized === '/kds';
  const isSettings = normalized === '/settings';
  // Hoisted here (rather than only in PrinterStatus/Settings) so hardwarePrinter
  // and the WebUSB reconnect attempt are ready before the POS page can place
  // its first order — closes the startup race described in issue #534.
  usePrinterStatusSync();

  return (
    <AuthGuard>
      <SidebarProvider defaultOpen={!isPos} className="flex h-screen min-h-0 flex-col w-full" style={{ minHeight: 0 }}>
        <PosSidebarAutoCollapse />
        <TitleBar />
        <div className="flex min-h-0 flex-1 w-full overflow-hidden">
          <AppSidebar />
          <SidebarInset className="h-full min-h-0 overflow-hidden flex flex-col">
            {/* Mobile-only app bar: below md the sidebar renders as a Sheet with
                no opener, so expose the trigger here (Refs #241). */}
            <div className="md:hidden flex items-center px-2 py-1.5 border-b border-border bg-card shrink-0">
              <SidebarTrigger className="size-8" aria-label="Open navigation" />
            </div>
            {!isPos && <GlobalNotifications />}
            <div className={isPos
              ? 'flex-1 min-h-0 flex flex-col overflow-hidden p-4'
              : isSettings
              ? 'flex-1 min-h-0 p-4 overflow-auto md:overflow-hidden min-w-0'
              : 'flex-1 p-4 overflow-auto min-w-0'
            }>
              {children}
            </div>
            <StatusBar showUpdateBadge={false} />
          </SidebarInset>
        </div>
      </SidebarProvider>
    </AuthGuard>
  );
}
