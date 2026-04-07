import { useState } from "react";
import { Check } from "lucide-react";
import AppleShareIcon from "@/components/AppleShareIcon";
import { useI18n } from "@/lib/i18n";

interface ShareButtonProps {
  url?: string;
  title?: string;
  size?: number;
}

const ShareButton = ({ url, title, size = 18 }: ShareButtonProps) => {
  const { lang } = useI18n();
  const [copied, setCopied] = useState(false);
  const isIt = lang === "it";

  const handleShare = async () => {
    const shareUrl = url || window.location.href;
    
    if (navigator.share) {
      try {
        await navigator.share({ title: title || document.title, url: shareUrl });
        return;
      } catch {}
    }
    
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleShare}
      className="inline-flex items-center gap-1.5 text-sm font-sans text-muted-foreground hover:text-foreground transition-colors"
      title={isIt ? "Condividi" : "Share"}
    >
      {copied ? <Check size={size} /> : <AppleShareIcon size={size} />}
      <span>{copied ? (isIt ? "Copiato!" : "Copied!") : (isIt ? "Condividi" : "Share")}</span>
    </button>
  );
};

export default ShareButton;
