import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CRITICAL_ALERT_CONFIG,
  evaluateOffHoursScheduleWindow,
  isItemInCriticalAlertState,
  normalizeCriticalAlertConfig,
  validateCriticalAlertConfig,
} from '../../shared/criticalAlertSchedule.ts';
import { DEMO_INVENTORY } from '../../shared/defaults.ts';

describe('criticalAlertSchedule', () => {
  it('validates alert config rules including email requirements and HH:MM bounds', () => {
    expect(
      validateCriticalAlertConfig({
        enabled: true,
        channel: 'email',
        recipientEmails: [],
      }),
    ).toEqual({
      valid: false,
      error: 'Add at least one recipient email address when email alerts are enabled.',
    });

    expect(
      validateCriticalAlertConfig({
        enabled: true,
        channel: 'both',
        recipientEmails: ['bad-email'],
      }).valid,
    ).toBe(false);

    expect(
      validateCriticalAlertConfig({
        enabled: true,
        channel: 'system',
        businessHoursStart: '25:00',
      }).valid,
    ).toBe(false);

    expect(
      validateCriticalAlertConfig({
        enabled: true,
        channel: 'system',
        cooldownMinutes: 2,
      }).valid,
    ).toBe(false);

    expect(
      validateCriticalAlertConfig({
        enabled: true,
        channel: 'both',
        recipientEmails: ['ops@printshop.local'],
        businessHoursStart: '08:00',
        businessHoursEnd: '18:00',
        timezone: 'UTC',
        cooldownMinutes: 60,
      }),
    ).toEqual({ valid: true });
  });

  it('normalizes recipient emails, clamps cooldowns, and falls back safely', () => {
    const normalized = normalizeCriticalAlertConfig({
      channel: 'email',
      recipientEmails: ['  OPS@Example.COM ', 'ops@example.com', 'invalid'],
      cooldownMinutes: 9999,
      timezone: 'Invalid/Zone',
    });
    expect(normalized.channel).toBe('email');
    expect(normalized.recipientEmails).toEqual(['ops@example.com']);
    expect(normalized.cooldownMinutes).toBe(1440);
    expect(normalized.timezone).toBe(DEFAULT_CRITICAL_ALERT_CONFIG.timezone);
  });

  it('evaluates weekend, weekday off-hours, operating hours, and overnight windows in UTC', () => {
    const cfg = normalizeCriticalAlertConfig({
      ...DEFAULT_CRITICAL_ALERT_CONFIG,
      timezone: 'UTC',
      businessHoursStart: '08:00',
      businessHoursEnd: '18:00',
      monitorWeekends: true,
      monitorOffHoursWeekdays: true,
    });

    // Saturday 2026-02-07 10:00 UTC -> weekend window
    const saturday = evaluateOffHoursScheduleWindow(cfg, new Date('2026-02-07T10:00:00Z'));
    expect(saturday.isOffHoursOrWeekend).toBe(true);
    expect(saturday.triggerReason).toBe('weekend');

    // Monday 2026-02-09 10:00 UTC -> operating hours
    const mondayDay = evaluateOffHoursScheduleWindow(cfg, new Date('2026-02-09T10:00:00Z'));
    expect(mondayDay.isOffHoursOrWeekend).toBe(false);
    expect(mondayDay.triggerReason).toBeNull();

    // Monday 2026-02-09 21:30 UTC -> weekday off-hours
    const mondayNight = evaluateOffHoursScheduleWindow(cfg, new Date('2026-02-09T21:30:00Z'));
    expect(mondayNight.isOffHoursOrWeekend).toBe(true);
    expect(mondayNight.triggerReason).toBe('off_hours');

    // Overnight shift 20:00 - 06:00: 22:00 is operating, 12:00 is off-hours
    const overnightCfg = { ...cfg, businessHoursStart: '20:00', businessHoursEnd: '06:00' };
    expect(
      evaluateOffHoursScheduleWindow(overnightCfg, new Date('2026-02-09T22:00:00Z'))
        .isOffHoursOrWeekend,
    ).toBe(false);
    expect(
      evaluateOffHoursScheduleWindow(overnightCfg, new Date('2026-02-09T12:00:00Z'))
        .isOffHoursOrWeekend,
    ).toBe(true);
  });

  it('checks item critical alert state across trigger modes', () => {
    const baseItem = { ...DEMO_INVENTORY[0], quantityOnHand: 250, minimumThreshold: 250 };
    expect(isItemInCriticalAlertState(baseItem, 'below_minimum')).toBe(false);
    expect(isItemInCriticalAlertState(baseItem, 'at_or_below_minimum')).toBe(true);
    expect(
      isItemInCriticalAlertState({ ...baseItem, quantityOnHand: 249 }, 'below_minimum'),
    ).toBe(true);
    expect(
      isItemInCriticalAlertState({ ...baseItem, quantityOnHand: 0, minimumThreshold: 0 }, 'below_minimum'),
    ).toBe(true);
  });
});
