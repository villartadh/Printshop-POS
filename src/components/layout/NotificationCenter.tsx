import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  ClipboardList,
  PackageOpen,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { Button } from '../ui/Primitives.tsx';

export const NotificationCenter: React.FC = () => {
  const {
    belowMinimumItems,
    hasSimultaneousThresholdBreach,
    inventoryNotifications,
    acknowledgedAlertSignatures,
    unreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    openReorderRequestModal,
    setActiveModule,
  } = useApp();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const simultaneousAlert = inventoryNotifications.find(
    (n) => n.kind === 'simultaneous_minimum_breach',
  );
  const itemAlerts = inventoryNotifications.filter(
    (n) => n.kind !== 'simultaneous_minimum_breach',
  );
  const hasUnread = unreadNotificationCount > 0;
  const badgeCount =
    unreadNotificationCount > 0
      ? unreadNotificationCount
      : hasSimultaneousThresholdBreach
        ? belowMinimumItems.length
        : 0;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          hasSimultaneousThresholdBreach
            ? `Notification Center: ${belowMinimumItems.length} items below minimum threshold`
            : `Notification Center (${inventoryNotifications.length} alerts)`
        }
        title="Notification Center"
        className={`relative h-9 px-2.5 rounded-lg border flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
          hasSimultaneousThresholdBreach
            ? 'border-[var(--pos-error)]/40 bg-[var(--pos-error)]/10 text-[var(--pos-error)] hover:bg-[var(--pos-error)]/15'
            : 'border-[var(--pos-border)] text-[var(--pos-text-muted)] hover:text-[var(--pos-text)] hover:bg-slate-50 dark:hover:bg-slate-800'
        }`}
      >
        <Bell className="w-4 h-4 shrink-0" />
        <span className="hidden lg:inline">Alerts</span>
        {badgeCount > 0 && (
          <span
            className={`font-mono-num text-[11px] font-bold px-1.5 py-0.5 rounded-md leading-none ${
              hasSimultaneousThresholdBreach || hasUnread
                ? 'bg-[var(--pos-error)] text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-[var(--pos-text)]'
            }`}
          >
            {badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notification Center"
          style={{ borderRadius: 'calc(var(--pos-radius) + 2px)' }}
          className="absolute right-0 mt-1.5 w-[min(92vw,24rem)] max-h-[75dvh] flex flex-col bg-[var(--pos-surface)] border border-[var(--pos-border)] shadow-xl z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--pos-border)] flex items-center justify-between gap-2 shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-[var(--pos-text)]">
                Notification Center
              </h2>
              <p className="text-[11px] text-[var(--pos-text-muted)] font-mono-num">
                {inventoryNotifications.length === 0
                  ? 'All stock thresholds healthy'
                  : `${inventoryNotifications.length} active alert(s) · ${unreadNotificationCount} unread`}
              </p>
            </div>
            {unreadNotificationCount > 0 && (
              <button
                type="button"
                onClick={markAllNotificationsRead}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--pos-primary)] hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--pos-border)]">
            {simultaneousAlert && (
              <div className="p-3.5 bg-[var(--pos-error)]/[0.07] space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-[var(--pos-error)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[var(--pos-error)]">
                        Simultaneous Minimum Threshold Alert
                      </div>
                      <p className="text-xs font-semibold text-[var(--pos-text)] mt-0.5">
                        {simultaneousAlert.title}
                      </p>
                    </div>
                  </div>
                  {!acknowledgedAlertSignatures.includes(simultaneousAlert.signature) && (
                    <button
                      type="button"
                      onClick={() => markNotificationRead(simultaneousAlert.signature)}
                      title="Mark alert as read"
                      aria-label="Mark simultaneous alert as read"
                      className="p-1 rounded text-[var(--pos-text-muted)] hover:text-[var(--pos-text)] hover:bg-[var(--pos-surface)] cursor-pointer shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-1 pl-6">
                  {simultaneousAlert.affectedItems.map((item) => {
                    const stock = Math.max(
                      0,
                      Number(item.currentStock ?? item.quantityOnHand) || 0,
                    );
                    const min = Math.max(0, Number(item.minimumThreshold) || 0);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="text-[var(--pos-text)] font-medium truncate">
                          {item.name}
                        </span>
                        <span className="font-mono-num text-[var(--pos-error)] font-semibold whitespace-nowrap shrink-0">
                          {stock} / {min} {item.unit}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 pl-6 pt-0.5">
                  <Button
                    size="sm"
                    onClick={() => {
                      markNotificationRead(simultaneousAlert.signature);
                      setOpen(false);
                      openReorderRequestModal('below_minimum');
                    }}
                  >
                    <ClipboardList className="w-3.5 h-3.5" />
                    Generate Reorder List
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOpen(false);
                      setActiveModule('inventory');
                    }}
                  >
                    View Inventory
                  </Button>
                </div>
              </div>
            )}

            {itemAlerts.length > 0 ? (
              <div className="divide-y divide-[var(--pos-border)]">
                {itemAlerts.map((notif) => {
                  const isUnread = !acknowledgedAlertSignatures.includes(notif.signature);
                  const isCritical = notif.severity === 'critical';
                  return (
                    <div
                      key={notif.id}
                      className={`px-3.5 py-2.5 flex items-start justify-between gap-2.5 transition-colors ${
                        isUnread ? 'bg-[var(--pos-bg)]/70' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <AlertTriangle
                          className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                            isCritical
                              ? 'text-[var(--pos-error)]'
                              : 'text-[var(--pos-warning)]'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[var(--pos-text)] truncate">
                            {notif.title}
                          </div>
                          <div className="text-[11px] text-[var(--pos-text-muted)] mt-0.5">
                            {notif.message}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isUnread && (
                          <button
                            type="button"
                            onClick={() => markNotificationRead(notif.signature)}
                            title="Mark read"
                            aria-label={`Mark ${notif.title} read`}
                            className="p-1 rounded text-[var(--pos-text-muted)] hover:text-[var(--pos-text)] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : !simultaneousAlert ? (
              <div className="px-4 py-8 text-center">
                <PackageOpen className="w-7 h-7 mx-auto text-[var(--pos-text-muted)] mb-2" />
                <p className="text-xs font-semibold text-[var(--pos-text)]">
                  No active stock threshold alerts
                </p>
                <p className="text-[11px] text-[var(--pos-text-muted)] mt-1">
                  You will be alerted here when multiple items drop below their minimum threshold simultaneously.
                </p>
              </div>
            ) : null}
          </div>

          {/* Footer */}
          {inventoryNotifications.length > 0 && (
            <div className="px-3.5 py-2.5 border-t border-[var(--pos-border)] bg-[var(--pos-bg)] flex items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setActiveModule('inventory');
                }}
                className="text-xs font-medium text-[var(--pos-text-muted)] hover:text-[var(--pos-text)] cursor-pointer"
              >
                Open Inventory Module
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openReorderRequestModal(
                    belowMinimumItems.length > 0 ? 'below_minimum' : 'all_low_stock',
                  );
                }}
                className="text-xs font-semibold text-[var(--pos-primary)] hover:underline cursor-pointer"
              >
                Reorder Request List →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
