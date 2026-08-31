import { type ReactNode, useEffect, useMemo, useState } from "react";
import { resolveProfileAvatarUrl } from "@/lib/profile-avatar";
import { storageImageProps } from "@/lib/storage-image";

interface ProfileAvatarProps {
  name: string;
  avatarUrl?: string | null;
  fallback: ReactNode;
  imgClassName?: string;
  /**
   * Lato in CSS px a cui l'avatar viene mostrato: serve a chiedere allo storage
   * una copia di quella misura invece dell'originale (spesso 1024px e 1,5 MB).
   * Il default copre i casi comuni — navbar, firme, liste — fino a 48px.
   */
  size?: number;
}

const ProfileAvatar = ({ name, avatarUrl, fallback, imgClassName, size = 48 }: ProfileAvatarProps) => {
  const resolved = useMemo(() => resolveProfileAvatarUrl(avatarUrl), [avatarUrl]);
  const imgProps = useMemo(() => storageImageProps(resolved, size), [resolved, size]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolved]);

  if (!imgProps.src || failed) return <>{fallback}</>;

  return (
    <img
      {...imgProps}
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
