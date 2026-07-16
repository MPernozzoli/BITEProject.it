import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Compass, Fingerprint, MessageCircle, ShieldCheck, UserPlus } from "lucide-react";
import boatHarbor from "@/assets/boat-harbor.webp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n";
import { invokeOptionalNewsletterFunction } from "@/lib/newsletter";
import { validateSessionOrSignOut } from "@/lib/supabase-auth";
import { fetchIsProfileComplete } from "@/lib/profile-completeness";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "signup";
type AuthStep = "email" | "verify";
type AuthMethod = "google" | "email" | "passkey";

const OTP_LENGTH = 8;
const LAST_AUTH_METHOD_STORAGE_KEY = "bite_last_auth_method";
const PENDING_SIGNUP_NEWSLETTER_KEY = "bite_pending_signup_newsletter";
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const AUTH_ROUTES = new Set(["/login", "/signup"]);

const normalizeInternalRedirect = (value: string | null | undefined) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "";
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return "";
    if (AUTH_ROUTES.has(parsed.pathname)) return "";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
};

const AUTH_COPY = {
  it: {
    hero: {
      badge: "BITE community",
      kicker: "Accesso alla community",
      imageLabel: "Dal bordo",
      imageAlt: "Spritz ancorata in porto",
      imageCaption:
        "Storie, refit, rotte e vita reale a bordo di una barca che naviga davvero.",
      login: {
        title: "Bentornato a bordo.",
        description:
          "Accedi per commentare il logbook, gestire il profilo e riprendere il viaggio da dove l'avevi lasciato.",
        cards: [
          {
            title: "Riprendi il logbook",
            description: "Ritrovi commenti, profilo e letture esattamente dove li avevi lasciati.",
          },
          {
            title: "Partecipa alla conversazione",
            description: "Entra nei commenti e resta dentro le storie mentre vengono pubblicate.",
          },
          {
            title: "Accesso leggero ma sicuro",
            description: "Niente password da ricordare: solo email, codice e accesso immediato.",
          },
        ],
      },
      signup: {
        title: "Unisciti all'equipaggio.",
        description:
          "Crea il tuo profilo BITE per seguire la rotta, intervenire nelle conversazioni e restare più vicino al progetto.",
        cards: [
          {
            title: "Crea il tuo profilo",
            description: "Ti basta un nome, un'email e il codice di conferma per iniziare.",
          },
          {
            title: "Segui il viaggio",
            description: "Sblocca un punto d'appoggio stabile per seguire nuove storie e aggiornamenti.",
          },
          {
            title: "Entra nella community",
            description: "Commenta, fai parte delle discussioni e costruisci una presenza riconoscibile.",
          },
        ],
      },
    },
    form: {
      badge: "Accesso sicuro",
      tabs: {
        login: "Accedi",
        signup: "Registrati",
      },
      nameLabel: "Nome",
      namePlaceholder: "Come vuoi farti chiamare?",
      nameHint: "Comparirà sul tuo profilo pubblico e nei commenti.",
      emailLabel: "Email",
      emailPlaceholder: "la-tua@email.com",
      rememberLabel: "Ricordami su questo dispositivo",
      rememberHint: "Disattivalo se stai usando un computer condiviso o pubblico.",
      newsletterLabel: "Iscrivimi anche alla newsletter",
      newsletterHint:
        "Default attivo. Ricevi aggiornamenti editoriali e digest periodici; puoi disiscriverti quando vuoi.",
      divider: "oppure",
      google: "Continua con Google",
      passkey: "Accedi con passkey",
      emailMethod: "Continua via email",
      lastUsed: "Ultimo usato",
      oauthHint: "Google usa lo stesso accesso rapido del codice email.",
      login: {
        title: "Accedi",
        subtitle: "Ricevi un codice via email e rientra in pochi secondi.",
        note: "Se l'email esiste, ti mandiamo un codice di accesso. Se sei nuovo, passa a Registrati.",
        submit: "Invia codice",
      },
      signup: {
        title: "Registrati",
        subtitle: "Email, nome e un codice di conferma. Niente password da ricordare.",
        note: "Il profilo viene creato solo dopo la conferma del codice.",
        submit: "Crea account",
      },
      sending: "Invio in corso...",
    },
    verify: {
      label: "Codice inviato a",
      login: "Inserisci il codice a 8 cifre per rientrare nel tuo profilo.",
      signup: "Conferma l'email per attivare il tuo profilo BITE.",
      help: "Se fallisce, rinvia il codice e usa solo l'ultima email ricevuta.",
      submit: "Verifica codice",
      verifying: "Verifica in corso...",
      changeEmail: "Cambia email",
      resend: "Rinvia codice",
      resendIn: (seconds: number) => `Rinvia tra ${seconds}s`,
    },
    errors: {
      nameRequired: "Inserisci come vuoi farti chiamare.",
      sessionNotReady: "Sessione non pronta. Riprova tra un secondo.",
      verifyGeneric: "Errore durante la verifica",
      oauth: "Errore durante l'accesso con Google",
      passkey: "Errore durante l'accesso con passkey",
      passkeyUnsupported: "Questo browser o dispositivo non supporta ancora le passkey.",
      loginMissingAccount: "Non troviamo un account associato a questa email. Prova con Registrati.",
    },
  },
  en: {
    hero: {
      badge: "BITE community",
      kicker: "Community access",
      imageLabel: "From aboard",
      imageAlt: "Spritz anchored in the harbor",
      imageCaption:
        "Stories, refit notes, routes, and real life aboard a boat that actually sails.",
      login: {
        title: "Welcome back aboard.",
        description:
          "Log in to comment on the logbook, manage your profile, and pick up the journey where you left it.",
        cards: [
          {
            title: "Resume the logbook",
            description: "Your comments, profile, and reading history are exactly where you left them.",
          },
          {
            title: "Stay in the conversation",
            description: "Jump back into the comments and follow new stories as they go live.",
          },
          {
            title: "Lightweight, secure access",
            description: "No passwords to remember. Just your email, a code, and you're in.",
          },
        ],
      },
      signup: {
        title: "Join the crew.",
        description:
          "Create your BITE profile to follow the route, take part in the conversations, and stay closer to the project.",
        cards: [
          {
            title: "Create your profile",
            description: "You only need a name, an email, and a confirmation code to get started.",
          },
          {
            title: "Follow the journey",
            description: "Get a stable place to track new stories and updates as the project moves.",
          },
          {
            title: "Enter the community",
            description: "Comment, join the discussions, and build a recognizable presence aboard.",
          },
        ],
      },
    },
    form: {
      badge: "Secure access",
      tabs: {
        login: "Login",
        signup: "Sign up",
      },
      nameLabel: "Name",
      namePlaceholder: "What should we call you?",
      nameHint: "This will appear on your public profile and in comments.",
      emailLabel: "Email",
      emailPlaceholder: "your@email.com",
      rememberLabel: "Keep me signed in on this device",
      rememberHint: "Turn it off if you're using a shared or public computer.",
      newsletterLabel: "Subscribe me to the newsletter too",
      newsletterHint:
        "Enabled by default. You will receive editorial updates and periodic digests, and you can unsubscribe anytime.",
      divider: "or",
      google: "Continue with Google",
      passkey: "Sign in with passkey",
      emailMethod: "Continue with email",
      lastUsed: "Last used",
      oauthHint: "Google uses the same fast access flow as the email code.",
      login: {
        title: "Login",
        subtitle: "Get a code by email and come back in within seconds.",
        note: "If the email exists, we'll send a login code. If you're new here, switch to Sign up.",
        submit: "Send code",
      },
      signup: {
        title: "Sign up",
        subtitle: "Email, name, and one confirmation code. No password to remember.",
        note: "Your profile is only created after you confirm the code.",
        submit: "Create account",
      },
      sending: "Sending...",
    },
    verify: {
      label: "Code sent to",
      login: "Enter the 8-digit code to get back into your profile.",
      signup: "Confirm your email to activate your BITE profile.",
      help: "If it fails, resend the code and use only the latest email you received.",
      submit: "Verify code",
      verifying: "Verifying...",
      changeEmail: "Change email",
      resend: "Resend code",
      resendIn: (seconds: number) => `Resend in ${seconds}s`,
    },
    errors: {
      nameRequired: "Enter the name you want to use.",
      sessionNotReady: "Session is not ready yet. Try again in a second.",
      verifyGeneric: "Error while verifying the code",
      oauth: "Error while signing in with Google",
      passkey: "Error while signing in with passkey",
      passkeyUnsupported: "This browser or device does not support passkeys yet.",
      loginMissingAccount: "We couldn't find an account for this email. Try Sign up instead.",
    },
  },
} as const;

const mapAuthError = (
  message: string,
  mode: AuthMode,
  errors: { loginMissingAccount: string },
) => {
  const lowered = message.toLowerCase();
  if (
    mode === "login" &&
    (lowered.includes("signups not allowed") ||
      lowered.includes("user not found") ||
      lowered.includes("invalid login"))
  ) {
    return errors.loginMissingAccount;
  }
  return message;
};

const UserLogin = () => {
  const [step, setStep] = useState<AuthStep>("email");
  const [emailInput, setEmailInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [submittedName, setSubmittedName] = useState("");
  const [submittedMode, setSubmittedMode] = useState<AuthMode>("login");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [rememberMe, setRememberMe] = useState(true);
  const [signupNewsletterOptIn, setSignupNewsletterOptIn] = useState(true);
  const [lastUsedMethod, setLastUsedMethod] = useState<AuthMethod | null>(null);
  const [submittedNewsletterOptIn, setSubmittedNewsletterOptIn] = useState(true);
  const { lang } = useI18n();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();

  const authMode: AuthMode = location.pathname === "/signup" ? "signup" : "login";
  const searchParams = new URLSearchParams(location.search);
  const stateRedirect = normalizeInternalRedirect((location.state as { from?: string } | null)?.from);
  const queryRedirect = normalizeInternalRedirect(searchParams.get("redirect"));
  const homeRedirect = lang === "en" ? "/en" : "/it";
  const redirectTo = stateRedirect || queryRedirect || homeRedirect;
  const ui = AUTH_COPY[lang === "it" ? "it" : "en"];
  const heroContent = ui.hero[authMode];
  const formContent = ui.form[authMode];
  const verifyContent = ui.verify[submittedMode];
  const emailReady = !!normalizeEmail(emailInput);
  const nameReady = authMode === "login" || !!nameInput.trim();

  const completeAuthNavigation = async (userId: string) => {
    const complete = await fetchIsProfileComplete(userId);
    if (complete) {
      navigate(redirectTo, { replace: true });
    } else {
      navigate("/complete-profile", { state: { from: redirectTo }, replace: true });
    }
  };

  useEffect(() => {
    const storedMethod = window.localStorage.getItem(LAST_AUTH_METHOD_STORAGE_KEY);
    if (storedMethod === "google" || storedMethod === "email" || storedMethod === "passkey") {
      setLastUsedMethod(storedMethod);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { session } = await validateSessionOrSignOut();
      if (!cancelled && session) {
        await completeAuthNavigation(session.user.id);
      }
    })();

    return () => {
      cancelled = true;
    };
    // completeAuthNavigation intentionally excluded: it is stable in effect (recreated each render but not depended on for identity)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, redirectTo]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    setStep("email");
    setOtp("");
    setError("");
    setSubmittedEmail("");
    setSubmittedNewsletterOptIn(true);
    setResendCooldown(0);
  }, [authMode]);

  const sendOtp = async ({
    mode,
    email = emailInput,
    name = nameInput,
  }: {
    mode: AuthMode;
    email?: string;
    name?: string;
  }) => {
    const normalizedEmail = normalizeEmail(email);
    const trimmedName = name.trim();

    if (!normalizedEmail) return false;
    if (mode === "signup" && !trimmedName) {
      setError(ui.errors.nameRequired);
      return false;
    }

    setLoading(true);
    setError("");

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: mode === "signup",
        data: mode === "signup" ? { name: trimmedName } : undefined,
      },
    });

    setLoading(false);

    if (otpError) {
      setError(mapAuthError(otpError.message, mode, ui.errors));
      return false;
    }

    setSubmittedEmail(normalizedEmail);
    setSubmittedName(trimmedName);
    setSubmittedMode(mode);
    setSubmittedNewsletterOptIn(mode === "signup" ? signupNewsletterOptIn : false);
    setResendCooldown(30);
    return true;
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await sendOtp({ mode: authMode });
    if (!ok) return;

    setOtp("");
    setStep("verify");
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || !submittedEmail) return;
    setOtp("");
    setError("");
    await sendOtp({
      mode: submittedMode,
      email: submittedEmail,
      name: submittedName,
    });
  };

  const handleVerify = async () => {
    if (otp.length < OTP_LENGTH || !submittedEmail) return;
    setLoading(true);
    setError("");

    try {
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email: submittedEmail,
        token: otp,
        type: "email",
      });

      if (verifyError) {
        setError(verifyError.message);
        return;
      }

      if (!rememberMe) {
        localStorage.setItem("bite_ephemeral_session", "true");
      } else {
        localStorage.removeItem("bite_ephemeral_session");
      }

      localStorage.setItem(LAST_AUTH_METHOD_STORAGE_KEY, "email");
      setLastUsedMethod("email");

      const session = verifyData?.session ?? (await supabase.auth.getSession()).data.session;
      if (!session) {
        setError(ui.errors.sessionNotReady);
        return;
      }

      if (submittedMode === "signup" && submittedNewsletterOptIn) {
        const { error: newsletterError } = await invokeOptionalNewsletterFunction(
          supabase.functions.invoke.bind(supabase.functions),
          "my-newsletter-subscription",
          {
            subscribed: true,
            source: "signup_email",
          },
        );

        if (newsletterError) {
          console.error("Signup newsletter sync failed", newsletterError);
        }
      }

      await completeAuthNavigation(session.user.id);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : ui.errors.verifyGeneric;
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError("");

    if (authMode === "signup") {
      window.localStorage.setItem(
        PENDING_SIGNUP_NEWSLETTER_KEY,
        JSON.stringify({
          enabled: signupNewsletterOptIn,
          source: "signup_google",
          createdAt: new Date().toISOString(),
        })
      );
    } else {
      window.localStorage.removeItem(PENDING_SIGNUP_NEWSLETTER_KEY);
    }

    const oauthReturnPath = `/login?redirect=${encodeURIComponent(redirectTo)}`;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: new URL(oauthReturnPath, window.location.origin).toString(),
      },
    });

    if (oauthError) {
      if (authMode === "signup") {
        window.localStorage.removeItem(PENDING_SIGNUP_NEWSLETTER_KEY);
      }
      setError(oauthError.message || ui.errors.oauth);
    } else {
      localStorage.setItem(LAST_AUTH_METHOD_STORAGE_KEY, "google");
      setLastUsedMethod("google");
    }

    setLoading(false);
  };

  const handlePasskeyAuth = async () => {
    if (!window.PublicKeyCredential) {
      setError(ui.errors.passkeyUnsupported);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data, error: passkeyError } = await supabase.auth.signInWithPasskey();

      if (passkeyError) {
        setError(passkeyError.message || ui.errors.passkey);
        return;
      }

      if (!data?.session) {
        setError(ui.errors.sessionNotReady);
        return;
      }

      if (!rememberMe) {
        localStorage.setItem("bite_ephemeral_session", "true");
      } else {
        localStorage.removeItem("bite_ephemeral_session");
      }

      localStorage.setItem(LAST_AUTH_METHOD_STORAGE_KEY, "passkey");
      setLastUsedMethod("passkey");
      await completeAuthNavigation(data.session.user.id);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : ui.errors.passkey;
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const featureCards =
    authMode === "signup"
      ? [
          { icon: UserPlus, ...heroContent.cards[0] },
          { icon: Compass, ...heroContent.cards[1] },
          { icon: MessageCircle, ...heroContent.cards[2] },
        ]
      : [
          { icon: Compass, ...heroContent.cards[0] },
          { icon: MessageCircle, ...heroContent.cards[1] },
          { icon: ShieldCheck, ...heroContent.cards[2] },
        ];

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden sm:px-8 lg:px-12",
        isMobile ? "px-4 pb-10 pt-6" : "px-6 pb-24 pt-24",
      )}
    >
      {!isMobile && (
        <>
          <div className="absolute inset-0 -z-20 bg-[linear-gradient(135deg,_hsl(var(--salt))_0%,_hsl(var(--salt-warm))_44%,_hsl(var(--secondary))_100%)]" />
          <div className="absolute inset-x-0 top-0 -z-10 h-32 border-b border-white/70 bg-white/35 backdrop-blur-sm" />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,_hsl(var(--foreground)/0.045)_1px,_transparent_1px),linear-gradient(to_bottom,_hsl(var(--foreground)/0.035)_1px,_transparent_1px)] bg-[size:72px_72px] opacity-45" />
        </>
      )}

      <div
        className={cn(
          "mx-auto max-w-6xl",
          isMobile ? "max-w-md" : "grid gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-center",
        )}
      >
        {!isMobile && (
          <section className="space-y-8 slide-up">
          <div className="space-y-4">
            <h1 className="editorial-heading max-w-xl text-5xl leading-[0.95] text-foreground md:text-6xl">
              {heroContent.title}
            </h1>
            <p className="max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
              {heroContent.description}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {featureCards.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-[1.5rem] border border-white/70 bg-white/55 p-5 shadow-[0_24px_50px_-34px_hsl(var(--navy)/0.45)] backdrop-blur"
              >
                <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[hsl(var(--secondary)/0.9)] text-accent">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>

          <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/60 shadow-[0_36px_90px_-48px_hsl(var(--navy)/0.55)] backdrop-blur">
            <img
              src={boatHarbor}
              alt={ui.hero.imageAlt}
              className="h-80 w-full object-cover"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[hsl(var(--primary)/0.96)] via-[hsl(var(--primary)/0.62)] to-transparent p-6 text-primary-foreground">
              <p className="text-[0.65rem] uppercase tracking-[0.28em] text-primary-foreground/80">
                {ui.hero.imageLabel}
              </p>
              <p className="mt-3 max-w-md text-sm leading-6 text-primary-foreground/92">
                {ui.hero.imageCaption}
              </p>
            </div>
          </div>
          </section>
        )}

        <section className="fade-in">
          <div
            className={cn(
              "border border-white/70 bg-[linear-gradient(180deg,_rgba(255,255,255,0.86)_0%,_rgba(255,255,255,0.72)_100%)] backdrop-blur",
              isMobile
                ? "rounded-[1.5rem] p-5 shadow-[0_20px_48px_-36px_hsl(var(--navy)/0.3)]"
                : "rounded-[2rem] p-6 shadow-[0_36px_90px_-48px_hsl(var(--navy)/0.55)] md:p-8",
            )}
          >
            <div className="space-y-6">
              <div className="space-y-4">
                <div className="inline-flex w-full rounded-full border border-white/80 bg-white/70 p-1 shadow-[0_20px_40px_-30px_hsl(var(--navy)/0.35)]">
                  <Link
                    to={{ pathname: "/login", search: location.search }}
                    state={location.state}
                    className={cn(
                      "flex-1 rounded-full px-4 py-2.5 text-center text-sm font-medium transition-colors",
                      authMode === "login"
                        ? "bg-primary text-primary-foreground shadow-[0_12px_28px_-18px_hsl(var(--navy)/0.65)]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {ui.form.tabs.login}
                  </Link>
                  <Link
                    to={{ pathname: "/signup", search: location.search }}
                    state={location.state}
                    className={cn(
                      "flex-1 rounded-full px-4 py-2.5 text-center text-sm font-medium transition-colors",
                      authMode === "signup"
                        ? "bg-primary text-primary-foreground shadow-[0_12px_28px_-18px_hsl(var(--navy)/0.65)]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {ui.form.tabs.signup}
                  </Link>
                </div>

                <div>
                  <h2
                    className={cn(
                      "editorial-heading text-foreground",
                      isMobile ? "text-3xl leading-tight" : "text-4xl",
                    )}
                  >
                    {formContent.title}
                  </h2>
                  {!isMobile && (
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {formContent.subtitle}
                    </p>
                  )}
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    { key: "google" as const, label: "Google", icon: Compass },
                    { key: "email" as const, label: "Email OTP", icon: MessageCircle },
                    { key: "passkey" as const, label: "Passkey", icon: Fingerprint },
                  ].map(({ key, label, icon: Icon }) => (
                    <div
                      key={key}
                      className={cn(
                        "flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs",
                        lastUsedMethod === key
                          ? "border-[hsl(var(--accent)/0.32)] bg-[hsl(var(--accent)/0.08)] text-foreground"
                          : "border-white/70 bg-white/55 text-muted-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 text-accent" aria-hidden />
                      <span className="font-medium">{label}</span>
                      {lastUsedMethod === key && <span className="ml-auto text-[10px] uppercase tracking-[0.14em]">{ui.form.lastUsed}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {step === "email" && (
                <form onSubmit={handleSendOtp} className="space-y-5">
                  <div className="space-y-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleGoogleAuth}
                      disabled={loading}
                      className="h-12 w-full rounded-full border-white/85 bg-white/72 px-4 text-sm font-semibold shadow-[0_20px_44px_-34px_hsl(var(--navy)/0.4)] hover:bg-white"
                    >
                      <span className="flex w-full items-center justify-between gap-3">
                        <span className="flex items-center gap-3">
                          <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                          </svg>
                          <span>{ui.form.google}</span>
                        </span>
                        {lastUsedMethod === "google" && (
                          <span className="rounded-full border border-white/80 bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            {ui.form.lastUsed}
                          </span>
                        )}
                      </span>
                    </Button>
                    {authMode === "login" && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handlePasskeyAuth}
                        disabled={loading}
                        className="h-12 w-full rounded-full border-white/85 bg-white/72 px-4 text-sm font-semibold shadow-[0_20px_44px_-34px_hsl(var(--navy)/0.4)] hover:bg-white"
                      >
                        <span className="flex w-full items-center justify-between gap-3">
                          <span className="flex items-center gap-3">
                            <Fingerprint className="h-5 w-5 text-accent" />
                            <span>{ui.form.passkey}</span>
                          </span>
                          {lastUsedMethod === "passkey" && (
                            <span className="rounded-full border border-white/80 bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              {ui.form.lastUsed}
                            </span>
                          )}
                        </span>
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {ui.form.emailMethod}
                    </p>
                    {lastUsedMethod === "email" && (
                      <span className="rounded-full border border-white/80 bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {ui.form.lastUsed}
                      </span>
                    )}
                  </div>

                  {authMode === "signup" && (
                    <div className="space-y-2">
                      <label
                        htmlFor="name"
                        className="block text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                      >
                        {ui.form.nameLabel}
                      </label>
                      <Input
                        id="name"
                        name="name"
                        autoComplete="name"
                        enterKeyHint="next"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder={ui.form.namePlaceholder}
                        className="h-12 rounded-2xl border-white/80 bg-white/72 px-4 text-sm shadow-[0_20px_44px_-32px_hsl(var(--navy)/0.45)] focus-visible:ring-accent focus-visible:ring-offset-0"
                      />
                      <p className="text-xs leading-5 text-muted-foreground">{ui.form.nameHint}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label
                      htmlFor="email"
                      className="block text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      {ui.form.emailLabel}
                    </label>
                    <Input
                      id="email"
                      type="email"
                      name="email"
                      autoComplete="username"
                      inputMode="email"
                      enterKeyHint="next"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder={ui.form.emailPlaceholder}
                      className="h-12 rounded-2xl border-white/80 bg-white/72 px-4 text-sm shadow-[0_20px_44px_-32px_hsl(var(--navy)/0.45)] focus-visible:ring-accent focus-visible:ring-offset-0"
                    />
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-[1.5rem] border border-white/75 bg-white/65 p-4">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-border accent-[hsl(var(--accent))]"
                    />
                    <span className="space-y-1">
                      <span className="block text-sm font-medium text-foreground">
                        {ui.form.rememberLabel}
                      </span>
                      <span className="block text-xs leading-5 text-muted-foreground">
                        {ui.form.rememberHint}
                      </span>
                    </span>
                  </label>

                  {authMode === "signup" && (
                    <label className="flex cursor-pointer items-start gap-3 rounded-[1.5rem] border border-[hsl(var(--accent)/0.18)] bg-[hsl(var(--accent)/0.05)] p-4">
                      <input
                        type="checkbox"
                        checked={signupNewsletterOptIn}
                        onChange={(e) => setSignupNewsletterOptIn(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-border accent-[hsl(var(--accent))]"
                      />
                      <span className="space-y-1">
                        <span className="block text-sm font-medium text-foreground">
                          {ui.form.newsletterLabel}
                        </span>
                        <span className="block text-xs leading-5 text-muted-foreground">
                          {ui.form.newsletterHint}
                        </span>
                      </span>
                    </label>
                  )}

                  <div className="flex gap-3 rounded-[1.5rem] border border-[hsl(var(--accent)/0.16)] bg-[hsl(var(--accent)/0.06)] p-4">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                    <p className="text-sm leading-6 text-foreground/80">{formContent.note}</p>
                  </div>

                  {error && (
                    <div className="rounded-[1.25rem] border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={loading || !emailReady || !nameReady}
                    className="h-12 w-full rounded-full bg-primary px-6 text-sm font-semibold uppercase tracking-[0.18em] shadow-[0_24px_48px_-28px_hsl(var(--navy)/0.7)] hover:bg-navy-light"
                  >
                    {loading ? ui.form.sending : formContent.submit}
                  </Button>
                </form>
              )}

              {step === "verify" && (
                <div className="space-y-6">
                  <div className="rounded-[1.5rem] border border-white/80 bg-white/68 p-5 shadow-[0_20px_44px_-34px_hsl(var(--navy)/0.35)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      {ui.verify.label}
                    </p>
                    <p className="mt-2 break-all text-base font-medium text-foreground">
                      {submittedEmail}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {verifyContent}
                    </p>
                  </div>

                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={OTP_LENGTH}
                      value={otp}
                      onChange={setOtp}
                      containerClassName="justify-center"
                    >
                      <InputOTPGroup className="gap-2">
                        <InputOTPSlot
                          index={0}
                          className="h-12 w-10 rounded-xl border border-white/85 bg-white/76 text-base shadow-[0_18px_36px_-28px_hsl(var(--navy)/0.45)]"
                        />
                        <InputOTPSlot
                          index={1}
                          className="h-12 w-10 rounded-xl border border-white/85 bg-white/76 text-base shadow-[0_18px_36px_-28px_hsl(var(--navy)/0.45)]"
                        />
                        <InputOTPSlot
                          index={2}
                          className="h-12 w-10 rounded-xl border border-white/85 bg-white/76 text-base shadow-[0_18px_36px_-28px_hsl(var(--navy)/0.45)]"
                        />
                        <InputOTPSlot
                          index={3}
                          className="h-12 w-10 rounded-xl border border-white/85 bg-white/76 text-base shadow-[0_18px_36px_-28px_hsl(var(--navy)/0.45)]"
                        />
                      </InputOTPGroup>
                      <InputOTPSeparator className="mx-1 text-muted-foreground" />
                      <InputOTPGroup className="gap-2">
                        <InputOTPSlot
                          index={4}
                          className="h-12 w-10 rounded-xl border border-white/85 bg-white/76 text-base shadow-[0_18px_36px_-28px_hsl(var(--navy)/0.45)]"
                        />
                        <InputOTPSlot
                          index={5}
                          className="h-12 w-10 rounded-xl border border-white/85 bg-white/76 text-base shadow-[0_18px_36px_-28px_hsl(var(--navy)/0.45)]"
                        />
                        <InputOTPSlot
                          index={6}
                          className="h-12 w-10 rounded-xl border border-white/85 bg-white/76 text-base shadow-[0_18px_36px_-28px_hsl(var(--navy)/0.45)]"
                        />
                        <InputOTPSlot
                          index={7}
                          className="h-12 w-10 rounded-xl border border-white/85 bg-white/76 text-base shadow-[0_18px_36px_-28px_hsl(var(--navy)/0.45)]"
                        />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  {error ? (
                    <div className="rounded-[1.25rem] border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      <p>{error}</p>
                      <p className="mt-2 text-xs text-destructive/80">{ui.verify.help}</p>
                    </div>
                  ) : (
                    <p className="text-center text-xs leading-5 text-muted-foreground">
                      {ui.verify.help}
                    </p>
                  )}

                  <Button
                    type="button"
                    onClick={handleVerify}
                    disabled={loading || otp.length < OTP_LENGTH}
                    className="h-12 w-full rounded-full bg-primary px-6 text-sm font-semibold uppercase tracking-[0.18em] shadow-[0_24px_48px_-28px_hsl(var(--navy)/0.7)] hover:bg-navy-light"
                  >
                    {loading ? ui.verify.verifying : ui.verify.submit}
                  </Button>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setStep("email");
                        setOtp("");
                        setError("");
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/80 bg-white/65 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      {ui.verify.changeEmail}
                    </button>
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resendCooldown > 0 || loading}
                      className="rounded-full px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      {resendCooldown > 0 ? ui.verify.resendIn(resendCooldown) : ui.verify.resend}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default UserLogin;
