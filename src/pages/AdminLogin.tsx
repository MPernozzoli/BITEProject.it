import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const ADMIN_ACCOUNTS = [
  { name: "Site Admin", email: "hello@biteproject.it" },
  { name: "Massimo", email: "alexx.bear@hotmail.com" },
  { name: "Sami", email: "mpernozzoli@icloud.com" },
];

const AdminLogin = () => {
  const [step, setStep] = useState<"select" | "verify">("select");
  const [selectedAccount, setSelectedAccount] = useState<typeof ADMIN_ACCOUNTS[0] | null>(null);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/admin");
    });
  }, [navigate]);

  const handleSelectAccount = async (account: typeof ADMIN_ACCOUNTS[0]) => {
    setSelectedAccount(account);
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({ email: account.email });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setSent(true);
    setStep("verify");
    setLoading(false);
  };

  const handleVerify = async () => {
    if (!selectedAccount || otp.length < 6) return;
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.verifyOtp({
      email: selectedAccount.email,
      token: otp,
      type: "email",
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    navigate("/admin");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 pt-20">
      <div className="w-full max-w-sm">
        <h1 className="editorial-heading text-3xl mb-8 text-center">BITE Admin</h1>

        {step === "select" && (
          <div className="space-y-4">
            <p className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground text-center mb-6">
              Seleziona il tuo account
            </p>
            {ADMIN_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                onClick={() => handleSelectAccount(account)}
                disabled={loading}
                className="w-full text-left border border-border px-5 py-4 hover:border-accent transition-colors disabled:opacity-50 group"
              >
                <span className="block text-sm font-sans font-medium text-foreground group-hover:text-accent transition-colors">
                  {account.name}
                </span>
                <span className="block text-xs font-sans text-muted-foreground mt-1">
                  {account.email}
                </span>
              </button>
            ))}
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            {loading && (
              <p className="text-xs text-muted-foreground text-center animate-pulse">
                Invio codice in corso...
              </p>
            )}
          </div>
        )}

        {step === "verify" && selectedAccount && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <p className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground">
                Codice inviato a
              </p>
              <p className="text-sm font-sans font-medium text-foreground">
                {selectedAccount.email}
              </p>
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
              onClick={() => {
                setStep("select");
                setOtp("");
                setError("");
                setSent(false);
              }}
              className="w-full text-xs font-sans text-muted-foreground hover:text-foreground transition-colors py-2"
            >
              ← Torna alla selezione account
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminLogin;
