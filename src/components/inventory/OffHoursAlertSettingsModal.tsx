import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Check,
  CheckCheck,
  Clock,
  Mail,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import {
  COMMON_TIMEZONES,
  evaluateOffHoursScheduleWindow,
  isValidEmailAddress,
  validateCriticalAlertConfig,
} from '../../shared/criticalAlertSchedule.ts';
import type {
  CriticalAlertScheduleConfig,
  CriticalThresholdTriggerMode,
  OffHoursAlertChannel,
} from '../../shared/types.ts';
import { Modal } from '../ui/Overlays.tsx';
import { Button, Card, Input, Select, StatusIndicator } from '../ui/Primitives.tsx';

export interface OffHoursAlertSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type ModalTab = 'rules' | 'history';

export const OffHoursAlertSettingsModal: React.FC<OffHoursAlertSettingsModalProps> = ({
  open,
  onClose,
}) => {
  const {
    session,
    settings,
    criticalAlertConfig,
    criticalAlertEvents,
    activeCriticalSystemAlerts,
    criticalAlertSmtpConfigured,
    saveCriticalAlertConfig,
    triggerCriticalAlertTest,
    acknowledgeCriticalAlert,
    acknowledgeAllCriticalAlerts,
    notify,
  } = useApp();

  const canConfigure =
    session?.user.role === 'admin' || session?.user.role === 'manager';

  const [tab, setTab] = useState<ModalTab>('rules');
  const [draft, setDraft] = useState<CriticalAlertScheduleConfig>(criticalAlertConfig);
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(criticalAlertConfig);
      setNewEmail('');
    }
  }, [open, criticalAlertConfig]);

  const timezoneOptions = useMemo(() => {
    const detected =
      typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : '';
    const base = [...COMMON_TIMEZONES];
    if (detected && !base.some((tz) => tz.value === detected)) {
      base.unshift({ value: detected, label: `${detected} (Device Local)` });
    }
    if (draft.timezone && !base.some((tz) => tz.value === draft.timezone)) {
      base.unshift({ value: draft.timezone, label: draft.timezone });
    }
    return base;
  }, [draft.timezone]);

  const liveWindowStatus = useMemo(
    () => evaluateOffHoursScheduleWindow(draft),
    [draft],
  );

  const suggestedEmail = useMemo(() => {
    const candidates = [session?.user.email, settings.branding.email]
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => isValidEmailAddress(e));
    return candidates.find((e) => !draft.recipientEmails.includes(e)) || '';
  }, [session?.user.email, settings.branding.email, draft.recipientEmails]);

  const handleAddEmail = (emailToAdd?: string) => {
    const clean = (emailToAdd ?? newEmail).trim().toLowerCase();
    if (!clean) return;
    if (!isValidEmailAddress(clean)) {
      notify('Please enter a valid email address.', 'error');
      return;
    }
    if (draft.recipientEmails.includes(clean)) {
      notify('Email address is already in the recipient list.', 'info');
      setNewEmail('');
      return;
    }
    setDraft((prev) => ({
      ...prev,
      recipientEmails: [...prev.recipientEmails, clean],
    }));
    if (!emailToAdd) setNewEmail('');
  };

  const handleRemoveEmail = (target: string) => {
    setDraft((prev) => ({
      ...prev,
      recipientEmails: prev.recipientEmails.filter((e) => e !== target),
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfigure) {
      notify('Only managers or administrators can update alert rules.', 'error');
      return;
    }
    const validation = validateCriticalAlertConfig(draft);
    if (!validation.valid) {
      notify(validation.error, 'error');
      return;
    }
    setSaving(true);
    try {
      await saveCriticalAlertConfig(draft);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save alert rules.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRunTest = async () => {
    if (!canConfigure) return;
    setTesting(true);
    try {
      // Save unsaved draft changes first if valid so test reflects current form
      const validation = validateCriticalAlertConfig(draft);
      if (!validation.valid) {
        notify(validation.error, 'error');
        return;
      }
      await saveCriticalAlertConfig(draft);
      const res = await triggerCriticalAlertTest(true);
      if (res.triggeredEvents.length > 0) {
        setTab('history');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to run off-hours test.', 'error');
    } finally {
      setTesting(false);
    }
  };

  const needsEmail = draft.channel === 'email' || draft.channel === 'both';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Off-Hours & Weekend Critical Stock Alerts"
      subtitle="Automate email and system notifications when inventory drops below critical thresholds outside operating hours"
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Live Schedule & Transport Status Strip */}
        <div
          style={{ borderRadius: 'var(--pos-radius)' }}
          className="p-3 border border-[var(--pos-border)] bg-[var(--pos-bg)] flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <div className="space-y-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusIndicator
                tone={
                  !draft.enabled
                    ? 'neutral'
                    : liveWindowStatus.isOffHoursOrWeekend
                      ? 'warning'
                      : 'info'
                }
                label={
                  !draft.enabled
                    ? 'Monitoring Paused'
                    : liveWindowStatus.isOffHoursOrWeekend
                      ? 'Active Off-Hours / Weekend Window'
                      : 'Operating Hours (Standby)'
                }
              />
              <span className="font-mono-num text-[11px] text-[var(--pos-text-muted)]">
                {liveWindowStatus.localTimeSummary}
              </span>
            </div>
            <div className="text-[11px] text-[var(--pos-text-muted)]">
              {liveWindowStatus.windowLabel}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {criticalAlertSmtpConfigured ? (
              <StatusIndicator tone="success" label="SMTP Live Email Ready" />
            ) : (
              <StatusIndicator tone="info" label="System + Digest Preview Mode" />
            )}
          </div>
        </div>

        {/* Sub-navigation Tabs */}
        <div
          role="tablist"
          aria-label="Alert settings sections"
          style={{ borderRadius: 'var(--pos-radius)' }}
          className="inline-flex items-center gap-1 p-1 bg-[var(--pos-bg)] border border-[var(--pos-border)]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'rules'}
            onClick={() => setTab('rules')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
              tab === 'rules'
                ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
            }`}
          >
            Schedule &amp; Email Rules
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            onClick={() => setTab('history')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
              tab === 'history'
                ? 'bg-[var(--pos-surface)] text-[var(--pos-text)] shadow-xs border border-[var(--pos-border)]'
                : 'text-[var(--pos-text-muted)] hover:text-[var(--pos-text)]'
            }`}
          >
            Alert History &amp; System Feed ({criticalAlertEvents.length}
            {activeCriticalSystemAlerts.length > 0
              ? ` · ${activeCriticalSystemAlerts.length} active`
              : ''}
            )
          </button>
        </div>

        {tab === 'rules' ? (
          <form onSubmit={handleSave} className="space-y-4">
            {/* Enable & Channel */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <label
                style={{ borderRadius: 'var(--pos-radius)' }}
                className="flex items-start gap-2.5 p-3 border border-[var(--pos-border)] bg-[var(--pos-surface)] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  disabled={!canConfigure}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, enabled: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 accent-[var(--pos-primary)]"
                />
                <div className="text-xs">
                  <div className="font-semibold text-[var(--pos-text)]">
                    Enable Automated Off-Hours Alerts
                  </div>
                  <div className="text-[11px] text-[var(--pos-text-muted)] mt-0.5">
                    Server checks inventory continuously and upon stock deductions outside business hours.
                  </div>
                </div>
              </label>

              <Select
                label="Alert Delivery Channel"
                value={draft.channel}
                disabled={!canConfigure}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    channel: e.target.value as OffHoursAlertChannel,
                  }))
                }
                options={[
                  { value: 'both', label: 'Email + System Notification Center' },
                  { value: 'system', label: 'System Notification Center Only' },
                  { value: 'email', label: 'Automated Email Alert Only' },
                ]}
              />
            </div>

            {/* Schedule Window */}
            <Card className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--pos-text)]">
                <Clock className="w-4 h-4 text-[var(--pos-primary)]" />
                <span>Weekend &amp; Off-Hours Schedule Window</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="flex items-center gap-2 text-xs text-[var(--pos-text)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.monitorWeekends}
                    disabled={!canConfigure}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        monitorWeekends: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-[var(--pos-primary)]"
                  />
                  <span>Monitor all day on Weekends (Saturday &amp; Sunday)</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-[var(--pos-text)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.monitorOffHoursWeekdays}
                    disabled={!canConfigure}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        monitorOffHoursWeekdays: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-[var(--pos-primary)]"
                  />
                  <span>Monitor Weekday Off-Hours (outside operating hours)</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <Input
                  label="Operating Hours Start"
                  type="time"
                  className="font-mono-num"
                  disabled={!canConfigure || !draft.monitorOffHoursWeekdays}
                  value={draft.businessHoursStart}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      businessHoursStart: e.target.value,
                    }))
                  }
                />
                <Input
                  label="Operating Hours End"
                  type="time"
                  className="font-mono-num"
                  disabled={!canConfigure || !draft.monitorOffHoursWeekdays}
                  value={draft.businessHoursEnd}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      businessHoursEnd: e.target.value,
                    }))
                  }
                />
                <Select
                  label="Store Timezone"
                  value={draft.timezone}
                  disabled={!canConfigure}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, timezone: e.target.value }))
                  }
                  options={timezoneOptions}
                />
              </div>
            </Card>

            {/* Threshold Rule & Cooldown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Critical Threshold Rule"
                value={draft.triggerMode}
                disabled={!canConfigure}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    triggerMode: e.target.value as CriticalThresholdTriggerMode,
                  }))
                }
                options={[
                  {
                    value: 'below_minimum',
                    label: 'Strictly below Minimum Threshold (< min, or 0)',
                  },
                  {
                    value: 'at_or_below_minimum',
                    label: 'At or below Minimum Threshold (<= min, or 0)',
                  },
                ]}
              />
              <Input
                label="Repeat Alert Cooldown (minutes)"
                type="number"
                min={5}
                max={1440}
                className="font-mono-num"
                disabled={!canConfigure}
                value={String(draft.cooldownMinutes)}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    cooldownMinutes: Math.max(5, Math.min(1440, Number(e.target.value) || 60)),
                  }))
                }
              />
            </div>

            {/* Email Recipients */}
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--pos-text)]">
                  <Mail className="w-4 h-4 text-[var(--pos-primary)]" />
                  <span>
                    Email Alert Recipients{' '}
                    {needsEmail ? '(Required for Email channel)' : '(Optional)'}
                  </span>
                </div>
                {canConfigure && suggestedEmail && (
                  <button
                    type="button"
                    onClick={() => handleAddEmail(suggestedEmail)}
                    className="text-[11px] font-medium text-[var(--pos-primary)] hover:underline cursor-pointer"
                  >
                    + Add {suggestedEmail}
                  </button>
                )}
              </div>

              {!criticalAlertSmtpConfigured && needsEmail && (
                <div
                  style={{ borderRadius: 'var(--pos-radius)' }}
                  className="p-2.5 text-[11px] border border-[var(--pos-border)] bg-[var(--pos-bg)] text-[var(--pos-text-muted)]"
                >
                  Server SMTP environment variables (<span className="font-mono-num">SMTP_HOST</span>,{' '}
                  <span className="font-mono-num">SMTP_USER</span>,{' '}
                  <span className="font-mono-num">SMTP_PASS</span>) are not set yet. Alerts will still trigger in the System Notification Center and record email digest previews in Alert History until SMTP is configured.
                </div>
              )}

              {canConfigure && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input
                      aria-label="Recipient email address"
                      type="email"
                      placeholder="manager@printshop.local"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddEmail();
                        }
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="whitespace-nowrap shrink-0 h-10"
                    onClick={() => handleAddEmail()}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Email
                  </Button>
                </div>
              )}

              {draft.recipientEmails.length === 0 ? (
                <div className="text-xs text-[var(--pos-text-muted)]">
                  No email recipients configured yet.
                </div>
              ) : (
                <div className="divide-y divide-[var(--pos-border)] border border-[var(--pos-border)] rounded-lg overflow-hidden">
                  {draft.recipientEmails.map((email) => (
                    <div
                      key={email}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-xs bg-[var(--pos-bg)]"
                    >
                      <span className="font-mono-num text-[var(--pos-text)] truncate">
                        {email}
                      </span>
                      {canConfigure && (
                        <button
                          type="button"
                          onClick={() => handleRemoveEmail(email)}
                          aria-label={`Remove ${email}`}
                          className="p-1 rounded text-[var(--pos-text-muted)] hover:text-[var(--pos-error)] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Footer Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--pos-border)]">
              <div>
                {canConfigure && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={testing}
                    className="whitespace-nowrap shrink-0"
                    onClick={() => void handleRunTest()}
                  >
                    <Play className="w-3.5 h-3.5" />
                    Simulate Off-Hours Check Now
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onClose}
                >
                  Close
                </Button>
                {canConfigure && (
                  <Button type="submit" loading={saving}>
                    <ShieldCheck className="w-4 h-4" />
                    Save Alert Schedule
                  </Button>
                )}
              </div>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-[var(--pos-text-muted)]">
                Server-logged alerts triggered during weekend or off-hours windows (plus manual tests).
              </div>
              {activeCriticalSystemAlerts.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="whitespace-nowrap shrink-0"
                  onClick={() => void acknowledgeAllCriticalAlerts()}
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Acknowledge All ({activeCriticalSystemAlerts.length})
                </Button>
              )}
            </div>

            {criticalAlertEvents.length === 0 ? (
              <Card className="py-10 text-center space-y-2">
                <BellRing className="w-7 h-7 mx-auto text-[var(--pos-text-muted)] opacity-45" />
                <div className="text-sm font-semibold text-[var(--pos-text)]">
                  No off-hours or weekend alerts recorded yet
                </div>
                <p className="text-xs text-[var(--pos-text-muted)]">
                  Use &ldquo;Simulate Off-Hours Check Now&rdquo; in Schedule &amp; Email Rules to verify alert delivery anytime.
                </p>
              </Card>
            ) : (
              <div className="max-h-[400px] overflow-y-auto divide-y divide-[var(--pos-border)] border border-[var(--pos-border)] rounded-lg">
                {criticalAlertEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className={`p-3 flex flex-wrap items-start justify-between gap-3 ${
                      ev.systemAlertStatus === 'active'
                        ? 'bg-[var(--pos-error)]/[0.06]'
                        : 'bg-[var(--pos-surface)]'
                    }`}
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTriangle
                          className={`w-3.5 h-3.5 shrink-0 ${
                            ev.systemAlertStatus === 'active'
                              ? 'text-[var(--pos-error)]'
                              : 'text-[var(--pos-text-muted)]'
                          }`}
                        />
                        <span className="text-xs font-semibold text-[var(--pos-text)]">
                          {ev.itemName}
                        </span>
                        <span className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
                          {ev.sku}
                        </span>
                        <StatusIndicator
                          tone={
                            ev.triggerReason === 'manual_test'
                              ? 'info'
                              : ev.systemAlertStatus === 'active'
                                ? 'error'
                                : 'neutral'
                          }
                          label={
                            ev.triggerReason === 'weekend'
                              ? 'Weekend Breach'
                              : ev.triggerReason === 'off_hours'
                                ? 'Off-Hours Breach'
                                : 'Simulated Check'
                          }
                        />
                      </div>

                      <div className="text-[11px] font-mono-num text-[var(--pos-text)] pl-5">
                        On hand: <strong className="text-[var(--pos-error)]">{ev.quantityOnHand} {ev.unit}</strong>{' '}
                        · Critical threshold: {ev.criticalThreshold} {ev.unit}
                      </div>

                      <div className="text-[11px] text-[var(--pos-text-muted)] pl-5">
                        {ev.windowLabel} · {new Date(ev.triggeredAt).toLocaleString()}
                      </div>

                      {ev.emailStatus !== 'not_applicable' && (
                        <div className="text-[11px] text-[var(--pos-text-muted)] pl-5">
                          <span className="font-semibold text-[var(--pos-text)]">
                            Email ({ev.emailStatus === 'sent' ? 'Sent' : ev.emailStatus === 'failed' ? 'Failed' : 'Logged Preview'}):
                          </span>{' '}
                          {ev.emailStatusDetail}
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      {ev.systemAlertStatus === 'active' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void acknowledgeCriticalAlert(ev.id)}
                        >
                          <Check className="w-3.5 h-3.5" />
                          Acknowledge
                        </Button>
                      ) : (
                        <span className="text-[11px] text-[var(--pos-text-muted)]">
                          {ev.acknowledgedBy ? `Ack by ${ev.acknowledgedBy}` : 'Acknowledged'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
