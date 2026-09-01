/**
 * Copy IT/EN della pagina profilo (`/profile`). Vive in lib e non nella pagina perché
 * i pannelli estratti in `components/admin/` ne consumano il tipo: un componente non
 * deve importare da una pagina. Selezionare la lingua con `PROFILE_COPY[lang]`.
 */
export const PROFILE_COPY = {
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
    tabs: {
      identity: "Identità",
      preferences: "Preferenze",
      notifications: "Notifiche",
      security: "Sicurezza",
      crew: "Crew Pass",
      admin: "Admin",
      previewBadge: "Anteprima",
    },
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
      notificationsEyebrow: "Notifiche",
      notificationsTitle: "Cosa ricevi e come",
      notificationsText: "Email, notifiche nel sito e push: scegli cosa vuoi sapere e con che frequenza.",
      securityEyebrow: "Sicurezza",
      securityTitle: "Accesso all'account",
      securityText: "Gestisci le passkey per accedere senza codice email.",
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
    tabs: {
      identity: "Identity",
      preferences: "Preferences",
      notifications: "Notifications",
      security: "Security",
      crew: "Crew Pass",
      admin: "Admin",
      previewBadge: "Preview",
    },
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
      notificationsEyebrow: "Notifications",
      notificationsTitle: "What you get and how",
      notificationsText: "Email, in-app notifications, and push: choose what you want to know and how often.",
      securityEyebrow: "Security",
      securityTitle: "Account access",
      securityText: "Manage passkeys to sign in without an email code.",
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
  },
} as const;

/** Copy di una singola lingua. Unione IT|EN: con `as const` i due rami hanno
 * literal type diversi, quindi restringere a "it" rifiuterebbe il ramo inglese. */
export type ProfileCopy = (typeof PROFILE_COPY)[keyof typeof PROFILE_COPY];
