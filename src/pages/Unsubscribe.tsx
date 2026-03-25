import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

type Status = "loading" | "valid" | "already_unsubscribed" | "invalid" | "success" | "error";

const Unsubscribe = () => {
  const { lang } = useI18n();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!token) { setStatus("invalid"); return; }
    validateToken(token);
  }, [token]);

  const validateToken = async (t: string) => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${t}`, {
        headers: { apikey: anonKey },
      });
      const data = await res.json();
      if (data.valid === false && data.reason === "already_unsubscribed") {
        setStatus("already_unsubscribed");
      } else if (data.valid) {
        setStatus("valid");
      } else {
        setStatus("invalid");
      }
    } catch {
      setStatus("invalid");
    }
  };

  const handleUnsubscribe = async () => {
    if (!token) return;
    setProcessing(true);
    try {
      const { data } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (data?.success) {
        setStatus("success");
      } else if (data?.reason === "already_unsubscribed") {
        setStatus("already_unsubscribed");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
    setProcessing(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <h1 className="editorial-heading text-2xl md:text-3xl mb-6">
          {lang === "it" ? "Gestione iscrizione" : "Email Preferences"}
        </h1>

        {status === "loading" && (
          <p className="text-muted-foreground">{lang === "it" ? "Verifica in corso..." : "Verifying..."}</p>
        )}

        {status === "valid" && (
          <div>
            <p className="text-muted-foreground mb-6">
              {lang === "it"
                ? "Vuoi disiscriverti dalle notifiche email?"
                : "Would you like to unsubscribe from email notifications?"}
            </p>
            <button
              onClick={handleUnsubscribe}
              disabled={processing}
              className="bg-primary text-primary-foreground px-6 py-3 text-sm font-sans font-medium hover:bg-navy-light transition-colors disabled:opacity-50"
            >
              {processing
                ? (lang === "it" ? "In corso..." : "Processing...")
                : (lang === "it" ? "Conferma discrizione" : "Confirm Unsubscribe")}
            </button>
          </div>
        )}

        {status === "success" && (
          <div>
            <p className="text-accent text-lg mb-4">✓</p>
            <p className="text-muted-foreground mb-6">
              {lang === "it"
                ? "Ti sei disiscritto con successo."
                : "You have been successfully unsubscribed."}
            </p>
          </div>
        )}

        {status === "already_unsubscribed" && (
          <p className="text-muted-foreground">
            {lang === "it" ? "Sei già disiscritto." : "You are already unsubscribed."}
          </p>
        )}

        {status === "invalid" && (
          <p className="text-muted-foreground">
            {lang === "it" ? "Link non valido o scaduto." : "Invalid or expired link."}
          </p>
        )}

        {status === "error" && (
          <p className="text-destructive">
            {lang === "it" ? "Si è verificato un errore. Riprova." : "An error occurred. Please try again."}
          </p>
        )}

        <Link to="/" className="inline-block mt-8 text-sm text-accent hover:text-foreground transition-colors">
          ← {lang === "it" ? "Torna alla home" : "Back to home"}
        </Link>
      </div>
    </div>
  );
};

export default Unsubscribe;
