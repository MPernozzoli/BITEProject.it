export type EngagementNotificationFrequency =
  | "instant"
  | "daily"
  | "weekly"
  | "monthly"
  | "none";

export type ProfileNotificationPreferences = {
  like_notifications_frequency: EngagementNotificationFrequency;
  comment_notifications_frequency: EngagementNotificationFrequency;
};

export const DEFAULT_PROFILE_NOTIFICATION_PREFERENCES: ProfileNotificationPreferences = {
  like_notifications_frequency: "instant",
  comment_notifications_frequency: "instant",
};

export const ENGAGEMENT_NOTIFICATION_FREQUENCIES: EngagementNotificationFrequency[] = [
  "instant",
  "daily",
  "weekly",
  "monthly",
  "none",
];

export const normalizeEngagementNotificationFrequency = (
  value: unknown,
): EngagementNotificationFrequency => {
  switch (value) {
    case "instant":
    case "daily":
    case "weekly":
    case "monthly":
    case "none":
      return value;
    default:
      return "instant";
  }
};
