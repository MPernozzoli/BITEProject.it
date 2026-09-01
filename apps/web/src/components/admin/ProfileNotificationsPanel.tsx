import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { normalizeEngagementNotificationFrequency } from "@/lib/email-notification-preferences";
import type { ProfileCopy } from "@/lib/profile-copy";
import type { DEFAULT_PROFILE_NOTIFICATION_PREFERENCES } from "@/lib/email-notification-preferences";

type NotificationPreferences = typeof DEFAULT_PROFILE_NOTIFICATION_PREFERENCES;

/**
 * Card "Notifiche" del tab omonimo di `/profile`: frequenza like/commenti,
 * toggle articoli/storie e l'intera sezione push (installazione app + toggle).
 * Estratta da `ProfilePreferencesPanel` durante il ridisegno a tab.
 */
export interface ProfileNotificationsPanelProps {
  copy: ProfileCopy;
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
}

const ProfileNotificationsPanel = ({
  copy,
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
}: ProfileNotificationsPanelProps) => {
  return (
    <div className="rounded-[34px] border border-border/85 bg-glass/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
        {copy.sections.notificationsEyebrow}
      </p>
      <h2 className="editorial-heading text-2xl md:text-3xl mb-3">{copy.sections.notificationsTitle}</h2>
      <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">
        {copy.sections.notificationsText}
      </p>

      <div className="space-y-6">
        <div className="rounded-[24px] border border-glass-edge/60 bg-glass/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.063)]">
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
              <SelectTrigger className="h-11 rounded-2xl border-glass-edge/65 bg-glass/72 shadow-none focus:ring-1">
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

        <div className="rounded-[24px] border border-glass-edge/60 bg-glass/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.063)]">
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
              <SelectTrigger className="h-11 rounded-2xl border-glass-edge/65 bg-glass/72 shadow-none focus:ring-1">
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

        <div className="rounded-[24px] border border-glass-edge/60 bg-glass/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.063)]">
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

        <div className="rounded-[24px] border border-glass-edge/60 bg-glass/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.063)]">
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
          <div className="rounded-[24px] border border-glass-edge/60 bg-glass/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.063)]">
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
                <div className="rounded-[20px] border border-dashed border-glass-edge/70 bg-glass/72 p-4">
                  <p className="text-sm font-sans text-foreground">{copy.fields.pushNotInstalled}</p>
                  <p className="mt-2 text-sm font-sans text-muted-foreground leading-relaxed">
                    {pushInstallInstructions}
                  </p>
                </div>
              ) : !canUseWebPush ? (
                <div className="rounded-[20px] border border-dashed border-glass-edge/70 bg-glass/72 p-4">
                  <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                    {copy.fields.pushUnsupported}
                  </p>
                </div>
              ) : !pushPublicKey ? (
                <div className="rounded-[20px] border border-dashed border-glass-edge/70 bg-glass/72 p-4">
                  <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                    {copy.fields.pushMissingKey}
                  </p>
                </div>
              ) : (
                <div className="space-y-4 rounded-[20px] border border-glass-edge/70 bg-glass/72 p-4">
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
                        className="rounded-full border-glass-edge/70 bg-glass/80 hover:bg-glass"
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
                      className="rounded-full border-glass-edge/70 bg-glass/80 hover:bg-glass"
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
                    <div className="space-y-0 border-t border-foreground/6 pt-2">
                      {pushPreferenceRows.map((row, index) => (
                        <div
                          key={row.key}
                          className={cn(
                            "flex items-start justify-between gap-4 py-4",
                            index > 0 && "border-t border-foreground/6",
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
      </div>
    </div>
  );
};

export default ProfileNotificationsPanel;
