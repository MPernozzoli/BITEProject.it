import { useState } from "react";
import { Share2, Check } from "lucide-react";

interface ShareButtonProps {
  url?: string;
  title?: string;
  size?: number;
}

const ShareButton = ({ url, title, size = 18 }: ShareButtonProps) => {
  const [copied, setCopied] = useState(false);

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
      title="Share"
    >
      {copied ? <Check size={size} /> : <Share2 size={size} />}
      <span>{copied ? "Copied!" : "Share"}</span>
    </button>
  );
};

export default ShareButton;
