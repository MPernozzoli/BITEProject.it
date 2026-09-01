import { Fingerprint, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProfileCopy } from "@/lib/profile-copy";

export interface PasskeyListItem {
  id: string;
  friendly_name?: string | null;
  created_at?: string;
  last_used_at?: string;
}

/**
 * Card "Sicurezza" del tab omonimo di `/profile`: gestione passkey.
 * Estratta da `ProfilePreferencesPanel` durante il ridisegno a tab.
 */
export interface ProfileSecurityPanelProps {
  copy: ProfileCopy;
  passkeys: PasskeyListItem[];
  passkeysLoading: boolean;
  registeringPasskey: boolean;
  removingPasskeyId: string | null;
  passkeyUnavailableMessage: string;
  handleRegisterPasskey: () => void;
  handleRemovePasskey: (id: string) => void;
  formatPasskeyDate: (value?: string) => string;
}

const ProfileSecurityPanel = ({
  copy,
  passkeys,
  passkeysLoading,
  registeringPasskey,
  removingPasskeyId,
  passkeyUnavailableMessage,
  handleRegisterPasskey,
  handleRemovePasskey,
  formatPasskeyDate,
}: ProfileSecurityPanelProps) => {
  return (
    <div className="rounded-[34px] border border-border/85 bg-glass/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
        {copy.sections.securityEyebrow}
      </p>
      <h2 className="editorial-heading text-2xl md:text-3xl mb-3">{copy.sections.securityTitle}</h2>
      <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">
        {copy.sections.securityText}
      </p>

      <div className="rounded-[24px] border border-glass-edge/60 bg-glass/68 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.063)]">
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
            <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-glass-edge/70 bg-background/75">
              <Fingerprint size={16} className="text-accent" />
            </div>
          </div>

          {passkeyUnavailableMessage ? (
            <div className="rounded-[20px] border border-dashed border-glass-edge/70 bg-glass/72 p-4">
              <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                {passkeyUnavailableMessage}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {passkeysLoading ? (
                  <div className="rounded-[20px] border border-dashed border-glass-edge/70 bg-glass/52 px-4 py-5 text-sm font-sans text-muted-foreground">
                    {copy.loading}
                  </div>
                ) : passkeys.length > 0 ? (
                  passkeys.map((passkey) => (
                    <div
                      key={passkey.id}
                      className="flex items-start justify-between gap-3 rounded-[20px] border border-glass-edge/60 bg-glass/72 px-4 py-4"
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
                  <div className="rounded-[20px] border border-dashed border-glass-edge/70 bg-glass/52 px-4 py-5 text-sm font-sans text-muted-foreground">
                    {copy.fields.passkeyEmpty}
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                className="rounded-full border-glass-edge/70 bg-glass/80 hover:bg-glass"
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
    </div>
  );
};

export default ProfileSecurityPanel;
