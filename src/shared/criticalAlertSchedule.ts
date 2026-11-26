import type {
  CriticalAlertScheduleConfig,
  CriticalAlertScheduleStatus,
  CriticalThresholdTriggerMode,
  InventoryItem,
  OffHoursAlertChannel,
} from '../types/inventory.ts';

export const COMMON_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: 'Asia/Manila', label: 'Asia/Manila (PHT, UTC+8)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT, UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST, UTC+9)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PT)' },
  { value: 'America/New_York', label: 'America/New_York (ET)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'UTC', label: 'UTC' },
];

export const DEFAULT_CRITICAL_ALERT_CONFIG: CriticalAlertScheduleConfig = {
  enabled: true,
  channel: 'system',
  recipientEmails: [],
  monitorWeekends: true,
  monitorOffHoursWeekdays: true,
  businessHoursStart: '08:00',
  businessHoursEnd: '18:00',
  timezone: 'Asia/Manila',
  triggerMode: 'below_minimum',
  cooldownMinutes: 60,
  updatedAt: new Date(0).toISOString(),
};

const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL_REGEX = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

export function isValidEmailAddress(email: string): boolean {
  const clean = email.trim();
  return clean.length > 3 && clean.length <= 254 && EMAIL_REGEX.test(clean);
}

export function isValidTimeHHmm(value: string): boolean {
  return TIME_HHMM_REGEX.test(value.trim());
}

export function isValidTimeZone(tz: string): boolean {
  const clean = tz.trim();
  if (!clean) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: clean });
    return true;
  } catch {
    return false;
  }
}

function parseMinutes(hhmm: string): number {
  const match = TIME_HHMM_REGEX.exec(hhmm.trim());
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function normalizeCriticalAlertConfig(
  raw?: Partial<CriticalAlertScheduleConfig> | null,
): CriticalAlertScheduleConfig {
  const channel: OffHoursAlertChannel =
    raw?.channel === 'system' || raw?.channel === 'email' || raw?.channel === 'both'
      ? raw.channel
      : DEFAULT_CRITICAL_ALERT_CONFIG.channel;

  const triggerMode: CriticalThresholdTriggerMode =
    raw?.triggerMode === 'at_or_below_minimum' ? 'at_or_below_minimum' : 'below_minimum';

  const recipientEmails = Array.isArray(raw?.recipientEmails)
    ? Array.from(
        new Set(
          raw.recipientEmails
            .map((e) => String(e || '').trim().toLowerCase())
            .filter((e) => isValidEmailAddress(e)),
        ),
      ).slice(0, 20)
    : [];

  const businessHoursStart =
    typeof raw?.businessHoursStart === 'string' && isValidTimeHHmm(raw.businessHoursStart)
      ? raw.businessHoursStart.trim()
      : DEFAULT_CRITICAL_ALERT_CONFIG.businessHoursStart;

  const businessHoursEnd =
    typeof raw?.businessHoursEnd === 'string' && isValidTimeHHmm(raw.businessHoursEnd)
      ? raw.businessHoursEnd.trim()
      : DEFAULT_CRITICAL_ALERT_CONFIG.businessHoursEnd;

  const timezone =
    typeof raw?.timezone === 'string' && isValidTimeZone(raw.timezone)
      ? raw.timezone.trim()
      : DEFAULT_CRITICAL_ALERT_CONFIG.timezone;

  const rawCooldown = Number(raw?.cooldownMinutes);
  const cooldownMinutes = Number.isFinite(rawCooldown)
    ? Math.min(1440, Math.max(5, Math.round(rawCooldown)))
    : DEFAULT_CRITICAL_ALERT_CONFIG.cooldownMinutes;

  return {
    enabled:
      raw?.enabled !== undefined ? Boolean(raw.enabled) : DEFAULT_CRITICAL_ALERT_CONFIG.enabled,
    channel,
    recipientEmails,
    monitorWeekends:
      raw?.monitorWeekends !== undefined
        ? Boolean(raw.monitorWeekends)
        : DEFAULT_CRITICAL_ALERT_CONFIG.monitorWeekends,
    monitorOffHoursWeekdays:
      raw?.monitorOffHoursWeekdays !== undefined
        ? Boolean(raw.monitorOffHoursWeekdays)
        : DEFAULT_CRITICAL_ALERT_CONFIG.monitorOffHoursWeekdays,
    businessHoursStart,
    businessHoursEnd,
    timezone,
    triggerMode,
    cooldownMinutes,
    updatedAt:
      typeof raw?.updatedAt === 'string' && raw.updatedAt
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}

export function validateCriticalAlertConfig(
  input: Partial<CriticalAlertScheduleConfig>,
): { valid: true } | { valid: false; error: string } {
  if (
    input.channel !== undefined &&
    input.channel !== 'system' &&
    input.channel !== 'email' &&
    input.channel !== 'both'
  ) {
    return { valid: false, error: 'Alert delivery channel must be system, email, or both.' };
  }

  if (
    input.businessHoursStart !== undefined &&
    !isValidTimeHHmm(String(input.businessHoursStart))
  ) {
    return { valid: false, error: 'Business hours start must use HH:MM 24-hour format.' };
  }

  if (
    input.businessHoursEnd !== undefined &&
    !isValidTimeHHmm(String(input.businessHoursEnd))
  ) {
    return { valid: false, error: 'Business hours end must use HH:MM 24-hour format.' };
  }

  if (input.timezone !== undefined && !isValidTimeZone(String(input.timezone))) {
    return { valid: false, error: 'Please select a valid IANA timezone.' };
  }

  if (input.recipientEmails !== undefined) {
    if (!Array.isArray(input.recipientEmails)) {
      return { valid: false, error: 'Recipient emails must be a list.' };
    }
    if (input.recipientEmails.length > 20) {
      return { valid: false, error: 'Maximum of 20 recipient email addresses allowed.' };
    }
    for (const email of input.recipientEmails) {
      if (!isValidEmailAddress(String(email || ''))) {
        return { valid: false, error: `Invalid email address: ${String(email)}` };
      }
    }
  }

  const effectiveChannel = input.channel ?? 'both';
  const effectiveEmails = input.recipientEmails ?? [];
  if (
    input.enabled !== false &&
    (effectiveChannel === 'email' || effectiveChannel === 'both') &&
    effectiveEmails.length === 0
  ) {
    return {
      valid: false,
      error: 'Add at least one recipient email address when email alerts are enabled.',
    };
  }

  if (input.cooldownMinutes !== undefined) {
    const mins = Number(input.cooldownMinutes);
    if (!Number.isFinite(mins) || mins < 5 || mins > 1440) {
      return { valid: false, error: 'Alert cooldown must be between 5 and 1440 minutes.' };
    }
  }

  return { valid: true };
}

export function evaluateOffHoursScheduleWindow(
  config: CriticalAlertScheduleConfig,
  date: Date = new Date(),
): CriticalAlertScheduleStatus {
  const tz = isValidTimeZone(config.timezone) ? config.timezone : 'UTC';
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const rawHour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const hourNum = Number(rawHour) === 24 ? 0 : Number(rawHour);
  const minuteNum = Number(parts.find((p) => p.type === 'minute')?.value ?? '00');
  const currentHHmm = `${String(hourNum).padStart(2, '0')}:${String(minuteNum).padStart(2, '0')}`;
  const currentMins = hourNum * 60 + minuteNum;

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const startMins = parseMinutes(config.businessHoursStart);
  const endMins = parseMinutes(config.businessHoursEnd);

  let withinBusinessHours = false;
  if (startMins === endMins) {
    withinBusinessHours = false;
  } else if (startMins < endMins) {
    withinBusinessHours = currentMins >= startMins && currentMins < endMins;
  } else {
    // Overnight operating schedule
    withinBusinessHours = currentMins >= startMins || currentMins < endMins;
  }

  const localTimeSummary = `${weekday} ${currentHHmm} (${tz})`;

  if (isWeekend) {
    if (config.monitorWeekends) {
      return {
        isOffHoursOrWeekend: true,
        triggerReason: 'weekend',
        windowLabel: `Weekend Window (${weekday} ${currentHHmm})`,
        localTimeSummary,
      };
    }
    return {
      isOffHoursOrWeekend: false,
      triggerReason: null,
      windowLabel: `Weekend Monitoring Disabled (${weekday} ${currentHHmm})`,
      localTimeSummary,
    };
  }

  if (!withinBusinessHours && config.monitorOffHoursWeekdays) {
    return {
      isOffHoursOrWeekend: true,
      triggerReason: 'off_hours',
      windowLabel: `Off-Hours Window (${weekday} ${currentHHmm}, outside ${config.businessHoursStart}–${config.businessHoursEnd})`,
      localTimeSummary,
    };
  }

  return {
    isOffHoursOrWeekend: false,
    triggerReason: null,
    windowLabel: `Operating Hours (${weekday} ${currentHHmm}, ${config.businessHoursStart}–${config.businessHoursEnd})`,
    localTimeSummary,
  };
}

export function getCriticalThresholdValue(item: InventoryItem): number {
  const minThreshold = Math.max(0, Number(item.minimumThreshold) || 0);
  return minThreshold;
}

export function isItemInCriticalAlertState(
  item: InventoryItem,
  triggerMode: CriticalThresholdTriggerMode = 'below_minimum',
): boolean {
  const stock = Math.max(0, Number(item.currentStock ?? item.quantityOnHand) || 0);
  const minThreshold = getCriticalThresholdValue(item);

  if (minThreshold <= 0) {
    return stock <= 0;
  }
  return triggerMode === 'at_or_below_minimum'
    ? stock <= minThreshold
    : stock < minThreshold;
}
