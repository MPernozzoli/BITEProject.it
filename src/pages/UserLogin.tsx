import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const UserLogin = () => {
  const [step, setStep] = useState<"email" | "verify">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as any)?.from || "/";

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate(redirectTo, { replace: true });
    });
  }, [navigate, redirectTo]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setStep("verify");
    setLoading(false);
  };

  const handleVerify = async () => {
    if (otp.length < 6) return;
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    navigate(redirectTo, { replace: true });
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="la-tua@email.com"
                className="w-full bg-transparent border border-border px-4 py-3 text-sm font-sans text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            {error && <p className="text-sm text-destructive text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading || !email.trim()}
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
              <p className="text-sm font-sans font-medium text-foreground">{email}</p>
            </div>

            <div className="flex justify-center">
              <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            {error && <p className="text-sm text-destructive text-center">{error}</p>}

            <button
              onClick={handleVerify}
              disabled={loading || otp.length < 6}
              className="w-full bg-primary text-primary-foreground px-8 py-3.5 text-sm font-sans font-medium tracking-wide hover:bg-navy-light transition-colors disabled:opacity-50"
            >
              {loading ? "..." : "Verifica"}
            </button>

            <button
              onClick={() => { setStep("email"); setOtp(""); setError(""); }}
              className="w-full text-xs font-sans text-muted-foreground hover:text-foreground transition-colors py-2"
            >
              ← Cambia email
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserLogin;
