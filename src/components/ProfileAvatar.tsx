import { type ReactNode, useEffect, useMemo, useState } from "react";
import { resolveProfileAvatarUrl } from "@/lib/profile-avatar";

interface ProfileAvatarProps {
  name: string;
  avatarUrl?: string | null;
  fallback: ReactNode;
  imgClassName?: string;
}

const ProfileAvatar = ({ name, avatarUrl, fallback, imgClassName }: ProfileAvatarProps) => {
  const src = useMemo(() => resolveProfileAvatarUrl(avatarUrl), [avatarUrl]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt={name}
      className={imgClassName || "w-full h-full object-cover"}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
};

export default ProfileAvatar;
