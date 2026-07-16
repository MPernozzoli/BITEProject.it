import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Heart, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ProfileAvatar from "@/components/ProfileAvatar";
import { cn } from "@/lib/utils";

type NotificationRow = {
  id: string;
  recipient_profile_id: string;
  actor_profile_id: string | null;
  article_id: string;
  comment_id: string | null;
  event_type:
    | "article_liked"
    | "comment_liked"
    | "article_commented"
    | "comment_replied"
    | "article_published"
    | "story_article_published";
  notification_category: "like" | "comment" | "publication";
  created_at: string;
  read_at: string | null;
};

type ActorProfile = {
  id: string;
  name: string | null;
  avatar_url: string | null;
};

type ArticleRow = {
  id: string;
  slug: string;
  title_it: string | null;
  title_en: string | null;
};

type CommentRow = {
  id: string;
  content: string;
};

type NotificationItem = NotificationRow & {
  actor: ActorProfile | null;
  article: ArticleRow | null;
  comment: CommentRow | null;
};

interface ProfileNotificationsMenuProps {
  sessionUserId: string;
  lang: "it" | "en";
  open: boolean;
  onNavigate?: () => void;
  onUnreadChange?: (count: number) => void;
}

const MAX_ITEMS = 8;

const formatNotificationDate = (value: string, lang: "it" | "en") =>
  new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "it-IT", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const truncate = (value: string | null | undefined, maxLength = 120) => {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const ProfileNotificationsMenu = ({
  sessionUserId,
  lang,
  open,
  onNavigate,
  onUnreadChange,
}: ProfileNotificationsMenuProps) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadNotifications = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("engagement_notifications")
      .select(
        "id, recipient_profile_id, actor_profile_id, article_id, comment_id, event_type, notification_category, created_at, read_at",
      )
      .eq("recipient_profile_id", sessionUserId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS);

    if (error) {
      console.error("Notification load error:", error);
      setLoading(false);
      return;
    }

    const rows = (data || []) as NotificationRow[];
    const actorIds = [...new Set(rows.map((row) => row.actor_profile_id).filter(Boolean))] as string[];
    const articleIds = [...new Set(rows.map((row) => row.article_id))];
    const commentIds = [...new Set(rows.map((row) => row.comment_id).filter(Boolean))] as string[];

    const [{ data: actorRows }, { data: articleRows }, { data: commentRows }] = await Promise.all([
      actorIds.length
        ? supabase.from("public_profiles").select("id, name, avatar_url").in("id", actorIds)
        : Promise.resolve({ data: [] }),
      articleIds.length
        ? supabase.from("logbook_articles").select("id, slug, title_it, title_en").in("id", articleIds)
        : Promise.resolve({ data: [] }),
      commentIds.length
        ? supabase.from("article_comments").select("id, content").in("id", commentIds)
        : Promise.resolve({ data: [] }),
    ]);

    const actorMap = new Map((actorRows || []).map((row: ActorProfile) => [row.id, row]));
    const articleMap = new Map((articleRows || []).map((row: ArticleRow) => [row.id, row]));
    const commentMap = new Map((commentRows || []).map((row: CommentRow) => [row.id, row]));

    setNotifications(
      rows.map((row) => ({
        ...row,
        actor: row.actor_profile_id ? actorMap.get(row.actor_profile_id) || null : null,
        article: articleMap.get(row.article_id) || null,
        comment: row.comment_id ? commentMap.get(row.comment_id) || null : null,
      })),
    );
    setLoading(false);
  }, [sessionUserId]);

  useEffect(() => {
    if (!sessionUserId) return;
    void loadNotifications();
  }, [loadNotifications, sessionUserId]);

  useEffect(() => {
    if (!sessionUserId) return;

    const channel = supabase
      .channel(`engagement-notifications:${sessionUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "engagement_notifications",
          filter: `recipient_profile_id=eq.${sessionUserId}`,
        },
        () => {
          void loadNotifications();
        },
      )
      .subscribe();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadNotifications();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [loadNotifications, sessionUserId]);

  const unreadCount = useMemo(
    () => notifications.length,
    [notifications],
  );

  useEffect(() => {
    onUnreadChange?.(unreadCount);
  }, [onUnreadChange, unreadCount]);

  useEffect(() => {
    if (!open) return;
    void loadNotifications();
  }, [loadNotifications, open]);

  const markAsRead = async (notificationId: string) => {
    const readAt = new Date().toISOString();

    setNotifications((current) => current.filter((notification) => notification.id !== notificationId));

    const { error } = await supabase
      .from("engagement_notifications")
      .update({ read_at: readAt })
      .eq("id", notificationId)
      .eq("recipient_profile_id", sessionUserId);

    if (error) {
      console.error("Notification read update error:", error);
      void loadNotifications();
    }
  };

  const resolveTitle = (notification: NotificationItem) => {
    const fallback = lang === "en" ? "Article" : "Articolo";
    if (!notification.article) return fallback;
    return lang === "en"
      ? notification.article.title_en || notification.article.title_it || fallback
      : notification.article.title_it || notification.article.title_en || fallback;
  };

  const resolveMessage = (notification: NotificationItem) => {
    const actorName =
      notification.actor?.name?.trim() || (lang === "en" ? "Someone" : "Qualcuno");

    switch (notification.event_type) {
      case "article_liked":
        return lang === "en"
          ? `${actorName} liked your article`
          : `${actorName} ha messo like al tuo articolo`;
      case "comment_liked":
        return lang === "en"
          ? `${actorName} liked your comment`
          : `${actorName} ha messo like a un tuo commento`;
      case "article_commented":
        return lang === "en"
          ? `${actorName} commented on your article`
          : `${actorName} ha commentato il tuo articolo`;
      case "comment_replied":
        return lang === "en"
          ? `${actorName} replied to your comment`
          : `${actorName} ha risposto a un tuo commento`;
      case "article_published":
        return lang === "en"
          ? "A new article has been published"
          : "E stato pubblicato un nuovo articolo";
      case "story_article_published":
        return lang === "en"
          ? "A story you follow has a new chapter"
          : "Una storia che segui ha un nuovo capitolo";
    }
  };

  const resolveHref = (notification: NotificationItem) => {
    const articleSlug = notification.article?.slug;
    if (!articleSlug) return "/logbook";

    const params = new URLSearchParams({
      notification: notification.id,
    });

    if (notification.comment_id) {
      params.set("focus", "comment");
      params.set("comment", notification.comment_id);
    } else if (notification.notification_category === "like") {
      params.set("focus", "likes");
    }

    return `/logbook/${articleSlug}?${params.toString()}`;
  };

  const emptyLabel = lang === "en" ? "No notifications yet." : "Nessuna notifica al momento.";
  const loadingLabel = lang === "en" ? "Loading notifications..." : "Caricamento notifiche...";
  const titleLabel = lang === "en" ? "Notifications" : "Notifiche";

  return (
    <div className="px-1 py-1">
      <div className="px-3 pb-2 pt-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-sans uppercase tracking-[0.24em] text-muted-foreground">
            {titleLabel}
          </p>
          {unreadCount > 0 ? (
            <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-medium text-destructive-foreground">
              {unreadCount}
            </span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">{loadingLabel}</p>
      ) : notifications.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="max-h-[24rem] space-y-1 overflow-y-auto px-1 pb-1">
          {notifications.map((notification) => {
            const actorName =
              notification.actor?.name?.trim() || (lang === "en" ? "Someone" : "Qualcuno");
            const actorProfileHref = notification.actor ? `/profile/${notification.actor.id}` : null;

            return (
              <div
                key={notification.id}
                className={cn(
                  "rounded-[1.25rem] border px-3 py-3 transition-colors",
                  notification.read_at
                    ? "border-black/6 bg-white/55"
                    : "border-destructive/18 bg-destructive/5",
                )}
              >
                <div className="flex gap-3">
                  <div className="relative mt-0.5 h-10 w-10 overflow-hidden rounded-full border border-white/70 bg-white/80">
                    <ProfileAvatar
                      name={actorName}
                      avatarUrl={notification.actor?.avatar_url}
                      fallback={
                        <span className="flex h-full w-full items-center justify-center text-[11px] font-semibold">
                          {actorName.slice(0, 1).toUpperCase()}
                        </span>
                      }
                      imgClassName="h-10 w-10 rounded-full object-cover"
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-white text-accent shadow-sm">
                      {notification.notification_category === "like" ? (
                        <Heart size={10} className="text-red-500" />
                      ) : notification.notification_category === "publication" ? (
                        <Bell size={10} />
                      ) : (
                        <MessageCircle size={10} />
                      )}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <Link
                      to={resolveHref(notification)}
                      onClick={() => {
                        void markAsRead(notification.id);
                        onNavigate?.();
                      }}
                      className="block rounded-xl outline-none transition-colors hover:text-accent focus:text-accent"
                    >
                      <p className="text-sm font-medium leading-snug text-foreground">
                        {resolveMessage(notification)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {resolveTitle(notification)}
                      </p>
                      {notification.comment ? (
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground/90">
                          {truncate(notification.comment.content)}
                        </p>
                      ) : null}
                    </Link>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {actorProfileHref ? (
                        <Link
                          to={actorProfileHref}
                          onClick={() => {
                            void markAsRead(notification.id);
                            onNavigate?.();
                          }}
                          className="font-medium text-foreground/80 underline decoration-black/20 underline-offset-2 hover:text-accent"
                        >
                          {actorName}
                        </Link>
                      ) : null}
                      <span>{formatNotificationDate(notification.created_at, lang)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProfileNotificationsMenu;
