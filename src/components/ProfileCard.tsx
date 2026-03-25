import { User } from "lucide-react";

interface ProfileCardProps {
  name: string;
  avatarUrl?: string;
  bio?: string;
  email?: string;
  size?: "sm" | "md" | "lg";
  showBio?: boolean;
}

const sizeClasses = {
  sm: "w-8 h-8 text-xs",
  md: "w-12 h-12 text-sm",
  lg: "w-20 h-20 text-base",
};

const ProfileCard = ({ name, avatarUrl, bio, size = "md", showBio = false }: ProfileCardProps) => {
  return (
    <div className="flex items-center gap-3">
      <div className={`${sizeClasses[size]} rounded-full overflow-hidden bg-muted flex items-center justify-center flex-shrink-0`}>
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="img-cover" />
        ) : (
          <User className="text-muted-foreground" size={size === "sm" ? 14 : size === "md" ? 20 : 32} />
        )}
      </div>
      <div className="min-w-0">
        <p className={`font-sans font-medium truncate ${size === "sm" ? "text-xs" : size === "md" ? "text-sm" : "text-base"}`}>
          {name || "Anonymous"}
        </p>
        {showBio && bio && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{bio}</p>
        )}
      </div>
    </div>
  );
};

export default ProfileCard;
