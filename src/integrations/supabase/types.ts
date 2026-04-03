export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      article_authors: {
        Row: {
          article_id: string
          id: string
          profile_id: string
          role: string
        }
        Insert: {
          article_id: string
          id?: string
          profile_id: string
          role?: string
        }
        Update: {
          article_id?: string
          id?: string
          profile_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_authors_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "logbook_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_authors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_authors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_comments: {
        Row: {
          article_id: string
          content: string
          created_at: string
          id: string
          parent_id: string | null
          profile_id: string
          updated_at: string
        }
        Insert: {
          article_id: string
          content?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          profile_id: string
          updated_at?: string
        }
        Update: {
          article_id?: string
          content?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_comments_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "logbook_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "article_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_likes: {
        Row: {
          article_id: string
          created_at: string
          id: string
          profile_id: string
        }
        Insert: {
          article_id: string
          created_at?: string
          id?: string
          profile_id: string
        }
        Update: {
          article_id?: string
          created_at?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_likes_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "logbook_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_likes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_likes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_read_events: {
        Row: {
          article_id: string
          counted_at: string
          id: string
          profile_id: string | null
          visitor_key: string | null
        }
        Insert: {
          article_id: string
          counted_at?: string
          id?: string
          profile_id?: string | null
          visitor_key?: string | null
        }
        Update: {
          article_id?: string
          counted_at?: string
          id?: string
          profile_id?: string | null
          visitor_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "article_read_events_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "logbook_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_read_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_read_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_reads: {
        Row: {
          article_id: string
          id: string
          profile_id: string
          read_at: string
        }
        Insert: {
          article_id: string
          id?: string
          profile_id: string
          read_at?: string
        }
        Update: {
          article_id?: string
          id?: string
          profile_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_reads_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "logbook_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_tags: {
        Row: {
          article_id: string
          id: string
          tag_id: string
        }
        Insert: {
          article_id: string
          id?: string
          tag_id: string
        }
        Update: {
          article_id?: string
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_tags_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "logbook_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_likes: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          profile_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          profile_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "article_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_likes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_likes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_mentions: {
        Row: {
          comment_id: string
          id: string
          mentioned_article_id: string | null
          mentioned_profile_id: string | null
        }
        Insert: {
          comment_id: string
          id?: string
          mentioned_article_id?: string | null
          mentioned_profile_id?: string | null
        }
        Update: {
          comment_id?: string
          id?: string
          mentioned_article_id?: string | null
          mentioned_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comment_mentions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "article_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_mentions_mentioned_article_id_fkey"
            columns: ["mentioned_article_id"]
            isOneToOne: false
            referencedRelation: "logbook_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_mentions_mentioned_profile_id_fkey"
            columns: ["mentioned_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_mentions_mentioned_profile_id_fkey"
            columns: ["mentioned_profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_notification_preferences: {
        Row: {
          article_notifications_enabled: boolean
          comment_notifications_frequency: string
          created_at: string
          digest_enabled: boolean
          email: string
          like_notifications_frequency: string
          newsletter_enabled: boolean
          push_engagement_enabled: boolean
          push_publication_enabled: boolean
          story_notifications_enabled: boolean
          updated_at: string
        }
        Insert: {
          article_notifications_enabled?: boolean
          comment_notifications_frequency?: string
          created_at?: string
          digest_enabled?: boolean
          email: string
          like_notifications_frequency?: string
          newsletter_enabled?: boolean
          push_engagement_enabled?: boolean
          push_publication_enabled?: boolean
          story_notifications_enabled?: boolean
          updated_at?: string
        }
        Update: {
          article_notifications_enabled?: boolean
          comment_notifications_frequency?: string
          created_at?: string
          digest_enabled?: boolean
          email?: string
          like_notifications_frequency?: string
          newsletter_enabled?: boolean
          push_engagement_enabled?: boolean
          push_publication_enabled?: boolean
          story_notifications_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      engagement_notifications: {
        Row: {
          actor_profile_id: string | null
          article_id: string
          comment_id: string | null
          created_at: string
          emailed_at: string | null
          event_type: string
          id: string
          notification_category: string
          processed_at: string | null
          processing_note: string | null
          push_sent_at: string | null
          read_at: string | null
          recipient_profile_id: string
          source_record_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          article_id: string
          comment_id?: string | null
          created_at?: string
          emailed_at?: string | null
          event_type: string
          id?: string
          notification_category: string
          processed_at?: string | null
          processing_note?: string | null
          push_sent_at?: string | null
          read_at?: string | null
          recipient_profile_id: string
          source_record_id: string
        }
        Update: {
          actor_profile_id?: string | null
          article_id?: string
          comment_id?: string | null
          created_at?: string
          emailed_at?: string | null
          event_type?: string
          id?: string
          notification_category?: string
          processed_at?: string | null
          processing_note?: string | null
          push_sent_at?: string | null
          read_at?: string | null
          recipient_profile_id?: string
          source_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_notifications_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_notifications_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_notifications_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "logbook_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "article_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      logbook_articles: {
        Row: {
          article_map_scenes: Json | null
          category: string
          content_en: Json | null
          content_it: Json | null
          cover_focal_x: number
          cover_focal_y: number
          cover_image: string | null
          cover_zoom: number
          created_at: string
          excerpt_en: string | null
          excerpt_it: string | null
          id: string
          instagram_story_image_en: string | null
          instagram_story_image_it: string | null
          instagram_story_use_cover_en: boolean
          instagram_story_use_cover_it: boolean
          latitude: number | null
          location_name: string | null
          longitude: number | null
          published_at: string | null
          scheduled_at: string | null
          slug: string
          status: Database["public"]["Enums"]["article_status"]
          story_id: string | null
          title_en: string
          title_it: string
          updated_at: string
          view_count: number
          voyage_id: string | null
          voyage_segment_end: number | null
          voyage_segment_start: number | null
        }
        Insert: {
          article_map_scenes?: Json | null
          category?: string
          content_en?: Json | null
          content_it?: Json | null
          cover_focal_x?: number
          cover_focal_y?: number
          cover_image?: string | null
          cover_zoom?: number
          created_at?: string
          excerpt_en?: string | null
          excerpt_it?: string | null
          id?: string
          instagram_story_image_en?: string | null
          instagram_story_image_it?: string | null
          instagram_story_use_cover_en?: boolean
          instagram_story_use_cover_it?: boolean
          latitude?: number | null
          location_name?: string | null
          longitude?: number | null
          published_at?: string | null
          scheduled_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["article_status"]
          story_id?: string | null
          title_en?: string
          title_it?: string
          updated_at?: string
          view_count?: number
          voyage_id?: string | null
          voyage_segment_end?: number | null
          voyage_segment_start?: number | null
        }
        Update: {
          article_map_scenes?: Json | null
          category?: string
          content_en?: Json | null
          content_it?: Json | null
          cover_focal_x?: number
          cover_focal_y?: number
          cover_image?: string | null
          cover_zoom?: number
          created_at?: string
          excerpt_en?: string | null
          excerpt_it?: string | null
          id?: string
          instagram_story_image_en?: string | null
          instagram_story_image_it?: string | null
          instagram_story_use_cover_en?: boolean
          instagram_story_use_cover_it?: boolean
          latitude?: number | null
          location_name?: string | null
          longitude?: number | null
          published_at?: string | null
          scheduled_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["article_status"]
          story_id?: string | null
          title_en?: string
          title_it?: string
          updated_at?: string
          view_count?: number
          voyage_id?: string | null
          voyage_segment_end?: number | null
          voyage_segment_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "logbook_articles_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logbook_articles_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_confirmation_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          last_sent_at: string
          preferred_language: string | null
          profile_id: string | null
          source: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          last_sent_at?: string
          preferred_language?: string | null
          profile_id?: string | null
          source?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          last_sent_at?: string
          preferred_language?: string | null
          profile_id?: string | null
          source?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_confirmation_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_confirmation_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_subscribers: {
        Row: {
          created_at: string
          email: string
          id: string
          profile_id: string
          subscribed: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          profile_id: string
          subscribed?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          profile_id?: string
          subscribed?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_subscribers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_subscribers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_unsubscribe_feedback: {
        Row: {
          created_at: string
          email: string
          id: string
          message_context: Json | null
          profile_id: string | null
          reason_code: string | null
          reason_text: string | null
          source: string
          unsubscribe_scope: Json
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message_context?: Json | null
          profile_id?: string | null
          reason_code?: string | null
          reason_text?: string | null
          source?: string
          unsubscribe_scope?: Json
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message_context?: Json | null
          profile_id?: string | null
          reason_code?: string | null
          reason_text?: string | null
          source?: string
          unsubscribe_scope?: Json
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_unsubscribe_feedback_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_unsubscribe_feedback_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_badges: {
        Row: {
          awarded_at: string
          badge_icon: string | null
          badge_name: string
          id: string
          profile_id: string
        }
        Insert: {
          awarded_at?: string
          badge_icon?: string | null
          badge_name: string
          id?: string
          profile_id: string
        }
        Update: {
          awarded_at?: string
          badge_icon?: string | null
          badge_name?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_badges_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_badges_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          email: string
          id: string
          name: string
          preferred_language: string
          secondary_language: string | null
          social_facebook: string | null
          social_instagram: string | null
          social_linkedin: string | null
          social_seapeople: string | null
          social_tiktok: string | null
          social_website: string | null
          social_x: string | null
          social_youtube: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string
          id: string
          name?: string
          preferred_language?: string
          secondary_language?: string | null
          social_facebook?: string | null
          social_instagram?: string | null
          social_linkedin?: string | null
          social_seapeople?: string | null
          social_tiktok?: string | null
          social_website?: string | null
          social_x?: string | null
          social_youtube?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          preferred_language?: string
          secondary_language?: string | null
          social_facebook?: string | null
          social_instagram?: string | null
          social_linkedin?: string | null
          social_seapeople?: string | null
          social_tiktok?: string | null
          social_website?: string | null
          social_x?: string | null
          social_youtube?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          enabled: boolean
          endpoint: string
          expiration_time: string | null
          id: string
          last_seen_at: string
          p256dh: string
          profile_id: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          enabled?: boolean
          endpoint: string
          expiration_time?: string | null
          id?: string
          last_seen_at?: string
          p256dh: string
          profile_id: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          enabled?: boolean
          endpoint?: string
          expiration_time?: string | null
          id?: string
          last_seen_at?: string
          p256dh?: string
          profile_id?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      route_legs: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          id: string
          lat_end: number | null
          lat_start: number | null
          lng_end: number | null
          lng_start: number | null
          name: string
          nautical_miles: number | null
          sort_order: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          lat_end?: number | null
          lat_start?: number | null
          lng_end?: number | null
          lng_start?: number | null
          name?: string
          nautical_miles?: number | null
          sort_order?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          lat_end?: number | null
          lat_start?: number | null
          lng_end?: number | null
          lng_start?: number | null
          name?: string
          nautical_miles?: number | null
          sort_order?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      stories: {
        Row: {
          cover_image: string | null
          created_at: string
          description_en: string | null
          description_it: string | null
          id: string
          slug: string
          title_en: string
          title_it: string
          updated_at: string
        }
        Insert: {
          cover_image?: string | null
          created_at?: string
          description_en?: string | null
          description_it?: string | null
          id?: string
          slug: string
          title_en?: string
          title_it?: string
          updated_at?: string
        }
        Update: {
          cover_image?: string | null
          created_at?: string
          description_en?: string | null
          description_it?: string | null
          id?: string
          slug?: string
          title_en?: string
          title_it?: string
          updated_at?: string
        }
        Relationships: []
      }
      story_subscriptions: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          story_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          story_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_subscriptions_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_email_automations: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          key: string
          last_run_at: string | null
          last_sent_at: string | null
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          key: string
          last_run_at?: string | null
          last_sent_at?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          key?: string
          last_run_at?: string | null
          last_sent_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      voyage_waypoints: {
        Row: {
          created_at: string
          date_end: string | null
          date_start: string | null
          description_en: string | null
          description_it: string | null
          event_date: string | null
          event_time: string | null
          id: string
          lat: number
          lng: number
          media: Json
          name: string | null
          name_en: string | null
          name_it: string | null
          sort_order: number
          visibility_mode: string
          voyage_id: string
          waypoint_type: string
        }
        Insert: {
          created_at?: string
          date_end?: string | null
          date_start?: string | null
          description_en?: string | null
          description_it?: string | null
          event_date?: string | null
          event_time?: string | null
          id?: string
          lat?: number
          lng?: number
          media?: Json
          name?: string | null
          name_en?: string | null
          name_it?: string | null
          sort_order?: number
          visibility_mode?: string
          voyage_id: string
          waypoint_type?: string
        }
        Update: {
          created_at?: string
          date_end?: string | null
          date_start?: string | null
          description_en?: string | null
          description_it?: string | null
          event_date?: string | null
          event_time?: string | null
          id?: string
          lat?: number
          lng?: number
          media?: Json
          name?: string | null
          name_en?: string | null
          name_it?: string | null
          sort_order?: number
          visibility_mode?: string
          voyage_id?: string
          waypoint_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_waypoints_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyages: {
        Row: {
          cached_geometry: Json | null
          created_at: string
          description: string | null
          description_en: string | null
          description_it: string | null
          end_date: string | null
          end_time: string | null
          id: string
          is_published: boolean
          name: string
          name_en: string | null
          name_it: string | null
          sort_order: number
          start_date: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["voyage_status"]
          type: Database["public"]["Enums"]["voyage_type"]
          updated_at: string
        }
        Insert: {
          cached_geometry?: Json | null
          created_at?: string
          description?: string | null
          description_en?: string | null
          description_it?: string | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_published?: boolean
          name?: string
          name_en?: string | null
          name_it?: string | null
          sort_order?: number
          start_date?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["voyage_status"]
          type?: Database["public"]["Enums"]["voyage_type"]
          updated_at?: string
        }
        Update: {
          cached_geometry?: Json | null
          created_at?: string
          description?: string | null
          description_en?: string | null
          description_it?: string | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_published?: boolean
          name?: string
          name_en?: string | null
          name_it?: string | null
          sort_order?: number
          start_date?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["voyage_status"]
          type?: Database["public"]["Enums"]["voyage_type"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          id: string | null
          name: string | null
          preferred_language: string | null
          secondary_language: string | null
          social_facebook: string | null
          social_instagram: string | null
          social_linkedin: string | null
          social_seapeople: string | null
          social_tiktok: string | null
          social_website: string | null
          social_x: string | null
          social_youtube: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          preferred_language?: string | null
          secondary_language?: string | null
          social_facebook?: string | null
          social_instagram?: string | null
          social_linkedin?: string | null
          social_seapeople?: string | null
          social_tiktok?: string | null
          social_website?: string | null
          social_x?: string | null
          social_youtube?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          preferred_language?: string | null
          secondary_language?: string | null
          social_facebook?: string | null
          social_instagram?: string | null
          social_linkedin?: string | null
          social_seapeople?: string | null
          social_tiktok?: string | null
          social_website?: string | null
          social_x?: string | null
          social_youtube?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_article_view_count: {
        Args: { _article_id: string; _visitor_key?: string }
        Returns: number
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      article_status: "draft" | "scheduled" | "published"
      voyage_status: "planned" | "active" | "completed"
      voyage_type: "water" | "land"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      article_status: ["draft", "scheduled", "published"],
      voyage_status: ["planned", "active", "completed"],
      voyage_type: ["water", "land"],
    },
  },
} as const
