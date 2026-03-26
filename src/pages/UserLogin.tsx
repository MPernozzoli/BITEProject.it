import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const OTP_LENGTH = 8;
const normalizeEmail = (value: string) => value.trim().toLowerCase();

const UserLogin = () => {
  const [step, setStep] = useState<"email" | "verify">("email");
  const [emailInput, setEmailInput] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [rememberMe, setRememberMe] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as any)?.from || "/";

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate(redirectTo, { replace: true });
    });
  }, [navigate, redirectTo]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // If "remember me" is unchecked, sign out on tab/window close
  useEffect(() => {
    const flag = localStorage.getItem("bite_ephemeral_session");
    if (!flag) return;

    const handleUnload = () => {
      // navigator.sendBeacon can't call supabase, so we clear storage directly
      localStorage.removeItem("sb-vdflrzcmlipvtardannd-auth-token");
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  const sendOtp = useCallback(async () => {
    const email = normalizeEmail(emailInput);
    if (!email) return false;
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({ email });
    setLoading(false);
    if (error) {
      setError(error.message);
      return false;
    }
    setSubmittedEmail(email);
    setResendCooldown(30);
    return true;
  }, [emailInput]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await sendOtp();
    if (ok) {
      setOtp("");
      setStep("verify");
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setOtp("");
    setError("");
    await sendOtp();
  };

  const handleVerify = async () => {
    if (otp.length < OTP_LENGTH || !submittedEmail) return;
    setLoading(true);
    setError("");

    try {
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email: submittedEmail,
        token: otp,
        type: "recovery",
      });

      if (verifyError) {
        setError(verifyError.message);
        return;
      }

      // Handle "remember me" preference
      if (!rememberMe) {
        localStorage.setItem("bite_ephemeral_session", "true");
      } else {
        localStorage.removeItem("bite_ephemeral_session");
      }

      const session = verifyData?.session ?? (await supabase.auth.getSession()).data.session;

      if (!session) {
        setError("Sessione non pronta. Riprova tra un secondo.");
        return;
      }

      const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
        _user_id: session.user.id,
        _role: "admin",
      });

      if (roleError) {
        navigate(redirectTo, { replace: true });
        return;
      }

      navigate(redirectTo, { replace: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Errore durante la verifica";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 pt-20">
      <div className="w-full max-w-sm">
        <h1 className="editorial-heading text-3xl mb-2 text-center">Accedi</h1>
        <p className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground text-center mb-8">
          Entra nella community BITE
        </p>

        {step === "email" && (
          <form onSubmit={handleSendOtp} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-xs font-sans tracking-[0.15em] uppercase text-muted-foreground mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="la-tua@email.com"
                className="w-full bg-transparent border border-border px-4 py-3 text-sm font-sans text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-border accent-primary"
              />
              <span className="text-xs font-sans text-muted-foreground">Ricordami su questo dispositivo</span>
            </label>

            {error && <p className="text-sm text-destructive text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading || !normalizeEmail(emailInput)}
              className="w-full bg-primary text-primary-foreground px-8 py-3.5 text-sm font-sans font-medium tracking-wide hover:bg-navy-light transition-colors disabled:opacity-50"
            >
              {loading ? "Invio in corso..." : "Invia codice"}
            </button>
          </form>
        )}

        {step === "verify" && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <p className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground">
                Codice inviato a
              </p>
              <p className="text-sm font-sans font-medium text-foreground">{submittedEmail}</p>
            </div>

            <div className="flex justify-center">
              <InputOTP maxLength={OTP_LENGTH} value={otp} onChange={setOtp}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                  <InputOTPSlot index={6} />
                  <InputOTPSlot index={7} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            {error && (
              <div className="text-center space-y-2">
                <p className="text-sm text-destructive">{error}</p>
                <p className="text-xs text-muted-foreground">
                  Se fallisce, rinvia il codice e usa solo l'ultima email ricevuta.
                </p>
              </div>
            )}

            <button
              onClick={handleVerify}
              disabled={loading || otp.length < OTP_LENGTH}
              className="w-full bg-primary text-primary-foreground px-8 py-3.5 text-sm font-sans font-medium tracking-wide hover:bg-navy-light transition-colors disabled:opacity-50"
            >
              {loading ? "..." : "Verifica"}
            </button>

            <div className="flex items-center justify-between">
              <button
                onClick={() => { setStep("email"); setOtp(""); setError(""); }}
                className="text-xs font-sans text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                ← Cambia email
              </button>
              <button
                onClick={handleResend}
                disabled={resendCooldown > 0 || loading}
                className="text-xs font-sans text-muted-foreground hover:text-foreground transition-colors py-2 disabled:opacity-50"
              >
                {resendCooldown > 0 ? `Rinvia tra ${resendCooldown}s` : "Rinvia codice"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserLogin;
