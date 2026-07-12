import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

type Status = "loading" | "ready" | "success" | "already" | "invalid" | "error";

const NewsletterConfirm = () => {
  const { lang } = useI18n();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [processing, setProcessing] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }

    void validateToken(token);
  }, [token]);

  const validateToken = async (nextToken: string) => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/confirm-newsletter-subscription?token=${encodeURIComponent(nextToken)}`,
        { headers: { apikey: anonKey } }
      );

      if (!res.ok) {
        setStatus("invalid");
        return;
      }

      const data = await res.json();
      setEmail(typeof data.email === "string" ? data.email : "");

      if (data.alreadyConfirmed) {
        setStatus("already");
        return;
      }

      setStatus(data.valid ? "ready" : "invalid");
    } catch (error) {
      console.error("Failed to validate confirmation token", error);
      setStatus("invalid");
    }
  };

  const handleConfirm = async () => {
    if (!token) return;
    setProcessing(true);

    try {
      const { data, error } = await supabase.functions.invoke("confirm-newsletter-subscription", {
        body: { token },
      });

      if (error) {
        console.error("Newsletter confirmation failed", error);
        setStatus("error");
      } else if (data?.alreadyConfirmed) {
        setStatus("already");
      } else if (data?.success) {
        setEmail(typeof data.email === "string" ? data.email : email);
        setStatus("success");
      } else {
        setStatus("error");
      }
    } catch (error) {
      console.error("Newsletter confirmation failed", error);
      setStatus("error");
    }

    setProcessing(false);
  };

  return (
    <div className="min-h-screen px-6 py-20">
      <div className="mx-auto max-w-2xl">
        <div className="glass-panel rounded-[34px] border border-black/6 bg-white/80 p-6 md:p-10 shadow-[0_24px_90px_rgba(15,23,42,0.08)]">
          <p className="mb-3 text-xs font-sans uppercase tracking-[0.28em] text-muted-foreground">
            {lang === "it" ? "Conferma iscrizione" : "Confirm subscription"}
          </p>
          <h1 className="editorial-heading text-3xl md:text-5xl leading-tight">
            {lang === "it" ? "Conferma che vuoi iscriverti." : "Confirm that you want to subscribe."}
          </h1>
          <p className="mt-4 text-sm md:text-base text-muted-foreground leading-relaxed">
            {lang === "it"
              ? "Completa il double opt-in per attivare gli Appunti dalla barca. Dopo la conferma riceverai la mail di benvenuto e poi gli aggiornamenti editoriali."
              : "Complete the double opt-in to activate Notes from the boat. After confirmation you will receive the welcome email and then the editorial updates."}
          </p>

          <div className="mt-10 space-y-6">
            {status === "loading" && (
              <p className="text-muted-foreground">
                {lang === "it" ? "Verifica link in corso..." : "Checking the link..."}
              </p>
            )}

            {status === "ready" && (
              <div className="space-y-6">
                {email ? (
                  <div className="rounded-[24px] border border-black/6 bg-white px-5 py-5">
                    <p className="text-xs font-sans uppercase tracking-[0.22em] text-muted-foreground">
                      {lang === "it" ? "Indirizzo da confermare" : "Address to confirm"}
                    </p>
                    <p className="mt-2 text-base font-sans">{email}</p>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={processing}
                  className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-sans font-medium text-primary-foreground transition-colors hover:bg-navy-light disabled:opacity-50"
                >
                  {processing
                    ? lang === "it"
                      ? "Conferma in corso..."
                      : "Confirming..."
                    : lang === "it"
                      ? "Conferma iscrizione"
                      : "Confirm subscription"}
                </button>
              </div>
            )}

            {status === "success" && (
              <div className="rounded-[24px] border border-accent/25 bg-accent/10 px-5 py-5">
                <p className="text-sm text-foreground">
                  {lang === "it"
                    ? "Iscrizione confermata. Da ora gli Appunti dalla barca sono attivi e riceverai anche la mail di benvenuto."
                    : "Subscription confirmed. Notes from the boat is now active and the welcome email will follow."}
                </p>
              </div>
            )}

            {status === "already" && (
              <div className="rounded-[24px] border border-black/6 bg-white px-5 py-5">
                <p className="text-sm text-muted-foreground">
                  {lang === "it"
                    ? "Questa iscrizione era già stata confermata in precedenza."
                    : "This subscription was already confirmed earlier."}
                </p>
              </div>
            )}

            {status === "invalid" && (
              <div className="rounded-[24px] border border-black/6 bg-white px-5 py-5">
                <p className="text-sm text-muted-foreground">
                  {lang === "it" ? "Link non valido o scaduto." : "Invalid or expired link."}
                </p>
              </div>
            )}

            {status === "error" && (
              <div className="rounded-[24px] border border-destructive/20 bg-destructive/10 px-5 py-5">
                <p className="text-sm text-destructive">
                  {lang === "it"
                    ? "Non siamo riusciti a confermare l'iscrizione. Riprova."
                    : "We could not confirm the subscription. Please try again."}
                </p>
              </div>
            )}
          </div>

          <Link
            to="/"
            className="mt-8 inline-flex items-center text-sm font-sans text-accent transition-colors hover:text-foreground"
          >
            ← {lang === "it" ? "Torna alla home" : "Back to home"}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NewsletterConfirm;
