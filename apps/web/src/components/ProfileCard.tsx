import { User } from "lucide-react";
import { Link } from "react-router-dom";
import ProfileAvatar from "@/components/ProfileAvatar";

interface ProfileCardProps {
  name: string;
  avatarUrl?: string;
  bio?: string;
  email?: string;
  size?: "sm" | "md" | "lg";
  showBio?: boolean;
  profileId?: string;
  onProfileClick?: (profileId: string) => void;
}

const sizeClasses = {
  sm: "w-8 h-8 text-xs",
  md: "w-12 h-12 text-sm",
  lg: "w-20 h-20 text-base",
};

/** Lato in CSS px di ogni taglia, per chiedere allo storage l'avatar giusto. */
const avatarPixels = { sm: 32, md: 48, lg: 80 } as const;

const ProfileCard = ({ name, avatarUrl, bio, size = "md", showBio = false, profileId, onProfileClick }: ProfileCardProps) => {
  const displayName = name || "Anonymous";

  return (
    <div className="flex items-center gap-3">
      <div className={`${sizeClasses[size]} glass-frame rounded-full flex items-center justify-center flex-shrink-0`}>
        <ProfileAvatar
          name={displayName}
          avatarUrl={avatarUrl}
          size={avatarPixels[size]}
          imgClassName="img-cover"
          fallback={<User className="text-muted-foreground" size={size === "sm" ? 14 : size === "md" ? 20 : 32} />}
        />
      </div>
      <div className="min-w-0">
        <p className={`font-sans font-medium truncate ${size === "sm" ? "text-xs" : size === "md" ? "text-sm" : "text-base"}`}>
          {profileId && onProfileClick ? (
            <button
              type="button"
              onClick={() => onProfileClick(profileId)}
              className="bg-transparent p-0 text-inherit hover:text-accent transition-colors text-left"
            >
              {displayName}
            </button>
          ) : profileId ? (
            <Link to={`/profile/${profileId}`} className="hover:text-accent transition-colors">
              {displayName}
            </Link>
          ) : (
            displayName
          )}
        </p>
        {showBio && bio && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{bio}</p>
        )}
      </div>
    </div>
  );
};

export default ProfileCard;
