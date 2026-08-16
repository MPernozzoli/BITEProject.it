import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Fingerprint, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ALL_LANGUAGES, SITE_LANGUAGES } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { normalizeEngagementNotificationFrequency } from "@/lib/email-notification-preferences";
import type { ProfileCopy } from "@/lib/profile-copy";
import type { DEFAULT_PROFILE_NOTIFICATION_PREFERENCES } from "@/lib/email-notification-preferences";

type NotificationPreferences = typeof DEFAULT_PROFILE_NOTIFICATION_PREFERENCES;

export interface PasskeyListItem {
  id: string;
  friendly_name?: string | null;
  created_at?: string;
  last_used_at?: string;
}

/**
 * Card "Preferenze" di `/profile`: lingua, newsletter, notifiche email, Web Push,
 * passkey e installazione dell'app mobile.
 *
 * La superficie props è ampia (38) perché la pagina resta l'unica proprietaria dello
 * stato: è il costo di un'estrazione puramente presentazionale. Se un domani si volesse
 * ridurla, il passo giusto è spostare *lo stato* (push e passkey sono due gruppi
 * autonomi), non ri-accorpare la UI.
 */
export interface ProfilePreferencesPanelProps {
  copy: ProfileCopy;
  preferredLanguage: string;
  preferredLanguageLabel: string;
  secondaryLanguage: string | null;
  secondaryLanguageLabel: string;
  isSiteNative: boolean;
  handleLanguageChange: (value: string) => void;
  setSecondaryLanguage: Dispatch<SetStateAction<string | null>>;
  newsletterSubscribed: boolean;
  setNewsletterSubscribed: Dispatch<SetStateAction<boolean>>;
  articleNotificationsEnabled: boolean;
  setArticleNotificationsEnabled: Dispatch<SetStateAction<boolean>>;
  storyNotificationsEnabled: boolean;
  setStoryNotificationsEnabled: Dispatch<SetStateAction<boolean>>;
  notificationPreferences: NotificationPreferences;
  setNotificationPreferences: Dispatch<SetStateAction<NotificationPreferences>>;
  notificationFrequencyOptions: { value: string; label: string }[];
  canUseWebPush: boolean;
  hasPushSubscription: boolean;
  pushPermission: NotificationPermission | "unsupported";
  pushReady: boolean;
  pushStateLoading: boolean;
  pushPublicKey: string | undefined;
  pushPreferenceRows: {
    key: string;
    title: string;
    hint: string;
    checked: boolean;
    visible: boolean;
  }[];
  pushInstallInstructions: ReactNode;
  handleEnablePushNotifications: () => void;
  handleDisablePushNotifications: () => void;
  handlePushPreferenceChange: (key: string, checked: boolean) => void;
  isInstalledApp: boolean;
  shouldShowMobileAppCard: boolean;
  passkeys: PasskeyListItem[];
  passkeysLoading: boolean;
  registeringPasskey: boolean;
  removingPasskeyId: string | null;
  passkeyUnavailableMessage: string;
  handleRegisterPasskey: () => void;
  handleRemovePasskey: (id: string) => void;
  formatPasskeyDate: (value?: string) => string;
}

const ProfilePreferencesPanel = ({
  copy,
  preferredLanguage,
  preferredLanguageLabel,
  secondaryLanguage,
  secondaryLanguageLabel,
  isSiteNative,
  handleLanguageChange,
  setSecondaryLanguage,
  newsletterSubscribed,
  setNewsletterSubscribed,
  articleNotificationsEnabled,
  setArticleNotificationsEnabled,
  storyNotificationsEnabled,
  setStoryNotificationsEnabled,
  notificationPreferences,
  setNotificationPreferences,
  notificationFrequencyOptions,
  canUseWebPush,
  hasPushSubscription,
  pushPermission,
  pushReady,
  pushStateLoading,
  pushPublicKey,
  pushPreferenceRows,
  pushInstallInstructions,
  handleEnablePushNotifications,
  handleDisablePushNotifications,
  handlePushPreferenceChange,
  isInstalledApp,
  shouldShowMobileAppCard,
  passkeys,
  passkeysLoading,
  registeringPasskey,
  removingPasskeyId,
  passkeyUnavailableMessage,
  handleRegisterPasskey,
  handleRemovePasskey,
  formatPasskeyDate,
}: ProfilePreferencesPanelProps) => {
  return (
          <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
            <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
              {copy.sections.preferencesEyebrow}
            </p>
            <h2 className="editorial-heading text-2xl md:text-3xl mb-3">{copy.sections.preferencesTitle}</h2>
            <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">
              {copy.sections.preferencesText}
            </p>

            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                  {copy.fields.preferredLanguage}
                </label>
                <div className="flex flex-wrap gap-2">
                  {ALL_LANGUAGES.map((language) => (
                    <button
                      key={language.code}
                      type="button"
                      onClick={() => handleLanguageChange(language.code)}
                      className={cn(
                        "rounded-full border px-4 py-2.5 text-sm font-sans transition-all",
                        preferredLanguage === language.code
                          ? "border-accent/40 bg-accent/12 text-accent shadow-[0_8px_24px_rgba(52,120,127,0.12)]"
                          : "border-white/70 bg-white/68 text-muted-foreground hover:border-accent/30 hover:text-foreground",
                      )}
                    >
                      {language.label}
                    </button>
                  ))}
                </div>
              </div>

              {!isSiteNative && (
                <div className="space-y-3 rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                  <div className="space-y-2">
                    <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                      {copy.fields.secondaryLanguage}
                    </label>
                    <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                      {copy.fields.secondaryHint}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SITE_LANGUAGES.map((code) => {
                      const label = ALL_LANGUAGES.find((language) => language.code === code)?.label || code;
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setSecondaryLanguage(code)}
                          className={cn(
                            "rounded-full border px-4 py-2.5 text-sm font-sans transition-all",
                            secondaryLanguage === code
                              ? "border-accent/40 bg-accent/12 text-accent shadow-[0_8px_24px_rgba(52,120,127,0.12)]"
                              : "border-white/70 bg-white/68 text-muted-foreground hover:border-accent/30 hover:text-foreground",
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <p className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                        {copy.fields.passkeyTitle}
                      </p>
                      <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                        {copy.fields.passkeyHint}
                      </p>
                    </div>
                    <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/70 bg-background/75">
                      <Fingerprint size={16} className="text-accent" />
                    </div>
                  </div>

                  {passkeyUnavailableMessage ? (
                    <div className="rounded-[20px] border border-dashed border-white/70 bg-white/72 p-4">
                      <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                        {passkeyUnavailableMessage}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-3">
                        {passkeysLoading ? (
                          <div className="rounded-[20px] border border-dashed border-white/70 bg-white/52 px-4 py-5 text-sm font-sans text-muted-foreground">
                            {copy.loading}
                          </div>
                        ) : passkeys.length > 0 ? (
                          passkeys.map((passkey) => (
                            <div
                              key={passkey.id}
                              className="flex items-start justify-between gap-3 rounded-[20px] border border-white/60 bg-white/72 px-4 py-4"
                            >
                              <div className="min-w-0 space-y-1">
                                <p className="truncate text-sm font-sans font-medium text-foreground">
                                  {passkey.friendly_name || copy.fields.passkeyTitle}
                                </p>
                                <p className="text-xs font-sans text-muted-foreground">
                                  {copy.fields.passkeyCreatedAt}: {formatPasskeyDate(passkey.created_at)}
                                </p>
                                <p className="text-xs font-sans text-muted-foreground">
                                  {copy.fields.passkeyLastUsedAt}:{" "}
                                  {passkey.last_used_at
                                    ? formatPasskeyDate(passkey.last_used_at)
                                    : copy.fields.passkeyNeverUsed}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={removingPasskeyId === passkey.id}
                                className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => void handleRemovePasskey(passkey.id)}
                                title={copy.actions.removePasskey}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-[20px] border border-dashed border-white/70 bg-white/52 px-4 py-5 text-sm font-sans text-muted-foreground">
                            {copy.fields.passkeyEmpty}
                          </div>
                        )}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full border-white/70 bg-white/80 hover:bg-white"
                        disabled={registeringPasskey}
                        onClick={() => void handleRegisterPasskey()}
                      >
                        <Fingerprint size={14} />
                        {registeringPasskey ? copy.actions.addingPasskey : copy.actions.addPasskey}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                      {copy.fields.newsletterTitle}
                    </p>
                    <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                      {copy.fields.newsletterHint}
                    </p>
                  </div>
                  <Switch checked={newsletterSubscribed} onCheckedChange={setNewsletterSubscribed} />
                </div>
              </div>

              <div className="rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                <div className="space-y-3">
                  <p className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    {copy.fields.likeNotificationsTitle}
                  </p>
                  <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                    {copy.fields.likeNotificationsHint}
                  </p>
                  <Select
                    value={notificationPreferences.like_notifications_frequency}
                    onValueChange={(value) =>
                      setNotificationPreferences((current) => ({
                        ...current,
                        like_notifications_frequency: normalizeEngagementNotificationFrequency(value),
                      }))
                    }
                  >
                    <SelectTrigger className="h-11 rounded-2xl border-white/65 bg-white/72 shadow-none focus:ring-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {notificationFrequencyOptions.map((option) => (
                        <SelectItem key={`like-${option.value}`} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                <div className="space-y-3">
                  <p className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    {copy.fields.commentNotificationsTitle}
                  </p>
                  <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                    {copy.fields.commentNotificationsHint}
                  </p>
                  <Select
                    value={notificationPreferences.comment_notifications_frequency}
                    onValueChange={(value) =>
                      setNotificationPreferences((current) => ({
                        ...current,
                        comment_notifications_frequency: normalizeEngagementNotificationFrequency(value),
                      }))
                    }
                  >
                    <SelectTrigger className="h-11 rounded-2xl border-white/65 bg-white/72 shadow-none focus:ring-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {notificationFrequencyOptions.map((option) => (
                        <SelectItem key={`comment-${option.value}`} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                      {copy.fields.articleUpdatesTitle}
                    </p>
                    <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                      {copy.fields.articleUpdatesHint}
                    </p>
                  </div>
                  <Switch
                    checked={articleNotificationsEnabled}
                    onCheckedChange={setArticleNotificationsEnabled}
                  />
                </div>
              </div>

              <div className="rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                      {copy.fields.storyUpdatesTitle}
                    </p>
                    <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                      {copy.fields.storyUpdatesHint}
                    </p>
                  </div>
                  <Switch
                    checked={storyNotificationsEnabled}
                    onCheckedChange={setStoryNotificationsEnabled}
                  />
                </div>
              </div>

              {shouldShowMobileAppCard && (
                <div className="rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                  <div className="space-y-3">
                    <p className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                      {isInstalledApp ? copy.fields.pushConfiguredLabel : copy.fields.pushInstructionLabel}
                    </p>
                    <p className="text-sm font-sans text-foreground">
                      {copy.fields.pushTitle}
                    </p>
                    <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                      {copy.fields.pushHint}
                    </p>

                    {!isInstalledApp ? (
                      <div className="rounded-[20px] border border-dashed border-white/70 bg-white/72 p-4">
                        <p className="text-sm font-sans text-foreground">{copy.fields.pushNotInstalled}</p>
                        <p className="mt-2 text-sm font-sans text-muted-foreground leading-relaxed">
                          {pushInstallInstructions}
                        </p>
                      </div>
                    ) : !canUseWebPush ? (
                      <div className="rounded-[20px] border border-dashed border-white/70 bg-white/72 p-4">
                        <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                          {copy.fields.pushUnsupported}
                        </p>
                      </div>
                    ) : !pushPublicKey ? (
                      <div className="rounded-[20px] border border-dashed border-white/70 bg-white/72 p-4">
                        <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                          {copy.fields.pushMissingKey}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4 rounded-[20px] border border-white/70 bg-white/72 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <p className="text-sm font-sans font-medium text-foreground">
                              {pushReady ? copy.fields.pushEnabled : copy.fields.pushDisabled}
                            </p>
                            <p className="text-xs font-sans text-muted-foreground">
                              Permission: {pushPermission}
                            </p>
                          </div>
                          {pushReady ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-full border-white/70 bg-white/80 hover:bg-white"
                              disabled={pushStateLoading}
                              onClick={() => void handleDisablePushNotifications()}
                            >
                              {copy.fields.pushDisable}
                            </Button>
                          ) : null}
                        </div>

                        {pushPermission === "default" || !hasPushSubscription ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-full border-white/70 bg-white/80 hover:bg-white"
                            disabled={pushStateLoading}
                            onClick={() => void handleEnablePushNotifications()}
                          >
                            {pushStateLoading
                              ? copy.fields.pushSaving
                              : hasPushSubscription
                                ? copy.fields.pushReconnect
                                : copy.fields.pushEnable}
                          </Button>
                        ) : null}

                        {pushReady ? (
                          <div className="space-y-0 border-t border-black/6 pt-2">
                            {pushPreferenceRows.map((row, index) => (
                              <div
                                key={row.key}
                                className={cn(
                                  "flex items-start justify-between gap-4 py-4",
                                  index > 0 && "border-t border-black/6",
                                )}
                              >
                                <div className="space-y-1">
                                  <p className="text-sm font-sans font-medium text-foreground">{row.title}</p>
                                  <p className="text-xs font-sans text-muted-foreground leading-relaxed">{row.hint}</p>
                                </div>
                                <Switch
                                  checked={row.checked}
                                  disabled={pushStateLoading}
                                  onCheckedChange={(checked) => void handlePushPreferenceChange(row.key, checked)}
                                />
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {pushPermission === "denied" ? (
                          <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                            {copy.fields.pushDenied}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-[24px] border border-white/60 bg-white/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-background/75">
                    <UserRound size={16} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                      {copy.fields.preferredLanguage}
                    </p>
                    <p className="font-sans text-sm text-foreground mt-1">
                      {preferredLanguageLabel}
                      {!isSiteNative && (
                        <span className="text-muted-foreground"> · {secondaryLanguageLabel}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
  );
};

export default ProfilePreferencesPanel;
