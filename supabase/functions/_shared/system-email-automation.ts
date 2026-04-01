export type SystemEmailAutomationKey =
  | 'newsletter-confirmation'
  | 'newsletter-welcome'
  | 'newsletter-weekly-digest'
  | 'story-new-article-notification'

export type SystemEmailAutomationRow = {
  key: SystemEmailAutomationKey
  enabled: boolean
  config: Record<string, unknown>
  updated_at?: string
  last_run_at?: string | null
  last_sent_at?: string | null
}

export const DEFAULT_SYSTEM_EMAIL_AUTOMATIONS: Record<
  SystemEmailAutomationKey,
  SystemEmailAutomationRow
> = {
  'newsletter-confirmation': {
    key: 'newsletter-confirmation',
    enabled: true,
    config: {
      resend_cooldown_minutes: 15,
      token_ttl_hours: 72,
    },
    last_run_at: null,
    last_sent_at: null,
  },
  'newsletter-welcome': {
    key: 'newsletter-welcome',
    enabled: true,
    config: {},
    last_run_at: null,
    last_sent_at: null,
  },
  'newsletter-weekly-digest': {
    key: 'newsletter-weekly-digest',
    enabled: true,
    config: {
      timezone: 'Europe/Rome',
      weekday: 2,
      hour_local: 7,
      minute_local: 0,
    },
    last_run_at: null,
    last_sent_at: null,
  },
  'story-new-article-notification': {
    key: 'story-new-article-notification',
    enabled: true,
    config: {},
    last_run_at: null,
    last_sent_at: null,
  },
}

export function normalizeSystemEmailAutomation(
  row?: Partial<SystemEmailAutomationRow> | null,
  key?: SystemEmailAutomationKey
): SystemEmailAutomationRow {
  const resolvedKey = row?.key ?? key
  if (!resolvedKey) {
    throw new Error('Automation key is required')
  }

  const fallback = DEFAULT_SYSTEM_EMAIL_AUTOMATIONS[resolvedKey]
  return {
    key: resolvedKey,
    enabled:
      typeof row?.enabled === 'boolean' ? row.enabled : fallback.enabled,
    config:
      row?.config && typeof row.config === 'object' && !Array.isArray(row.config)
        ? { ...fallback.config, ...row.config }
        : fallback.config,
    updated_at: row?.updated_at,
    last_run_at:
      typeof row?.last_run_at === 'string' || row?.last_run_at === null
        ? row.last_run_at
        : fallback.last_run_at,
    last_sent_at:
      typeof row?.last_sent_at === 'string' || row?.last_sent_at === null
        ? row.last_sent_at
        : fallback.last_sent_at,
  }
}
