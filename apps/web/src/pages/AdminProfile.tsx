import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpen,
  Camera,
  Facebook,
  Fingerprint,
  Globe,
  Instagram,
  Languages,
  Linkedin,
  Link as LinkIcon,
  Mail,
  Save,
  Trash2,
  UserRound,
  X,
  Youtube,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import ProfileAvatar from "@/components/ProfileAvatar";
import AvatarCropDialog from "@/components/admin/AvatarCropDialog";
import SeaPeopleIcon from "@/components/SeaPeopleIcon";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { useBeforeUnloadPrompt } from "@/hooks/useBeforeUnloadPrompt";
import { ALL_LANGUAGES, SITE_LANGUAGES, useI18n, type ExtendedLanguage } from "@/lib/i18n";
import { invokeOptionalNewsletterFunction } from "@/lib/newsletter";
import {
  detectMobileOs,
  getExistingPushSubscription,
  getInstallInstructions,
  getPushPermission,
  isLikelyMobileDevice,
  isRunningAsInstalledApp,
  subscribeToPushNotifications,
  supportsWebPush,
  unsubscribeFromPushNotifications,
} from "@/lib/pwa";
import { isAuthFailureError } from "@/lib/supabase-auth";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PROFILE_NOTIFICATION_PREFERENCES,
  ENGAGEMENT_NOTIFICATION_FREQUENCIES,
  normalizeEngagementNotificationFrequency,
} from "@/lib/email-notification-preferences";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TikTokIcon = ({ size = 16, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
  </svg>
);

const XIcon = ({ size = 16, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

type SocialFieldKey =
  | "social_instagram"
  | "social_youtube"
  | "social_tiktok"
  | "social_facebook"
  | "social_x"
  | "social_linkedin"
  | "social_website"
  | "social_seapeople";

type StorySubscriptionRow = {
  id: string;
  story_id: string;
  stories: {
    title_it: string;
    title_en: string;
    slug: string;
  } | null;
};

type PasskeyItem = {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
};

type ProfileSnapshot = {
  name: string;
  bio: string;
  avatarUrl: string;
  preferredLanguage: ExtendedLanguage;
  secondaryLanguage: string | null;
  newsletterSubscribed: boolean;
  articleNotificationsEnabled: boolean;
  storyNotificationsEnabled: boolean;
  socials: Record<SocialFieldKey, string>;
  notificationPreferences: typeof DEFAULT_PROFILE_NOTIFICATION_PREFERENCES;
};

const createProfileSnapshot = (snapshot: ProfileSnapshot) =>
  JSON.stringify({
    ...snapshot,
    socials: Object.fromEntries(Object.entries(snapshot.socials)),
  });

const COPY = {
  it: {
    loading: "Caricamento...",
    title: "Il mio profilo",
    subtitle:
      "Gestisci identita, preferenze e presenza pubblica con lo stesso linguaggio visivo del resto del sito.",
    badge: "Area personale",
    previewTitle: "Come appari alla community",
    previewText:
      "Nome, avatar, bio e link vengono riutilizzati nei commenti, nelle firme autore e nella scheda pubblica.",
    changePhoto: "Cambia foto",
    photoHint: "PNG o JPG. Puoi ritagliare l'immagine prima di salvarla.",
    viewPublicProfile: "Apri profilo pubblico",
    stats: {
      primaryLanguage: "Lingua principale",
      storySubscriptions: "Storie seguite",
      socialLinks: "Link attivi",
      newsletter: "Newsletter",
    },
    sections: {
      identityEyebrow: "Identita",
      identityTitle: "Nome, bio e riconoscibilita",
      identityText: "Aggiorna le informazioni che compaiono nella tua presenza pubblica.",
      preferencesEyebrow: "Preferenze",
      preferencesTitle: "Lingua e comunicazioni",
      preferencesText: "Definisci lingua madre, fallback del sito e aggiornamenti email.",
      socialsEyebrow: "Dove ti si trova",
      socialsTitle: "Social e link esterni",
      socialsText: "Aggiungi solo i riferimenti che vuoi mostrare davvero nella scheda pubblica.",
      subscriptionsEyebrow: "Follow",
      subscriptionsTitle: "Storie che stai seguendo",
      subscriptionsText: "Qui trovi le iscrizioni attive ai thread narrativi del progetto.",
      saveEyebrow: "Salvataggio",
      saveTitle: "Pubblica le modifiche del profilo",
      saveText: "Le modifiche restano locali finche non salvi. Avatar incluso.",
    },
    fields: {
      name: "Nome visibile",
      email: "Email account",
      bio: "Bio",
      bioPlaceholder: "Racconta chi sei, cosa fai e cosa porti a bordo.",
      preferredLanguage: "Lingua preferita",
      secondaryLanguage: "Lingua dei contenuti del sito",
      secondaryHint:
        "Il sito e disponibile solo in italiano e inglese. Seleziona il fallback da usare per i contenuti.",
      newsletterTitle: "Aggiornamenti editoriali via email",
      newsletterHint:
        "Attiva per ricevere nuovi articoli, digest e comunicazioni del progetto nella tua casella.",
      likeNotificationsTitle: "Notifiche like",
      likeNotificationsHint:
        "Scegli se ricevere una mail per ogni like o un riepilogo periodico dei like ricevuti su articoli e commenti.",
      commentNotificationsTitle: "Notifiche commenti",
      commentNotificationsHint:
        "Scegli la frequenza per nuovi commenti ai tuoi articoli e risposte ai tuoi commenti.",
      articleUpdatesTitle: "Nuovi articoli",
      articleUpdatesHint:
        "Ricevi notifiche nel sito e push per i nuovi articoli standalone pubblicati su BITE.",
      storyUpdatesTitle: "Storie che segui",
      storyUpdatesHint:
        "Ricevi notifiche nel sito e push quando una storia che segui pubblica un nuovo capitolo.",
      pushTitle: "Notifiche push",
      pushHint:
        "Quando usi BITE come web app sulla home del telefono puoi scegliere quali notifiche ricevere in tempo reale.",
      pushEngagementTitle: "Community",
      pushEngagementHint: "Like, commenti e risposte legate ai tuoi contenuti.",
      pushPublicationTitle: "Nuove pubblicazioni",
      pushPublicationHint: "Articoli standalone e nuovi capitoli nelle storie seguite.",
      pushMailTitle: "Nuove mail",
      pushMailHint: "Messaggi ricevuti nella casella admin e assegnazioni inbound.",
      pushVoyageAdminTitle: "Viaggi da gestire",
      pushVoyageAdminHint: "Richieste, modifiche, cancellazioni e pagamenti dei partecipanti.",
      pushVoyageUserTitle: "I miei viaggi",
      pushVoyageUserHint: "Approvazioni, conferme, pagamenti e cambi planning delle tue prenotazioni.",
      pushNotInstalled:
        "Per attivare le push devi prima salvare BITE sulla schermata Home del telefono.",
      pushUnsupported:
        "Questo dispositivo o browser non supporta ancora le notifiche push web in questo contesto.",
      pushDenied:
        "Le notifiche push sono bloccate. Riattivale dalle impostazioni del browser o dell'app installata.",
      pushRegistrationError:
        "Permesso notifiche attivo, ma non riesco a registrare questo dispositivo. Riprova dopo aver chiuso e riaperto l'app.",
      pushEnable: "Attiva notifiche push",
      pushReconnect: "Ricollega notifiche push",
      pushEnabled: "Push attive",
      pushDisabled: "Push disattivate",
      pushDisable: "Disattiva push",
      pushSaving: "Aggiornamento...",
      pushInstructionLabel: "Come installare l'app",
      pushConfiguredLabel: "Gestione push app",
      pushMissingKey:
        "Configurazione push non completata sul progetto. Manca la chiave pubblica VAPID lato client.",
      passkeyTitle: "Passkey",
      passkeyHint:
        "Aggiungi una passkey per accedere senza codice email, usando Face ID, Touch ID, PIN del dispositivo o una chiave di sicurezza.",
      passkeyUnsupported:
        "Questo browser o dispositivo non supporta ancora le passkey.",
      passkeyInsecure:
        "Le passkey richiedono HTTPS, tranne su localhost.",
      passkeyEmpty:
        "Nessuna passkey registrata per questo account.",
      passkeyCreatedAt: "Creata",
      passkeyLastUsedAt: "Ultimo uso",
      passkeyNeverUsed: "Mai usata",
    },
    newsletter: {
      on: "Iscritta",
      off: "Non iscritta",
    },
    notificationFrequency: {
      instant: "Una mail per ognuno",
      daily: "Recap giornaliero",
      weekly: "Recap settimanale",
      monthly: "Recap mensile",
      none: "Nessuna notifica",
    },
    subscription: {
      empty: "Non stai seguendo nessuna storia al momento.",
      remove: "Rimuovi",
      removed: "Iscrizione rimossa.",
      removeError: "Impossibile aggiornare le iscrizioni alle storie.",
    },
    actions: {
      save: "Salva modifiche",
      saving: "Salvataggio...",
      saveAndExit: "Salva ed esci",
      leaveWithoutSaving: "Esci senza salvare",
      stayHere: "Resta qui",
      upload: "Upload...",
      avatarReady: "Foto profilo pronta. Salva il profilo per pubblicarla.",
      avatarError: "Impossibile caricare la foto profilo.",
      invalidImage: "Seleziona un file immagine valido.",
      saveSuccess: "Profilo aggiornato.",
      saveError: "Impossibile salvare il profilo.",
      dirtyBadge: "Modifiche non salvate",
      addPasskey: "Aggiungi passkey",
      addingPasskey: "Aggiunta...",
      passkeyAdded: "Passkey aggiunta.",
      passkeyRemoved: "Passkey rimossa.",
      passkeyError: "Impossibile aggiornare le passkey.",
      passkeyCancelled: "Operazione passkey annullata.",
      passkeyDisabled:
        "Le passkey non risultano abilitate nella configurazione Auth di Supabase.",
      passkeyConfigError:
        "Configurazione WebAuthn non valida per questo dominio. Controlla Relying Party ID e Relying Party Origins in Supabase.",
      removePasskey: "Rimuovi passkey",
    },
    prompt: {
      title: "Hai modifiche non salvate",
      text: "Se lasci questa pagina adesso perdi le modifiche al profilo. Puoi uscire senza salvare oppure salvare prima di continuare.",
    },
    misc: {
      noSecondaryLanguage: "Nessuna",
    },
  },
  en: {
    loading: "Loading...",
    title: "My profile",
    subtitle:
      "Manage identity, preferences, and public presence using the same visual system as the rest of the site.",
    badge: "Personal area",
    previewTitle: "How you appear to the community",
    previewText:
      "Name, avatar, bio, and links are reused across comments, author signatures, and the public profile card.",
    changePhoto: "Change photo",
    photoHint: "PNG or JPG. You can crop the image before saving.",
    viewPublicProfile: "Open public profile",
    stats: {
      primaryLanguage: "Primary language",
      storySubscriptions: "Followed stories",
      socialLinks: "Active links",
      newsletter: "Newsletter",
    },
    sections: {
      identityEyebrow: "Identity",
      identityTitle: "Name, bio, and recognizability",
      identityText: "Update the details that show up in your public presence.",
      preferencesEyebrow: "Preferences",
      preferencesTitle: "Language and communications",
      preferencesText: "Set native language, site fallback, and email updates.",
      socialsEyebrow: "Where to find you",
      socialsTitle: "Social and external links",
      socialsText: "Add only the references you actually want to expose on your public card.",
      subscriptionsEyebrow: "Following",
      subscriptionsTitle: "Stories you are following",
      subscriptionsText: "Your active subscriptions to the narrative threads of the project live here.",
      saveEyebrow: "Save",
      saveTitle: "Publish profile changes",
      saveText: "Changes stay local until you save them. Avatar included.",
    },
    fields: {
      name: "Display name",
      email: "Account email",
      bio: "Bio",
      bioPlaceholder: "Tell people who you are, what you do, and what you bring aboard.",
      preferredLanguage: "Preferred language",
      secondaryLanguage: "Site content language",
      secondaryHint:
        "The site is only available in Italian and English. Select the fallback language for editorial content.",
      newsletterTitle: "Editorial updates by email",
      newsletterHint:
        "Enable this to receive new articles, digests, and project updates in your inbox.",
      likeNotificationsTitle: "Like notifications",
      likeNotificationsHint:
        "Choose whether to receive one email per like or a periodic summary for likes on your articles and comments.",
      commentNotificationsTitle: "Comment notifications",
      commentNotificationsHint:
        "Choose the delivery cadence for new comments on your articles and replies to your comments.",
      articleUpdatesTitle: "New articles",
      articleUpdatesHint:
        "Receive in-app notifications and push alerts for new standalone articles published on BITE.",
      storyUpdatesTitle: "Followed stories",
      storyUpdatesHint:
        "Receive in-app notifications and push alerts when a story you follow publishes a new chapter.",
      pushTitle: "Push notifications",
      pushHint:
        "When you use BITE as a web app from your phone home screen, you can choose which real-time push notifications you receive.",
      pushEngagementTitle: "Community",
      pushEngagementHint: "Likes, comments, and replies tied to your content.",
      pushPublicationTitle: "New publications",
      pushPublicationHint: "Standalone articles and new chapters in followed stories.",
      pushMailTitle: "New mail",
      pushMailHint: "Messages received in the admin mailbox and inbound assignments.",
      pushVoyageAdminTitle: "Voyages to manage",
      pushVoyageAdminHint: "Requests, changes, cancellations, and participant payments.",
      pushVoyageUserTitle: "My voyages",
      pushVoyageUserHint: "Approvals, confirmations, payments, and plan changes for your bookings.",
      pushNotInstalled:
        "To enable push notifications you first need to save BITE to your phone home screen.",
      pushUnsupported:
        "This device or browser does not currently support web push in this context.",
      pushDenied:
        "Push notifications are blocked. Re-enable them from your browser or installed app settings.",
      pushRegistrationError:
        "Notifications are allowed, but this device could not be registered. Close and reopen the app, then try again.",
      pushEnable: "Enable push notifications",
      pushReconnect: "Reconnect push notifications",
      pushEnabled: "Push enabled",
      pushDisabled: "Push disabled",
      pushDisable: "Disable push",
      pushSaving: "Updating...",
      pushInstructionLabel: "How to install the app",
      pushConfiguredLabel: "App push controls",
      pushMissingKey:
        "Push is not fully configured for this project yet. The public VAPID key is missing on the client.",
      passkeyTitle: "Passkeys",
      passkeyHint:
        "Add a passkey to sign in without an email code, using Face ID, Touch ID, your device PIN, or a security key.",
      passkeyUnsupported:
        "This browser or device does not support passkeys yet.",
      passkeyInsecure:
        "Passkeys require HTTPS, except on localhost.",
      passkeyEmpty:
        "No passkeys registered for this account.",
      passkeyCreatedAt: "Created",
      passkeyLastUsedAt: "Last used",
      passkeyNeverUsed: "Never used",
    },
    newsletter: {
      on: "Subscribed",
      off: "Off",
    },
    notificationFrequency: {
      instant: "One email each",
      daily: "Daily digest",
      weekly: "Weekly digest",
      monthly: "Monthly digest",
      none: "No notifications",
    },
    subscription: {
      empty: "You are not following any stories right now.",
      remove: "Remove",
      removed: "Subscription removed.",
      removeError: "Unable to update story subscriptions.",
    },
    actions: {
      save: "Save changes",
      saving: "Saving...",
      saveAndExit: "Save and leave",
      leaveWithoutSaving: "Leave without saving",
      stayHere: "Stay here",
      upload: "Upload...",
      avatarReady: "Profile photo ready. Save the profile to publish it.",
      avatarError: "Unable to upload the profile photo.",
      invalidImage: "Select a valid image file.",
      saveSuccess: "Profile updated.",
      saveError: "Unable to save the profile.",
      dirtyBadge: "Unsaved changes",
      addPasskey: "Add passkey",
      addingPasskey: "Adding...",
      passkeyAdded: "Passkey added.",
      passkeyRemoved: "Passkey removed.",
      passkeyError: "Unable to update passkeys.",
      passkeyCancelled: "Passkey operation cancelled.",
      passkeyDisabled:
        "Passkeys do not appear to be enabled in Supabase Auth configuration.",
      passkeyConfigError:
        "Invalid WebAuthn configuration for this domain. Check Relying Party ID and Relying Party Origins in Supabase.",
      removePasskey: "Remove passkey",
    },
    prompt: {
      title: "You have unsaved changes",
      text: "If you leave this page now you will lose your profile edits. You can leave without saving or save before continuing.",
    },
    misc: {
      noSecondaryLanguage: "None",
    },
  },
} as const;

const AdminProfile = () => {
  const { session, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const initialSnapshotRef = useRef<string>("");
  const pendingNavigationRef = useRef<{ type: "path"; to: string } | { type: "back" } | null>(null);
  const ignoreNextPopRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [newsletterSubscribed, setNewsletterSubscribed] = useState(false);
  const [loadedNewsletterSubscribed, setLoadedNewsletterSubscribed] = useState(false);
  const [articleNotificationsEnabled, setArticleNotificationsEnabled] = useState(true);
  const [storyNotificationsEnabled, setStoryNotificationsEnabled] = useState(true);
  const [notificationPreferences, setNotificationPreferences] = useState(
    DEFAULT_PROFILE_NOTIFICATION_PREFERENCES,
  );
  const [pushEngagementEnabled, setPushEngagementEnabled] = useState(true);
  const [pushPublicationEnabled, setPushPublicationEnabled] = useState(true);
  const [pushMailEnabled, setPushMailEnabled] = useState(true);
  const [pushVoyageAdminEnabled, setPushVoyageAdminEnabled] = useState(true);
  const [pushVoyageUserEnabled, setPushVoyageUserEnabled] = useState(true);
  const [hasVoyageNotificationScope, setHasVoyageNotificationScope] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [hasPushSubscription, setHasPushSubscription] = useState(false);
  const [pushStateLoading, setPushStateLoading] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState<ExtendedLanguage>("it");
  const [secondaryLanguage, setSecondaryLanguage] = useState<string | null>(null);
  const [storySubscriptions, setStorySubscriptions] = useState<
    Array<{ id: string; story_id: string; story: { title_it: string; title_en: string; slug: string } }>
  >([]);
  const [removingStoryId, setRemovingStoryId] = useState<string | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [saveAndLeavePending, setSaveAndLeavePending] = useState(false);
  const [socials, setSocials] = useState<Record<SocialFieldKey, string>>({
    social_instagram: "",
    social_youtube: "",
    social_tiktok: "",
    social_facebook: "",
    social_x: "",
    social_linkedin: "",
    social_website: "",
    social_seapeople: "",
  });
  const { lang } = useI18n();
  const isMobile = useIsMobile();
  const mobileOs = detectMobileOs();
  const shouldShowMobileAppCard = isMobile || isLikelyMobileDevice();
  const isInstalledApp = isRunningAsInstalledApp();
  const canUseWebPush = supportsWebPush();
  const supportsPasskeys = typeof window !== "undefined" && Boolean(window.PublicKeyCredential);
  const isPasskeySecureContext = typeof window !== "undefined" && window.isSecureContext;
  const pushInstallInstructions = getInstallInstructions(mobileOs, lang === "en" ? "en" : "it");
  const [pushPublicKey, setPushPublicKey] = useState<string | undefined>(
    (import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined) || undefined
  );

  useEffect(() => {
    if (pushPublicKey) return;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    if (!supabaseUrl) return;
    fetch(`${supabaseUrl}/functions/v1/vapid-public-key`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.publicKey) setPushPublicKey(data.publicKey);
      })
      .catch(() => {});
  }, [pushPublicKey]);

  const copy = COPY[lang === "en" ? "en" : "it"];
  const passkeyUnavailableMessage = !supportsPasskeys
    ? copy.fields.passkeyUnsupported
    : !isPasskeySecureContext
      ? copy.fields.passkeyInsecure
      : "";
  const isSiteNative = SITE_LANGUAGES.includes(preferredLanguage as "it" | "en");
  const activeSocialCount = Object.values(socials).filter((value) => value.trim()).length;
  const preferredLanguageLabel =
    ALL_LANGUAGES.find((language) => language.code === preferredLanguage)?.label ?? preferredLanguage;
  const secondaryLanguageLabel = secondaryLanguage
    ? ALL_LANGUAGES.find((language) => language.code === secondaryLanguage)?.label ?? secondaryLanguage
    : copy.misc.noSecondaryLanguage;
  const currentSnapshot = createProfileSnapshot({
    name,
    bio,
    avatarUrl,
    preferredLanguage,
    secondaryLanguage: isSiteNative ? null : secondaryLanguage,
    newsletterSubscribed,
    articleNotificationsEnabled,
    storyNotificationsEnabled,
    socials,
    notificationPreferences,
  });
  const isDirty = profileLoaded && currentSnapshot !== initialSnapshotRef.current;

  const formatPasskeyDate = useCallback((value?: string) => {
    if (!value) return "";
    return new Intl.DateTimeFormat(lang === "en" ? "en" : "it", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  }, [lang]);

  const socialFields: Array<{
    key: SocialFieldKey;
    label: string;
    placeholder: string;
    icon: JSX.Element;
  }> = [
    { key: "social_instagram", label: "Instagram", placeholder: "@username", icon: <Instagram size={16} className="text-accent" /> },
    { key: "social_youtube", label: "YouTube", placeholder: "@channel", icon: <Youtube size={16} className="text-accent" /> },
    { key: "social_tiktok", label: "TikTok", placeholder: "@username", icon: <TikTokIcon size={16} className="text-accent" /> },
    { key: "social_facebook", label: "Facebook", placeholder: lang === "en" ? "page or profile" : "pagina o profilo", icon: <Facebook size={16} className="text-accent" /> },
    { key: "social_x", label: "X", placeholder: "@username", icon: <XIcon size={16} className="text-accent" /> },
    { key: "social_linkedin", label: "LinkedIn", placeholder: "username", icon: <Linkedin size={16} className="text-accent" /> },
    { key: "social_website", label: lang === "en" ? "Website" : "Sito web", placeholder: "https://example.com", icon: <Globe size={16} className="text-accent" /> },
    { key: "social_seapeople", label: "SeaPeople", placeholder: lang === "en" ? "profile link or slug" : "link profilo o slug", icon: <SeaPeopleIcon size={16} className="text-accent" /> },
  ];

  const stats = [
    { label: copy.stats.primaryLanguage, value: preferredLanguageLabel, icon: Languages },
    { label: copy.stats.storySubscriptions, value: String(storySubscriptions.length).padStart(2, "0"), icon: BookOpen },
    { label: copy.stats.socialLinks, value: String(activeSocialCount).padStart(2, "0"), icon: LinkIcon },
    { label: copy.stats.newsletter, value: newsletterSubscribed ? copy.newsletter.on : copy.newsletter.off, icon: Mail },
  ];
  const notificationFrequencyOptions = ENGAGEMENT_NOTIFICATION_FREQUENCIES.map((value) => ({
    value,
    label: copy.notificationFrequency[value],
  }));

  const loadNewsletterState = useCallback(
    async (userId: string, currentEmail: string) => {
      const { data: newsletterState, error: newsletterError } = await invokeOptionalNewsletterFunction<{
        subscribed?: boolean;
      }>(
        supabase.functions.invoke.bind(supabase.functions),
        "my-newsletter-subscription",
        {},
      );

      if (!newsletterError) {
        const nextSubscribed = Boolean(newsletterState?.subscribed);
        setNewsletterSubscribed(nextSubscribed);
        setLoadedNewsletterSubscribed(nextSubscribed);
        return nextSubscribed;
      }

      console.error("Newsletter subscription load via function failed:", newsletterError);

      const normalizedEmail = currentEmail.trim().toLowerCase();
      const newsletterQuery = supabase.from("newsletter_subscribers").select("subscribed");
      const { data: fallbackSubscription, error: fallbackError } = await (normalizedEmail
        ? newsletterQuery.or(`profile_id.eq.${userId},email.eq.${normalizedEmail}`)
        : newsletterQuery.eq("profile_id", userId))
        .maybeSingle();

      if (fallbackError) {
        console.error("Newsletter subscription fallback load error:", fallbackError);
        return false;
      }

      const nextSubscribed = Boolean(fallbackSubscription?.subscribed);
      setNewsletterSubscribed(nextSubscribed);
      setLoadedNewsletterSubscribed(nextSubscribed);
      return nextSubscribed;
    },
    [],
  );

  const syncNewsletterPreference = useCallback(
    async (userId: string, currentEmail: string, subscribed: boolean) => {
      const normalizedEmail = currentEmail.trim().toLowerCase();

      const { error: ownSubscriptionError } = await invokeOptionalNewsletterFunction(
        supabase.functions.invoke.bind(supabase.functions),
        "my-newsletter-subscription",
        {
          subscribed,
          source: "profile",
        },
      );

      if (!ownSubscriptionError) {
        return { backendHandled: true };
      }

      console.error("Newsletter sync via my-newsletter-subscription failed:", ownSubscriptionError);

      if (subscribed) {
        const { error: legacySubscribeError } = await supabase.functions.invoke("newsletter-subscribe", {
          body: {
            email: normalizedEmail,
            consent: true,
            source: "profile",
            preferredLanguage,
          },
        });

        if (!legacySubscribeError) {
          return { backendHandled: true };
        }

        console.error("Newsletter sync via newsletter-subscribe failed:", legacySubscribeError);
      }

      const subscriptionQuery = supabase.from("newsletter_subscribers").select("id");
      const { data: existingSub, error: existingSubError } = await (normalizedEmail
        ? subscriptionQuery.or(`profile_id.eq.${userId},email.eq.${normalizedEmail}`)
        : subscriptionQuery.eq("profile_id", userId))
        .maybeSingle();

      if (existingSubError) {
        throw existingSubError;
      }

      if (subscribed) {
        const mutation = existingSub?.id
          ? supabase
              .from("newsletter_subscribers")
              .update({
                profile_id: userId,
                email: normalizedEmail,
                subscribed: true,
              })
              .eq("id", existingSub.id)
          : supabase.from("newsletter_subscribers").insert({
              profile_id: userId,
              email: normalizedEmail,
              subscribed: true,
            });

        const { error: subscribeError } = await mutation;

        if (subscribeError) {
          throw subscribeError;
        }

        return { backendHandled: false };
      }

      if (existingSub?.id) {
        const { error: subscriberError } = await supabase
          .from("newsletter_subscribers")
          .update({
            profile_id: userId,
            email: normalizedEmail,
            subscribed: false,
          })
          .eq("id", existingSub.id);

        if (subscriberError) {
          throw subscriberError;
        }
      }

      return { backendHandled: false };
    },
    [preferredLanguage],
  );

  const savePushSubscription = useCallback(
    async (subscription: PushSubscription) => {
      if (!session?.user) return;

      const payload = subscription.toJSON();
      const endpoint = payload.endpoint;
      const p256dh = payload.keys?.p256dh;
      const auth = payload.keys?.auth;

      if (!endpoint || !p256dh || !auth) {
        throw new Error("Push subscription keys are incomplete.");
      }

      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          profile_id: session.user.id,
          endpoint,
          p256dh,
          auth,
          expiration_time:
            typeof payload.expirationTime === "number"
              ? new Date(payload.expirationTime).toISOString()
              : null,
          user_agent: navigator.userAgent,
          enabled: true,
          updated_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );

      if (error) {
        throw error;
      }
    },
    [session?.user],
  );

  const loadPushState = useCallback(async () => {
    setPushPermission(getPushPermission());

    if (!canUseWebPush) {
      setHasPushSubscription(false);
      return false;
    }

    try {
      const subscription = await getExistingPushSubscription();
      const hasSubscription = Boolean(subscription);
      setHasPushSubscription(hasSubscription);

      if (subscription && session?.user) {
        try {
          await savePushSubscription(subscription);
        } catch (error) {
          console.error("Push subscription sync error:", error);
        }
      }

      return hasSubscription;
    } catch (error) {
      console.error("Push subscription load error:", error);
      setHasPushSubscription(false);
      return false;
    }
  }, [canUseWebPush, savePushSubscription, session?.user]);

  const persistNotificationSettings = useCallback(
    async (updates: {
      pushEngagementEnabled?: boolean;
      pushPublicationEnabled?: boolean;
      pushMailEnabled?: boolean;
      pushVoyageAdminEnabled?: boolean;
      pushVoyageUserEnabled?: boolean;
      articleNotificationsEnabled?: boolean;
      storyNotificationsEnabled?: boolean;
    }) => {
      if (!session?.user?.email) return;

      const normalizedEmail = session.user.email.trim().toLowerCase();
      const { data: currentPreferenceRow, error: currentPreferenceError } = await supabase
        .from("email_notification_preferences")
        .select(
          "newsletter_enabled, digest_enabled, article_notifications_enabled, story_notifications_enabled, like_notifications_frequency, comment_notifications_frequency, push_engagement_enabled, push_publication_enabled, push_mail_enabled, push_voyage_admin_enabled, push_voyage_user_enabled",
        )
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (currentPreferenceError) {
        console.error("Push preference baseline load error:", currentPreferenceError);
      }

      const { error } = await supabase.from("email_notification_preferences").upsert({
        email: normalizedEmail,
        newsletter_enabled: currentPreferenceRow?.newsletter_enabled ?? newsletterSubscribed,
        digest_enabled: currentPreferenceRow?.digest_enabled ?? newsletterSubscribed,
        article_notifications_enabled:
          updates.articleNotificationsEnabled
          ?? currentPreferenceRow?.article_notifications_enabled
          ?? articleNotificationsEnabled,
        story_notifications_enabled:
          updates.storyNotificationsEnabled
          ?? currentPreferenceRow?.story_notifications_enabled
          ?? storyNotificationsEnabled,
        like_notifications_frequency:
          currentPreferenceRow?.like_notifications_frequency
          ?? notificationPreferences.like_notifications_frequency,
        comment_notifications_frequency:
          currentPreferenceRow?.comment_notifications_frequency
          ?? notificationPreferences.comment_notifications_frequency,
        push_engagement_enabled:
          updates.pushEngagementEnabled
          ?? currentPreferenceRow?.push_engagement_enabled
          ?? pushEngagementEnabled,
        push_publication_enabled:
          updates.pushPublicationEnabled
          ?? currentPreferenceRow?.push_publication_enabled
          ?? pushPublicationEnabled,
        push_mail_enabled:
          updates.pushMailEnabled
          ?? currentPreferenceRow?.push_mail_enabled
          ?? pushMailEnabled,
        push_voyage_admin_enabled:
          updates.pushVoyageAdminEnabled
          ?? currentPreferenceRow?.push_voyage_admin_enabled
          ?? pushVoyageAdminEnabled,
        push_voyage_user_enabled:
          updates.pushVoyageUserEnabled
          ?? currentPreferenceRow?.push_voyage_user_enabled
          ?? pushVoyageUserEnabled,
        updated_at: new Date().toISOString(),
      });

      if (error) {
        throw error;
      }
    },
    [
      articleNotificationsEnabled,
      newsletterSubscribed,
      notificationPreferences.comment_notifications_frequency,
      notificationPreferences.like_notifications_frequency,
      pushEngagementEnabled,
      pushMailEnabled,
      pushPublicationEnabled,
      pushVoyageAdminEnabled,
      pushVoyageUserEnabled,
      session?.user?.email,
      storyNotificationsEnabled,
    ],
  );

  const removePushSubscriptionRecord = useCallback(async () => {
    const subscription = await getExistingPushSubscription();
    if (!subscription) return;

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", subscription.endpoint);

    if (error) {
      console.error("Push subscription delete error:", error);
    }
  }, []);

  const handleEnablePushNotifications = useCallback(async () => {
    if (!pushPublicKey) {
      toast.error(copy.fields.pushMissingKey);
      return;
    }

    setPushStateLoading(true);
    try {
      const subscription = await subscribeToPushNotifications(pushPublicKey);
      await savePushSubscription(subscription);
      await persistNotificationSettings({
        pushEngagementEnabled: true,
        pushPublicationEnabled: true,
        pushMailEnabled: isAdmin ? true : undefined,
        pushVoyageAdminEnabled: isAdmin ? true : undefined,
        pushVoyageUserEnabled: hasVoyageNotificationScope ? true : undefined,
      });
      setPushPermission(getPushPermission());
      setHasPushSubscription(true);
      setPushEngagementEnabled(true);
      setPushPublicationEnabled(true);
      if (isAdmin) {
        setPushMailEnabled(true);
        setPushVoyageAdminEnabled(true);
      }
      if (hasVoyageNotificationScope) setPushVoyageUserEnabled(true);
      toast.success(copy.fields.pushEnabled);
    } catch (error) {
      console.error("Push enable error:", error);
      const nextPermission = getPushPermission();
      setPushPermission(nextPermission);
      toast.error(nextPermission === "denied" ? copy.fields.pushDenied : copy.fields.pushRegistrationError);
    } finally {
      setPushStateLoading(false);
    }
  }, [copy.fields.pushDenied, copy.fields.pushEnabled, copy.fields.pushMissingKey, copy.fields.pushRegistrationError, hasVoyageNotificationScope, isAdmin, persistNotificationSettings, pushPublicKey, savePushSubscription]);

  const handleDisablePushNotifications = useCallback(async () => {
    setPushStateLoading(true);
    try {
      await unsubscribeFromPushNotifications();
      await removePushSubscriptionRecord();
      await persistNotificationSettings({
        pushEngagementEnabled: false,
        pushPublicationEnabled: false,
        pushMailEnabled: false,
        pushVoyageAdminEnabled: false,
        pushVoyageUserEnabled: false,
      });
      setHasPushSubscription(false);
      setPushPermission(getPushPermission());
      setPushEngagementEnabled(false);
      setPushPublicationEnabled(false);
      setPushMailEnabled(false);
      setPushVoyageAdminEnabled(false);
      setPushVoyageUserEnabled(false);
      toast.success(copy.fields.pushDisabled);
    } catch (error) {
      console.error("Push disable error:", error);
      toast.error(copy.actions.saveError);
    } finally {
      setPushStateLoading(false);
    }
  }, [copy.actions.saveError, copy.fields.pushDisabled, persistNotificationSettings, removePushSubscriptionRecord]);

  const pushReady = hasPushSubscription && pushPermission === "granted";
  const handlePushPreferenceChange = useCallback(
    async (
      key:
        | "pushEngagementEnabled"
        | "pushPublicationEnabled"
        | "pushMailEnabled"
        | "pushVoyageAdminEnabled"
        | "pushVoyageUserEnabled",
      checked: boolean,
    ) => {
      setPushStateLoading(true);
      try {
        await persistNotificationSettings({ [key]: checked });
        if (key === "pushEngagementEnabled") setPushEngagementEnabled(checked);
        if (key === "pushPublicationEnabled") setPushPublicationEnabled(checked);
        if (key === "pushMailEnabled") setPushMailEnabled(checked);
        if (key === "pushVoyageAdminEnabled") setPushVoyageAdminEnabled(checked);
        if (key === "pushVoyageUserEnabled") setPushVoyageUserEnabled(checked);
      } catch (error) {
        console.error("Push preference save error:", error);
        toast.error(copy.actions.saveError);
      } finally {
        setPushStateLoading(false);
      }
    },
    [copy.actions.saveError, persistNotificationSettings],
  );

  const loadPasskeys = useCallback(async () => {
    if (!session?.user) return;
    setPasskeysLoading(true);
    try {
      const { data, error } = await supabase.auth.passkey.list();
      if (error) {
        console.error("Passkey list error:", error);
        return;
      }
      setPasskeys(data || []);
    } catch (error) {
      console.error("Passkey list error:", error);
    } finally {
      setPasskeysLoading(false);
    }
  }, [session?.user]);

  const handleRegisterPasskey = useCallback(async () => {
    if (passkeyUnavailableMessage) {
      toast.error(passkeyUnavailableMessage);
      return;
    }

    setRegisteringPasskey(true);
    try {
      const { error } = await supabase.auth.registerPasskey();
      if (error) throw error;
      toast.success(copy.actions.passkeyAdded);
      await loadPasskeys();
    } catch (error) {
      console.error("Passkey registration error:", error);
      const errorLike = error as { code?: string; message?: string; name?: string };
      const message = errorLike?.message || "";
      const code = errorLike?.code || "";
      const lowered = `${code} ${message} ${errorLike?.name || ""}`.toLowerCase();

      if (
        code === "ERROR_INVALID_RP_ID" ||
        code === "ERROR_INVALID_DOMAIN" ||
        lowered.includes("rp id") ||
        lowered.includes("relying party") ||
        lowered.includes("origin") ||
        lowered.includes("securityerror")
      ) {
        toast.error(`${copy.actions.passkeyConfigError} Origin: ${window.location.origin}`);
      } else if (lowered.includes("passkey_disabled") || lowered.includes("passkey") && lowered.includes("disabled")) {
        toast.error(copy.actions.passkeyDisabled);
      } else if (
        code === "ERROR_CEREMONY_ABORTED" ||
        lowered.includes("notallowederror") ||
        lowered.includes("cancel")
      ) {
        toast.error(copy.actions.passkeyCancelled);
      } else {
        toast.error(message || copy.actions.passkeyError);
      }
    } finally {
      setRegisteringPasskey(false);
    }
  }, [
    copy.actions.passkeyAdded,
    copy.actions.passkeyCancelled,
    copy.actions.passkeyConfigError,
    copy.actions.passkeyDisabled,
    copy.actions.passkeyError,
    loadPasskeys,
    passkeyUnavailableMessage,
  ]);

  const handleRemovePasskey = useCallback(async (passkeyId: string) => {
    setRemovingPasskeyId(passkeyId);
    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId });
      if (error) throw error;
      setPasskeys((current) => current.filter((passkey) => passkey.id !== passkeyId));
      toast.success(copy.actions.passkeyRemoved);
    } catch (error) {
      console.error("Passkey delete error:", error);
      toast.error(error instanceof Error ? error.message : copy.actions.passkeyError);
    } finally {
      setRemovingPasskeyId(null);
    }
  }, [copy.actions.passkeyError, copy.actions.passkeyRemoved]);

  const loadProfile = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfileLoaded(true);
      return;
    }

    try {
      const currentEmail = session?.user.email || "";
      setEmail(currentEmail);

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "name, bio, avatar_url, preferred_language, secondary_language, social_instagram, social_youtube, social_tiktok, social_facebook, social_x, social_linkedin, social_website, social_seapeople",
        )
        .eq("id", userId)
        .single();
      if (error) {
        if (isAuthFailureError(error)) {
          await supabase.auth.signOut();
          navigate("/login", { state: { from: "/profile" }, replace: true });
          return;
        }
        console.error("Profile load error:", error);
      }

      if (data) {
        setName(data.name || "");
        setBio(data.bio || "");
        setAvatarUrl(data.avatar_url || "");
        if (data.preferred_language) setPreferredLanguage(data.preferred_language as ExtendedLanguage);
        if (data.secondary_language) setSecondaryLanguage(data.secondary_language);
        setSocials({
          social_instagram: data.social_instagram || "",
          social_youtube: data.social_youtube || "",
          social_tiktok: data.social_tiktok || "",
          social_facebook: data.social_facebook || "",
          social_x: data.social_x || "",
          social_linkedin: data.social_linkedin || "",
          social_website: data.social_website || "",
          social_seapeople: data.social_seapeople || "",
        });
      }

      const loadedName = data?.name || "";
      const loadedBio = data?.bio || "";
      const loadedAvatarUrl = data?.avatar_url || "";
      const loadedPreferredLanguage = (data?.preferred_language as ExtendedLanguage | null) || "it";
      const loadedSecondaryLanguage = data?.secondary_language || null;
      const loadedSocials: Record<SocialFieldKey, string> = {
        social_instagram: data?.social_instagram || "",
        social_youtube: data?.social_youtube || "",
        social_tiktok: data?.social_tiktok || "",
        social_facebook: data?.social_facebook || "",
        social_x: data?.social_x || "",
        social_linkedin: data?.social_linkedin || "",
        social_website: data?.social_website || "",
        social_seapeople: data?.social_seapeople || "",
      };

      const loadedNewsletterSubscribed = await loadNewsletterState(userId, currentEmail);
      const [{ count: ownedVoyageBookingCount }, { count: participantVoyageBookingCount }] = await Promise.all([
        supabase
          .from("voyage_booking_requests")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", userId),
        supabase
          .from("voyage_booking_participants")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", userId),
      ]);
      const loadedHasVoyageNotificationScope =
        Boolean((ownedVoyageBookingCount ?? 0) > 0 || (participantVoyageBookingCount ?? 0) > 0);
      setHasVoyageNotificationScope(loadedHasVoyageNotificationScope);

      const { data: preferenceRow, error: preferenceError } = await supabase
        .from("email_notification_preferences")
        .select("article_notifications_enabled, story_notifications_enabled, like_notifications_frequency, comment_notifications_frequency, push_engagement_enabled, push_publication_enabled, push_mail_enabled, push_voyage_admin_enabled, push_voyage_user_enabled")
        .eq("email", currentEmail.trim().toLowerCase())
        .maybeSingle();

      if (preferenceError) {
        console.error("Notification preference load error:", preferenceError);
      }

      const loadedNotificationPreferences = preferenceRow
        ? {
          like_notifications_frequency: normalizeEngagementNotificationFrequency(
            preferenceRow.like_notifications_frequency,
          ),
          comment_notifications_frequency: normalizeEngagementNotificationFrequency(
            preferenceRow.comment_notifications_frequency,
          ),
        }
        : DEFAULT_PROFILE_NOTIFICATION_PREFERENCES;

      if (preferenceRow) {
        setArticleNotificationsEnabled(preferenceRow.article_notifications_enabled ?? true);
        setStoryNotificationsEnabled(preferenceRow.story_notifications_enabled ?? true);
        setNotificationPreferences(loadedNotificationPreferences);
        setPushEngagementEnabled(preferenceRow.push_engagement_enabled ?? true);
        setPushPublicationEnabled(preferenceRow.push_publication_enabled ?? true);
        setPushMailEnabled(preferenceRow.push_mail_enabled ?? true);
        setPushVoyageAdminEnabled(preferenceRow.push_voyage_admin_enabled ?? true);
        setPushVoyageUserEnabled(preferenceRow.push_voyage_user_enabled ?? true);
      }

      await loadPushState();

      initialSnapshotRef.current = createProfileSnapshot({
        name: loadedName,
        bio: loadedBio,
        avatarUrl: loadedAvatarUrl,
        preferredLanguage: loadedPreferredLanguage,
        secondaryLanguage: SITE_LANGUAGES.includes(loadedPreferredLanguage as "it" | "en")
          ? null
          : loadedSecondaryLanguage,
        newsletterSubscribed: loadedNewsletterSubscribed,
        articleNotificationsEnabled: preferenceRow?.article_notifications_enabled ?? true,
        storyNotificationsEnabled: preferenceRow?.story_notifications_enabled ?? true,
        socials: loadedSocials,
        notificationPreferences: loadedNotificationPreferences,
      });

      const { data: storySubs, error: storySubsError } = await supabase
        .from("story_subscriptions")
        .select("id, story_id, stories(title_it, title_en, slug)")
        .eq("profile_id", userId);
      if (storySubsError) {
        if (isAuthFailureError(storySubsError)) {
          await supabase.auth.signOut();
          navigate("/login", { state: { from: "/profile" }, replace: true });
          return;
        }
        console.error("Story subscriptions load error:", storySubsError);
        return;
      }

      if (storySubs) {
        setStorySubscriptions(
          (storySubs as StorySubscriptionRow[])
            .filter((subscription) => Boolean(subscription.stories))
            .map((subscription) => ({
              id: subscription.id,
              story_id: subscription.story_id,
              story: subscription.stories as StorySubscriptionRow["stories"] & {
                title_it: string;
                title_en: string;
                slug: string;
              },
            })),
        );
      }
    } finally {
      setProfileLoaded(true);
    }
  }, [loadNewsletterState, loadPushState, navigate, session]);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      navigate("/login", { state: { from: "/profile" }, replace: true });
      return;
    }
    void loadProfile();
  }, [authLoading, loadProfile, navigate, session]);

  useEffect(() => {
    if (authLoading || !session) return;
    void loadPasskeys();
  }, [authLoading, loadPasskeys, session]);

  useEffect(() => {
    return () => {
      if (pendingAvatarUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(pendingAvatarUrl);
      }
    };
  }, [pendingAvatarUrl]);

  useEffect(() => {
    if (!shouldShowMobileAppCard) return;

    const refreshPushState = () => void loadPushState();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshPushState();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", refreshPushState);
    window.addEventListener("pageshow", refreshPushState);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", refreshPushState);
      window.removeEventListener("pageshow", refreshPushState);
    };
  }, [loadPushState, shouldShowMobileAppCard]);

  useBeforeUnloadPrompt(isDirty && !saving && !saveAndLeavePending);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!isDirty || saving || saveAndLeavePending) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      if (nextUrl.origin !== window.location.origin) return;

      const currentUrl = `${location.pathname}${location.search}${location.hash}`;
      const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      if (currentUrl === nextPath) return;

      event.preventDefault();
      pendingNavigationRef.current = { type: "path", to: nextPath };
      setLeaveDialogOpen(true);
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [isDirty, location.hash, location.pathname, location.search, saveAndLeavePending, saving]);

  useEffect(() => {
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;

    const handlePopState = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }
      if (!isDirty || saving || saveAndLeavePending) return;

      pendingNavigationRef.current = { type: "back" };
      setLeaveDialogOpen(true);
      window.history.pushState(null, "", currentUrl);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isDirty, location.hash, location.pathname, location.search, saveAndLeavePending, saving]);

  const resetPendingAvatar = () => {
    setPendingAvatarUrl(null);
    setAvatarCropOpen(false);
  };

  const handleAvatarSelected = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(copy.actions.invalidImage);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setPendingAvatarUrl(nextUrl);
    setAvatarCropOpen(true);
  };

  const handleAvatarUpload = async (blob: Blob) => {
    setUploadingAvatar(true);

    try {
      const path = `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
      const { error } = await supabase.storage.from("logbook-media").upload(path, blob, {
        contentType: blob.type || "image/png",
      });

      if (error) throw error;

      const { data: urlData } = supabase.storage.from("logbook-media").getPublicUrl(path);
      setAvatarUrl(urlData.publicUrl);
      resetPendingAvatar();
      toast.success(copy.actions.avatarReady);
    } catch (error) {
      console.error("Avatar upload error:", error);
      toast.error(copy.actions.avatarError);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleLanguageChange = (language: ExtendedLanguage) => {
    setPreferredLanguage(language);
    if (SITE_LANGUAGES.includes(language as "it" | "en")) {
      setSecondaryLanguage(null);
    } else if (!secondaryLanguage || !SITE_LANGUAGES.includes(secondaryLanguage as "it" | "en")) {
      setSecondaryLanguage("it");
    }
  };

  const handleStoryUnsubscribe = async (subscriptionId: string) => {
    setRemovingStoryId(subscriptionId);
    try {
      const { error } = await supabase.from("story_subscriptions").delete().eq("id", subscriptionId);
      if (error) throw error;
      setStorySubscriptions((current) => current.filter((subscription) => subscription.id !== subscriptionId));
      toast.success(copy.subscription.removed);
    } catch (error) {
      console.error("Story unsubscribe error:", error);
      toast.error(copy.subscription.removeError);
    } finally {
      setRemovingStoryId(null);
    }
  };

  const saveProfile = async (options?: { showSuccessToast?: boolean }) => {
    if (!session) return false;
    setSaving(true);
    const userId = session.user.id;
    const currentEmail = (session.user.email || email).trim().toLowerCase();
    let profileSaved = false;
    let newsletterSaved = false;
    let notificationPreferencesSaved = false;
    let newsletterHandledByBackend = false;

    try {
      const { error: directProfileError } = await supabase
        .from("profiles")
        .update({
          name,
          bio,
          avatar_url: avatarUrl,
          preferred_language: preferredLanguage,
          secondary_language: isSiteNative ? null : secondaryLanguage,
          ...socials,
        })
        .eq("id", userId);

      if (directProfileError) {
        console.error("Direct profile update failed, trying edge function fallback:", directProfileError);

        const { error: functionError } = await supabase.functions.invoke("update-my-profile", {
          body: {
            name,
            bio,
            avatar_url: avatarUrl,
            preferred_language: preferredLanguage,
            secondary_language: isSiteNative ? null : secondaryLanguage,
            newsletter_subscribed: newsletterSubscribed,
            like_notifications_frequency: notificationPreferences.like_notifications_frequency,
            comment_notifications_frequency: notificationPreferences.comment_notifications_frequency,
            article_notifications_enabled: articleNotificationsEnabled,
            story_notifications_enabled: storyNotificationsEnabled,
            ...socials,
          },
        });

        if (functionError) {
          console.error("Profile save fallback failed:", functionError);
        } else {
          profileSaved = true;
          newsletterSaved = true;
          notificationPreferencesSaved = true;
        }
      } else {
        profileSaved = true;
      }

      if (!newsletterSaved) {
        try {
          const newsletterResult = await syncNewsletterPreference(userId, currentEmail, newsletterSubscribed);
          newsletterSaved = true;
          newsletterHandledByBackend = newsletterResult.backendHandled;
        } catch (newsletterError) {
          console.error("Newsletter sync error:", newsletterError);
        }
      }

      if (!notificationPreferencesSaved) {
        const { data: currentPreferenceRow, error: currentPreferenceError } = await supabase
          .from("email_notification_preferences")
          .select("newsletter_enabled, digest_enabled, story_notifications_enabled, push_engagement_enabled, push_publication_enabled, push_mail_enabled, push_voyage_admin_enabled, push_voyage_user_enabled")
          .eq("email", currentEmail)
          .maybeSingle();

        if (currentPreferenceError) {
          console.error("Notification preference baseline load error:", currentPreferenceError);
        }

        const { error: preferenceError } = await supabase
          .from("email_notification_preferences")
          .upsert({
            email: currentEmail,
            newsletter_enabled: currentPreferenceRow?.newsletter_enabled ?? newsletterSubscribed,
            digest_enabled: currentPreferenceRow?.digest_enabled ?? newsletterSubscribed,
            article_notifications_enabled: articleNotificationsEnabled,
            story_notifications_enabled: storyNotificationsEnabled,
            like_notifications_frequency: notificationPreferences.like_notifications_frequency,
            comment_notifications_frequency: notificationPreferences.comment_notifications_frequency,
            push_engagement_enabled: currentPreferenceRow?.push_engagement_enabled ?? pushEngagementEnabled,
            push_publication_enabled: currentPreferenceRow?.push_publication_enabled ?? pushPublicationEnabled,
            push_mail_enabled: currentPreferenceRow?.push_mail_enabled ?? pushMailEnabled,
            push_voyage_admin_enabled: currentPreferenceRow?.push_voyage_admin_enabled ?? pushVoyageAdminEnabled,
            push_voyage_user_enabled: currentPreferenceRow?.push_voyage_user_enabled ?? pushVoyageUserEnabled,
            updated_at: new Date().toISOString(),
          });

        if (preferenceError) {
          console.error("Notification preference save error:", preferenceError);
        } else {
          notificationPreferencesSaved = true;
        }
      }

      if (newsletterSaved) {
        setLoadedNewsletterSubscribed(newsletterSubscribed);
      }

      if (profileSaved && newsletterSaved && notificationPreferencesSaved) {
        if (!loadedNewsletterSubscribed && newsletterSubscribed && !newsletterHandledByBackend) {
          toast.warning(
            lang === "en"
              ? "Profile saved and subscription recorded, but the welcome email was not sent because the email service did not respond."
              : "Profilo salvato e iscrizione registrata, ma la mail di benvenuto non è stata inviata perché il servizio email non ha risposto.",
          );
          initialSnapshotRef.current = createProfileSnapshot({
            name,
            bio,
            avatarUrl,
            preferredLanguage,
            secondaryLanguage: isSiteNative ? null : secondaryLanguage,
            newsletterSubscribed,
            articleNotificationsEnabled,
            storyNotificationsEnabled,
            socials,
            notificationPreferences,
          });
          return true;
        }

        initialSnapshotRef.current = createProfileSnapshot({
          name,
          bio,
          avatarUrl,
          preferredLanguage,
          secondaryLanguage: isSiteNative ? null : secondaryLanguage,
          newsletterSubscribed,
          articleNotificationsEnabled,
          storyNotificationsEnabled,
          socials,
          notificationPreferences,
        });
        if (options?.showSuccessToast !== false) {
          toast.success(copy.actions.saveSuccess);
        }
        return true;
      }

      if (!profileSaved && newsletterSaved && notificationPreferencesSaved) {
        toast.error(
          lang === "en"
            ? "Newsletter updated, but the profile could not be saved."
            : "Newsletter aggiornata, ma il profilo non è stato salvato.",
        );
        return false;
      }

      if (profileSaved && !newsletterSaved) {
        toast.error(
          lang === "en"
            ? "Profile saved, but the newsletter subscription could not be updated."
            : "Profilo salvato, ma l'iscrizione newsletter non è stata aggiornata.",
        );
        return false;
      }

      if (profileSaved && newsletterSaved && !notificationPreferencesSaved) {
        toast.error(
          lang === "en"
            ? "Profile saved, but engagement notification preferences could not be updated."
            : "Profilo salvato, ma le preferenze notifiche di like e commenti non sono state aggiornate.",
        );
        return false;
      }
    } catch (error) {
      console.error("Profile save error:", error);
    } finally {
      setSaving(false);
    }

    toast.error(copy.actions.saveError);
    return false;
  };

  const continuePendingNavigation = () => {
    const pendingNavigation = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    setLeaveDialogOpen(false);

    if (!pendingNavigation) return;

    if (pendingNavigation.type === "path") {
      navigate(pendingNavigation.to);
      return;
    }

    ignoreNextPopRef.current = true;
    window.history.back();
  };

  const handleStayOnPage = () => {
    setLeaveDialogOpen(false);
    pendingNavigationRef.current = null;
  };

  const handleLeaveWithoutSaving = () => {
    continuePendingNavigation();
  };

  const handleSaveAndLeave = async () => {
    setSaveAndLeavePending(true);
    const didSave = await saveProfile({ showSuccessToast: false });

    if (didSave) {
      continuePendingNavigation();
      toast.success(copy.actions.saveSuccess);
    }

    setSaveAndLeavePending(false);
  };

  const pushPreferenceRows = [
    {
      key: "pushPublicationEnabled" as const,
      title: copy.fields.pushPublicationTitle,
      hint: copy.fields.pushPublicationHint,
      checked: pushPublicationEnabled,
      visible: true,
    },
    {
      key: "pushEngagementEnabled" as const,
      title: copy.fields.pushEngagementTitle,
      hint: copy.fields.pushEngagementHint,
      checked: pushEngagementEnabled,
      visible: true,
    },
    {
      key: "pushMailEnabled" as const,
      title: copy.fields.pushMailTitle,
      hint: copy.fields.pushMailHint,
      checked: pushMailEnabled,
      visible: isAdmin,
    },
    {
      key: "pushVoyageAdminEnabled" as const,
      title: copy.fields.pushVoyageAdminTitle,
      hint: copy.fields.pushVoyageAdminHint,
      checked: pushVoyageAdminEnabled,
      visible: isAdmin,
    },
    {
      key: "pushVoyageUserEnabled" as const,
      title: copy.fields.pushVoyageUserTitle,
      hint: copy.fields.pushVoyageUserHint,
      checked: pushVoyageUserEnabled,
      visible: hasVoyageNotificationScope,
    },
  ].filter((row) => row.visible);

  if (authLoading || (!profileLoaded && session)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{copy.loading}</p>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen pt-24 pb-20 px-6 md:px-12">
      <div className="max-w-6xl mx-auto space-y-6 md:space-y-8">
        <section className="relative overflow-hidden rounded-[38px] border border-white/55 bg-[linear-gradient(145deg,rgba(255,255,255,0.85),rgba(247,245,239,0.74))] shadow-[0_28px_90px_rgba(15,23,42,0.10)]">
          <div className="absolute -top-20 right-8 h-64 w-64 rounded-full bg-accent/12 blur-3xl" />
          <div className="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-primary/8 blur-3xl" />

          <div className="relative grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6 p-6 md:p-8 lg:p-10">
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="space-y-3 max-w-2xl">
                  <h1 className="editorial-heading text-4xl md:text-5xl lg:text-6xl leading-none">{copy.title}</h1>
                  <p className="editorial-body text-sm md:text-base leading-relaxed text-foreground/75">
                    {copy.subtitle}
                  </p>
                </div>
              </div>

              <div className="rounded-[30px] border border-stone-200/85 bg-white/72 p-5 md:p-6 shadow-[0_16px_36px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.45)]">
                <div className="flex flex-col gap-5 md:flex-row md:items-center">
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="group relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-[30px] border border-white/70 bg-muted shadow-[0_14px_45px_rgba(15,23,42,0.12)]"
                  >
                    <ProfileAvatar
                      name={name || "Avatar"}
                      avatarUrl={avatarUrl}
                      imgClassName="img-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      fallback={<Camera className="h-full w-full p-8 text-muted-foreground" />}
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-primary/42 opacity-0 transition-opacity group-hover:opacity-100">
                      <Camera className="text-primary-foreground" size={18} />
                    </div>
                    {uploadingAvatar && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/78 text-[11px] font-sans uppercase tracking-[0.2em] text-foreground backdrop-blur-sm">
                        {copy.actions.upload}
                      </div>
                    )}
                  </button>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="space-y-1">
                      <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground">
                        {copy.previewTitle}
                      </p>
                      <p className="editorial-heading text-2xl md:text-3xl leading-none">
                        {name.trim() || email || copy.title}
                      </p>
                      <p className="text-sm font-sans text-muted-foreground">{email}</p>
                    </div>
                    <p className="editorial-body text-sm leading-relaxed text-foreground/70 max-w-xl">
                      {copy.previewText}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full border-white/70 bg-white/70 hover:bg-white/90"
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        <Camera size={14} />
                        {copy.changePhoto}
                      </Button>
                      <Button
                        asChild
                        type="button"
                        variant="ghost"
                        className="rounded-full text-foreground hover:bg-white/60"
                      >
                        <Link to={`/profile/${session.user.id}`}>
                          {copy.viewPublicProfile}
                          <ArrowUpRight size={14} />
                        </Link>
                      </Button>
                    </div>
                    <p className="text-xs font-sans text-muted-foreground">{copy.photoHint}</p>
                  </div>
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleAvatarSelected(file);
                    event.target.value = "";
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 h-fit">
              {stats.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="rounded-[28px] border border-stone-200/85 bg-white/72 p-5 md:p-6 shadow-[0_16px_36px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.45)]"
                  >
                    <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-background/75">
                      <Icon size={16} className="text-accent" />
                    </div>
                    <p className="editorial-heading text-2xl md:text-4xl leading-none mb-2 break-words">
                      {item.value}
                    </p>
                    <p className="text-xs font-sans uppercase tracking-[0.2em] text-muted-foreground">
                      {item.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.08fr_0.92fr] gap-6">
          <div className="space-y-6">
            <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
                {copy.sections.identityEyebrow}
              </p>
              <h2 className="editorial-heading text-2xl md:text-3xl mb-3">{copy.sections.identityTitle}</h2>
              <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">
                {copy.sections.identityText}
              </p>

              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    {copy.fields.name}
                  </label>
                  <div className="glass-input rounded-[22px] px-4">
                    <Input
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="h-14 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    {copy.fields.email}
                  </label>
                  <div className="flex items-center gap-3 rounded-[22px] border border-white/60 bg-white/58 px-4 py-4 text-sm font-sans text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.32)]">
                    <Mail size={16} className="text-accent" />
                    <span className="truncate">{email}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-sans uppercase tracking-[0.24em] text-muted-foreground">
                    {copy.fields.bio}
                  </label>
                  <div className="glass-input rounded-[24px] px-4 py-1">
                    <Textarea
                      value={bio}
                      onChange={(event) => setBio(event.target.value)}
                      rows={6}
                      placeholder={copy.fields.bioPlaceholder}
                      className="min-h-[168px] border-0 bg-transparent px-0 py-3 text-sm leading-relaxed shadow-none focus-visible:ring-0 resize-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
                {copy.sections.socialsEyebrow}
              </p>
              <h2 className="editorial-heading text-2xl md:text-3xl mb-3">{copy.sections.socialsTitle}</h2>
              <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">
                {copy.sections.socialsText}
              </p>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {socialFields.map((field) => (
                  <div
                    key={field.key}
                    className="rounded-[24px] border border-white/60 bg-white/68 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                  >
                    <div className="mb-3 flex items-center gap-3">
                      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-background/75">
                        {field.icon}
                      </div>
                      <label className="text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                        {field.label}
                      </label>
                    </div>
                    <Input
                      type="text"
                      value={socials[field.key]}
                      onChange={(event) =>
                        setSocials((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      placeholder={field.placeholder}
                      className="h-11 rounded-2xl border-white/65 bg-white/72 shadow-none focus-visible:ring-1"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
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

            <div className="rounded-[34px] border border-stone-200/85 bg-white/60 p-6 md:p-8 shadow-[0_20px_48px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-sans uppercase tracking-[0.28em] text-muted-foreground mb-2">
                {copy.sections.subscriptionsEyebrow}
              </p>
              <h2 className="editorial-heading text-2xl md:text-3xl mb-3">{copy.sections.subscriptionsTitle}</h2>
              <p className="text-sm font-sans text-muted-foreground leading-relaxed mb-6">
                {copy.sections.subscriptionsText}
              </p>

              {storySubscriptions.length > 0 ? (
                <div className="space-y-3">
                  {storySubscriptions.map((subscription) => (
                    <div
                      key={subscription.id}
                      className="flex items-center justify-between gap-3 rounded-[24px] border border-white/60 bg-white/68 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                    >
                      <Link
                        to={`/stories/${subscription.story.slug}`}
                        className="min-w-0 flex-1 hover:text-accent transition-colors"
                      >
                        <p className="font-sans text-sm font-medium text-foreground truncate">
                          {lang === "en" ? subscription.story.title_en : subscription.story.title_it}
                        </p>
                      </Link>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={removingStoryId === subscription.id}
                        className="h-10 w-10 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void handleStoryUnsubscribe(subscription.id)}
                        title={copy.subscription.remove}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[24px] border border-dashed border-white/70 bg-white/52 px-5 py-8 text-sm font-sans text-muted-foreground">
                  {copy.subscription.empty}
                </div>
              )}
            </div>
          </div>
        </section>

      </div>

      {isDirty && (
        <div className="fixed inset-x-4 bottom-4 z-40 md:inset-x-auto md:right-6 md:bottom-6">
          <div className="ml-auto flex items-center justify-between gap-4 rounded-full border border-white/70 bg-[linear-gradient(145deg,rgba(20,33,54,0.94),rgba(39,62,96,0.9))] px-4 py-3 text-white shadow-[0_24px_56px_rgba(15,23,42,0.28)] backdrop-blur-xl md:min-w-[360px]">
            <div className="min-w-0">
              <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-white/65">
                {copy.actions.dirtyBadge}
              </p>
              <p className="text-sm font-sans text-white/90">
                {saving ? copy.actions.saving : copy.actions.save}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void saveProfile()}
              disabled={saving || uploadingAvatar || saveAndLeavePending}
              className="h-11 rounded-full border border-white/20 bg-white text-primary hover:bg-white/92"
            >
              <Save size={15} />
              {saving ? copy.actions.saving : copy.actions.save}
            </Button>
          </div>
        </div>
      )}

      <AvatarCropDialog
        open={avatarCropOpen}
        imageUrl={pendingAvatarUrl}
        loading={uploadingAvatar}
        onOpenChange={(open) => {
          if (!open) resetPendingAvatar();
          else setAvatarCropOpen(true);
        }}
        onCancel={resetPendingAvatar}
        onConfirm={handleAvatarUpload}
      />

      <AlertDialog open={leaveDialogOpen}>
        <AlertDialogContent className="max-w-[560px] rounded-[28px] border-white/20 bg-[linear-gradient(160deg,rgba(255,255,255,0.94),rgba(247,245,239,0.92))] shadow-[0_28px_90px_rgba(15,23,42,0.18)]">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="editorial-heading text-2xl leading-tight">
              {copy.prompt.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="font-sans text-sm leading-relaxed text-foreground/72">
              {copy.prompt.text}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-end">
            <AlertDialogCancel
              onClick={handleStayOnPage}
              className="mt-0 rounded-full border-white/60 bg-white/70 hover:bg-white"
            >
              {copy.actions.stayHere}
            </AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={handleLeaveWithoutSaving}
              className="rounded-full border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {copy.actions.leaveWithoutSaving}
            </Button>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleSaveAndLeave();
              }}
              className="rounded-full"
              disabled={saving || saveAndLeavePending || uploadingAvatar}
            >
              {saveAndLeavePending ? copy.actions.saving : copy.actions.saveAndExit}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminProfile;
