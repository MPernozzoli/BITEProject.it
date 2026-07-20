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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _migration_chunks: {
        Row: {
          chunk_idx: number
          data_b64: string
          file_name: string
        }
        Insert: {
          chunk_idx: number
          data_b64: string
          file_name: string
        }
        Update: {
          chunk_idx?: number
          data_b64?: string
          file_name?: string
        }
        Relationships: []
      }
      admin_email_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          profile_id: string
          source: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          profile_id: string
          source?: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          profile_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_email_aliases_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_email_aliases_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      article_read_events: {
        Row: {
          article_id: string
          counted_at: string
          dwell_ms: number | null
          id: string
          lang: string | null
          profile_id: string | null
          visitor_key: string | null
        }
        Insert: {
          article_id: string
          counted_at?: string
          dwell_ms?: number | null
          id?: string
          lang?: string | null
          profile_id?: string | null
          visitor_key?: string | null
        }
        Update: {
          article_id?: string
          counted_at?: string
          dwell_ms?: number | null
          id?: string
          lang?: string | null
          profile_id?: string | null
          visitor_key?: string | null
        }
        Relationships: []
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
      article_seo_optimizations: {
        Row: {
          article_id: string
          created_at: string
          description_en: string | null
          description_it: string | null
          error_message: string | null
          generated_at: string | null
          image_alt_en: string | null
          image_alt_it: string | null
          keywords_en: string[]
          keywords_it: string[]
          model: string | null
          raw_response: Json
          recommendations: Json
          social_description_en: string | null
          social_description_it: string | null
          social_title_en: string | null
          social_title_it: string | null
          source_hash: string | null
          status: string
          structured_data: Json
          title_en: string | null
          title_it: string | null
          updated_at: string
        }
        Insert: {
          article_id: string
          created_at?: string
          description_en?: string | null
          description_it?: string | null
          error_message?: string | null
          generated_at?: string | null
          image_alt_en?: string | null
          image_alt_it?: string | null
          keywords_en?: string[]
          keywords_it?: string[]
          model?: string | null
          raw_response?: Json
          recommendations?: Json
          social_description_en?: string | null
          social_description_it?: string | null
          social_title_en?: string | null
          social_title_it?: string | null
          source_hash?: string | null
          status?: string
          structured_data?: Json
          title_en?: string | null
          title_it?: string | null
          updated_at?: string
        }
        Update: {
          article_id?: string
          created_at?: string
          description_en?: string | null
          description_it?: string | null
          error_message?: string | null
          generated_at?: string | null
          image_alt_en?: string | null
          image_alt_it?: string | null
          keywords_en?: string[]
          keywords_it?: string[]
          model?: string | null
          raw_response?: Json
          recommendations?: Json
          social_description_en?: string | null
          social_description_it?: string | null
          social_title_en?: string | null
          social_title_it?: string | null
          source_hash?: string | null
          status?: string
          structured_data?: Json
          title_en?: string | null
          title_it?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_seo_optimizations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: true
            referencedRelation: "logbook_articles"
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
      bunq_api_contexts: {
        Row: {
          encrypted_context: string
          environment: string
          updated_at: string
        }
        Insert: {
          encrypted_context: string
          environment: string
          updated_at?: string
        }
        Update: {
          encrypted_context?: string
          environment?: string
          updated_at?: string
        }
        Relationships: []
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
      community_channels: {
        Row: {
          channel_order: number
          created_at: string
          description: string
          icon: string
          id: string
          is_active: boolean
          min_tier_id: string | null
          name: string
          slug: string
          updated_at: string
          visibility: Database["public"]["Enums"]["community_post_visibility"]
        }
        Insert: {
          channel_order?: number
          created_at?: string
          description?: string
          icon?: string
          id?: string
          is_active?: boolean
          min_tier_id?: string | null
          name: string
          slug: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["community_post_visibility"]
        }
        Update: {
          channel_order?: number
          created_at?: string
          description?: string
          icon?: string
          id?: string
          is_active?: boolean
          min_tier_id?: string | null
          name?: string
          slug?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["community_post_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "community_channels_min_tier_id_fkey"
            columns: ["min_tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      community_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          is_hidden: boolean
          linked_resources: Json
          parent_id: string | null
          post_id: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          linked_resources?: Json
          parent_id?: string | null
          post_id: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          linked_resources?: Json
          parent_id?: string | null
          post_id?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "community_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_live_event_reminders: {
        Row: {
          advance_email_sent_at: string | null
          advance_push_sent_at: string | null
          created_at: string
          id: string
          live_event_id: string
          profile_id: string
          remind_before_minutes: number
          start_email_sent_at: string | null
          start_push_sent_at: string | null
          updated_at: string
        }
        Insert: {
          advance_email_sent_at?: string | null
          advance_push_sent_at?: string | null
          created_at?: string
          id?: string
          live_event_id: string
          profile_id: string
          remind_before_minutes?: number
          start_email_sent_at?: string | null
          start_push_sent_at?: string | null
          updated_at?: string
        }
        Update: {
          advance_email_sent_at?: string | null
          advance_push_sent_at?: string | null
          created_at?: string
          id?: string
          live_event_id?: string
          profile_id?: string
          remind_before_minutes?: number
          start_email_sent_at?: string | null
          start_push_sent_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_live_event_reminders_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "community_live_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_live_event_reminders_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_live_event_reminders_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_live_events: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          livekit_mode: string
          livekit_room_name: string | null
          metadata: Json
          min_tier_id: string | null
          post_id: string | null
          starts_at: string
          title: string
          updated_at: string
          visibility: Database["public"]["Enums"]["community_post_visibility"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          livekit_mode?: string
          livekit_room_name?: string | null
          metadata?: Json
          min_tier_id?: string | null
          post_id?: string | null
          starts_at: string
          title: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["community_post_visibility"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          livekit_mode?: string
          livekit_room_name?: string | null
          metadata?: Json
          min_tier_id?: string | null
          post_id?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["community_post_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "community_live_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_live_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_live_events_min_tier_id_fkey"
            columns: ["min_tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_live_events_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      community_live_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          live_event_id: string
          profile_id: string
          status: Database["public"]["Enums"]["community_message_status"]
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          live_event_id: string
          profile_id: string
          status?: Database["public"]["Enums"]["community_message_status"]
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          live_event_id?: string
          profile_id?: string
          status?: Database["public"]["Enums"]["community_message_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_live_messages_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "community_live_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_live_messages_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_live_messages_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_poll_option_stats: {
        Row: {
          option_id: string
          poll_id: string
          updated_at: string
          votes_count: number
        }
        Insert: {
          option_id: string
          poll_id: string
          updated_at?: string
          votes_count?: number
        }
        Update: {
          option_id?: string
          poll_id?: string
          updated_at?: string
          votes_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "community_poll_option_stats_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: true
            referencedRelation: "community_poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_poll_option_stats_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "community_polls"
            referencedColumns: ["id"]
          },
        ]
      }
      community_poll_options: {
        Row: {
          created_at: string
          id: string
          label: string
          option_order: number
          poll_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          option_order?: number
          poll_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          option_order?: number
          poll_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "community_polls"
            referencedColumns: ["id"]
          },
        ]
      }
      community_poll_votes: {
        Row: {
          created_at: string
          id: string
          option_id: string
          poll_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          option_id: string
          poll_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          option_id?: string
          poll_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "community_poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_poll_votes_option_matches_poll"
            columns: ["poll_id", "option_id"]
            isOneToOne: false
            referencedRelation: "community_poll_options"
            referencedColumns: ["poll_id", "id"]
          },
          {
            foreignKeyName: "community_poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "community_polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_poll_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_poll_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_polls: {
        Row: {
          allow_multiple: boolean
          closes_at: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          is_published: boolean
          min_tier_id: string | null
          post_id: string | null
          question: string
          updated_at: string
          visibility: Database["public"]["Enums"]["community_post_visibility"]
        }
        Insert: {
          allow_multiple?: boolean
          closes_at?: string | null
          created_at?: string
          created_by: string
          description?: string
          id?: string
          is_published?: boolean
          min_tier_id?: string | null
          post_id?: string | null
          question: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["community_post_visibility"]
        }
        Update: {
          allow_multiple?: boolean
          closes_at?: string | null
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          is_published?: boolean
          min_tier_id?: string | null
          post_id?: string | null
          question?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["community_post_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "community_polls_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_polls_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_polls_min_tier_id_fkey"
            columns: ["min_tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_polls_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      community_post_authors: {
        Row: {
          author_order: number
          created_at: string
          post_id: string
          profile_id: string
        }
        Insert: {
          author_order?: number
          created_at?: string
          post_id: string
          profile_id: string
        }
        Update: {
          author_order?: number
          created_at?: string
          post_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_post_authors_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_post_authors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_post_authors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          author_profile_id: string
          channel_id: string | null
          content_en: Json
          content_it: Json
          cover_image: string | null
          created_at: string
          excerpt_en: string
          excerpt_it: string
          external_url: string | null
          id: string
          linked_resources: Json
          live_ends_at: string | null
          live_starts_at: string | null
          media_urls: Json
          metadata: Json
          min_tier_id: string | null
          post_type: string
          published_at: string | null
          slug: string
          status: Database["public"]["Enums"]["community_post_status"]
          title_en: string
          title_it: string
          updated_at: string
          visibility: Database["public"]["Enums"]["community_post_visibility"]
        }
        Insert: {
          author_profile_id: string
          channel_id?: string | null
          content_en?: Json
          content_it?: Json
          cover_image?: string | null
          created_at?: string
          excerpt_en?: string
          excerpt_it?: string
          external_url?: string | null
          id?: string
          linked_resources?: Json
          live_ends_at?: string | null
          live_starts_at?: string | null
          media_urls?: Json
          metadata?: Json
          min_tier_id?: string | null
          post_type?: string
          published_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["community_post_status"]
          title_en?: string
          title_it?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["community_post_visibility"]
        }
        Update: {
          author_profile_id?: string
          channel_id?: string | null
          content_en?: Json
          content_it?: Json
          cover_image?: string | null
          created_at?: string
          excerpt_en?: string
          excerpt_it?: string
          external_url?: string | null
          id?: string
          linked_resources?: Json
          live_ends_at?: string | null
          live_starts_at?: string | null
          media_urls?: Json
          metadata?: Json
          min_tier_id?: string | null
          post_type?: string
          published_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["community_post_status"]
          title_en?: string
          title_it?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["community_post_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "community_posts_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_posts_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_posts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "community_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_posts_min_tier_id_fkey"
            columns: ["min_tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      community_reactions: {
        Row: {
          comment_id: string | null
          created_at: string
          id: string
          post_id: string | null
          profile_id: string
          reaction: string
        }
        Insert: {
          comment_id?: string | null
          created_at?: string
          id?: string
          post_id?: string | null
          profile_id: string
          reaction?: string
        }
        Update: {
          comment_id?: string | null
          created_at?: string
          id?: string
          post_id?: string | null
          profile_id?: string
          reaction?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "community_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_media_assets: {
        Row: {
          created_at: string
          editorial_type:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
          id: string
          status: string
          storage_main_path: string | null
          synopsis: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          editorial_type?:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
          id?: string
          status?: string
          storage_main_path?: string | null
          synopsis?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          editorial_type?:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
          id?: string
          status?: string
          storage_main_path?: string | null
          synopsis?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      editorial_plan_channels: {
        Row: {
          code: string
          horizon_weeks: number
          id: string
          label: string
          mix_pillar: number
          mix_support: number
          mix_utility: number
          timezone: string
          updated_at: string
          weekly_count: number
        }
        Insert: {
          code: string
          horizon_weeks?: number
          id: string
          label: string
          mix_pillar?: number
          mix_support?: number
          mix_utility?: number
          timezone?: string
          updated_at?: string
          weekly_count?: number
        }
        Update: {
          code?: string
          horizon_weeks?: number
          id?: string
          label?: string
          mix_pillar?: number
          mix_support?: number
          mix_utility?: number
          timezone?: string
          updated_at?: string
          weekly_count?: number
        }
        Relationships: []
      }
      editorial_plan_settings: {
        Row: {
          horizon_weeks: number
          id: string
          mix_pillar: number
          mix_support: number
          mix_utility: number
          timezone: string
          updated_at: string
          weekly_count: number
        }
        Insert: {
          horizon_weeks?: number
          id?: string
          mix_pillar?: number
          mix_support?: number
          mix_utility?: number
          timezone?: string
          updated_at?: string
          weekly_count?: number
        }
        Update: {
          horizon_weeks?: number
          id?: string
          mix_pillar?: number
          mix_support?: number
          mix_utility?: number
          timezone?: string
          updated_at?: string
          weekly_count?: number
        }
        Relationships: []
      }
      editorial_plan_slots: {
        Row: {
          assigned_article_id: string | null
          channel_id: string
          content_format: string | null
          counts_toward_mix: boolean
          created_at: string
          id: string
          notes: string | null
          override_type:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
          slot_date: string
          slot_time: string
          status: string
          suggested_type:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_article_id?: string | null
          channel_id: string
          content_format?: string | null
          counts_toward_mix?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          override_type?:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
          slot_date: string
          slot_time: string
          status?: string
          suggested_type?:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_article_id?: string | null
          channel_id?: string
          content_format?: string | null
          counts_toward_mix?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          override_type?:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
          slot_date?: string
          slot_time?: string
          status?: string
          suggested_type?:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_plan_slots_assigned_article_id_fkey"
            columns: ["assigned_article_id"]
            isOneToOne: false
            referencedRelation: "logbook_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_plan_slots_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "editorial_plan_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_plan_slots_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "editorial_plan_weekly_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_plan_weekly_slots: {
        Row: {
          channel_id: string
          content_format: string | null
          created_at: string
          day_of_week: number
          id: string
          sort_order: number
          time_of_day: string
        }
        Insert: {
          channel_id: string
          content_format?: string | null
          created_at?: string
          day_of_week: number
          id?: string
          sort_order?: number
          time_of_day: string
        }
        Update: {
          channel_id?: string
          content_format?: string | null
          created_at?: string
          day_of_week?: number
          id?: string
          sort_order?: number
          time_of_day?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_plan_weekly_slots_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "editorial_plan_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_post_insights: {
        Row: {
          captured_at: string
          clicks: number
          comments: number
          created_at: string
          follows: number
          id: string
          impressions: number
          likes: number
          notes: string | null
          reach: number
          saves: number
          sentiment: string | null
          shares: number
          source: string
          target_id: string
          updated_at: string
          views: number
        }
        Insert: {
          captured_at?: string
          clicks?: number
          comments?: number
          created_at?: string
          follows?: number
          id?: string
          impressions?: number
          likes?: number
          notes?: string | null
          reach?: number
          saves?: number
          sentiment?: string | null
          shares?: number
          source?: string
          target_id: string
          updated_at?: string
          views?: number
        }
        Update: {
          captured_at?: string
          clicks?: number
          comments?: number
          created_at?: string
          follows?: number
          id?: string
          impressions?: number
          likes?: number
          notes?: string | null
          reach?: number
          saves?: number
          sentiment?: string | null
          shares?: number
          source?: string
          target_id?: string
          updated_at?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "editorial_post_insights_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "editorial_publish_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_publish_targets: {
        Row: {
          asset_id: string | null
          caption: string | null
          channel_id: string
          content_format: string
          created_at: string
          editorial_plan_slot_id: string | null
          id: string
          last_error: string | null
          metrics_synced_at: string | null
          platform_permalink: string | null
          platform_post_id: string | null
          publish_at: string | null
          published_at: string | null
          status: string
          syndication_batch_id: string | null
          title_override: string | null
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          caption?: string | null
          channel_id: string
          content_format: string
          created_at?: string
          editorial_plan_slot_id?: string | null
          id?: string
          last_error?: string | null
          metrics_synced_at?: string | null
          platform_permalink?: string | null
          platform_post_id?: string | null
          publish_at?: string | null
          published_at?: string | null
          status?: string
          syndication_batch_id?: string | null
          title_override?: string | null
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          caption?: string | null
          channel_id?: string
          content_format?: string
          created_at?: string
          editorial_plan_slot_id?: string | null
          id?: string
          last_error?: string | null
          metrics_synced_at?: string | null
          platform_permalink?: string | null
          platform_post_id?: string | null
          publish_at?: string | null
          published_at?: string | null
          status?: string
          syndication_batch_id?: string | null
          title_override?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_publish_targets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "editorial_media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_publish_targets_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "editorial_plan_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_publish_targets_editorial_plan_slot_id_fkey"
            columns: ["editorial_plan_slot_id"]
            isOneToOne: false
            referencedRelation: "editorial_plan_slots"
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
          push_mail_enabled: boolean
          push_publication_enabled: boolean
          push_voyage_admin_enabled: boolean
          push_voyage_user_enabled: boolean
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
          push_mail_enabled?: boolean
          push_publication_enabled?: boolean
          push_voyage_admin_enabled?: boolean
          push_voyage_user_enabled?: boolean
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
          push_mail_enabled?: boolean
          push_publication_enabled?: boolean
          push_voyage_admin_enabled?: boolean
          push_voyage_user_enabled?: boolean
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
      email_spam_senders: {
        Row: {
          address: string
          created_at: string
          id: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      email_tracking_events: {
        Row: {
          brand: string | null
          created_at: string
          event_type: string
          from_address: string | null
          id: string
          metadata: Json
          resend_email_id: string
          subject: string | null
          to_address: string | null
        }
        Insert: {
          brand?: string | null
          created_at?: string
          event_type: string
          from_address?: string | null
          id?: string
          metadata?: Json
          resend_email_id: string
          subject?: string | null
          to_address?: string | null
        }
        Update: {
          brand?: string | null
          created_at?: string
          event_type?: string
          from_address?: string | null
          id?: string
          metadata?: Json
          resend_email_id?: string
          subject?: string | null
          to_address?: string | null
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
      inbound_emails: {
        Row: {
          archived: boolean
          assigned_to_profile_id: string | null
          assignment_reason: string | null
          attachments: Json
          brand: string
          created_at: string
          from_address: string
          from_name: string | null
          headers: Json
          html_body: string | null
          id: string
          in_reply_to: string | null
          message_id: string | null
          push_notified_at: string | null
          read: boolean
          references: string[]
          resend_email_id: string | null
          spam: boolean
          starred: boolean
          subject: string
          text_body: string | null
          thread_key: string | null
          to_addresses: string[]
        }
        Insert: {
          archived?: boolean
          assigned_to_profile_id?: string | null
          assignment_reason?: string | null
          attachments?: Json
          brand?: string
          created_at?: string
          from_address: string
          from_name?: string | null
          headers?: Json
          html_body?: string | null
          id?: string
          in_reply_to?: string | null
          message_id?: string | null
          push_notified_at?: string | null
          read?: boolean
          references?: string[]
          resend_email_id?: string | null
          spam?: boolean
          starred?: boolean
          subject?: string
          text_body?: string | null
          thread_key?: string | null
          to_addresses?: string[]
        }
        Update: {
          archived?: boolean
          assigned_to_profile_id?: string | null
          assignment_reason?: string | null
          attachments?: Json
          brand?: string
          created_at?: string
          from_address?: string
          from_name?: string | null
          headers?: Json
          html_body?: string | null
          id?: string
          in_reply_to?: string | null
          message_id?: string | null
          push_notified_at?: string | null
          read?: boolean
          references?: string[]
          resend_email_id?: string | null
          spam?: boolean
          starred?: boolean
          subject?: string
          text_body?: string | null
          thread_key?: string | null
          to_addresses?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "inbound_emails_assigned_to_profile_id_fkey"
            columns: ["assigned_to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_emails_assigned_to_profile_id_fkey"
            columns: ["assigned_to_profile_id"]
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
          editorial_type:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
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
          slug_en: string | null
          slug_it: string | null
          status: Database["public"]["Enums"]["article_status"]
          story_id: string | null
          title_en: string
          title_it: string
          updated_at: string
          view_count: number
          voyage_id: string | null
          voyage_segment_end: number | null
          voyage_segment_start: number | null
          voyage_waypoint_end_id: string | null
          voyage_waypoint_start_id: string | null
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
          editorial_type?:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
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
          slug_en?: string | null
          slug_it?: string | null
          status?: Database["public"]["Enums"]["article_status"]
          story_id?: string | null
          title_en?: string
          title_it?: string
          updated_at?: string
          view_count?: number
          voyage_id?: string | null
          voyage_segment_end?: number | null
          voyage_segment_start?: number | null
          voyage_waypoint_end_id?: string | null
          voyage_waypoint_start_id?: string | null
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
          editorial_type?:
            | Database["public"]["Enums"]["article_editorial_type"]
            | null
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
          slug_en?: string | null
          slug_it?: string | null
          status?: Database["public"]["Enums"]["article_status"]
          story_id?: string | null
          title_en?: string
          title_it?: string
          updated_at?: string
          view_count?: number
          voyage_id?: string | null
          voyage_segment_end?: number | null
          voyage_segment_start?: number | null
          voyage_waypoint_end_id?: string | null
          voyage_waypoint_start_id?: string | null
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
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "logbook_articles_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logbook_articles_voyage_waypoint_end_id_fkey"
            columns: ["voyage_waypoint_end_id"]
            isOneToOne: false
            referencedRelation: "voyage_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logbook_articles_voyage_waypoint_start_id_fkey"
            columns: ["voyage_waypoint_start_id"]
            isOneToOne: false
            referencedRelation: "voyage_waypoints"
            referencedColumns: ["id"]
          },
        ]
      }
      logbook_map_markers: {
        Row: {
          description_en: string | null
          description_it: string | null
          id: string
          is_onboard: boolean
          is_visible: boolean
          label_en: string
          label_it: string
          latitude: number | null
          longitude: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          description_en?: string | null
          description_it?: string | null
          id: string
          is_onboard?: boolean
          is_visible?: boolean
          label_en: string
          label_it: string
          latitude?: number | null
          longitude?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          description_en?: string | null
          description_it?: string | null
          id?: string
          is_onboard?: boolean
          is_visible?: boolean
          label_en?: string
          label_it?: string
          latitude?: number | null
          longitude?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logbook_map_markers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logbook_map_markers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      logbook_photo_points: {
        Row: {
          coordinates_source: string
          created_at: string
          created_by: string | null
          description_en: string | null
          description_it: string | null
          height: number | null
          id: string
          is_published: boolean
          lat: number
          lng: number
          sort_order: number
          storage_path: string
          taken_at: string
          title_en: string
          title_it: string
          updated_at: string
          voyage_id: string | null
          voyage_is_manual: boolean
          width: number | null
        }
        Insert: {
          coordinates_source?: string
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_it?: string | null
          height?: number | null
          id?: string
          is_published?: boolean
          lat: number
          lng: number
          sort_order?: number
          storage_path: string
          taken_at: string
          title_en: string
          title_it: string
          updated_at?: string
          voyage_id?: string | null
          voyage_is_manual?: boolean
          width?: number | null
        }
        Update: {
          coordinates_source?: string
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_it?: string | null
          height?: number | null
          id?: string
          is_published?: boolean
          lat?: number
          lng?: number
          sort_order?: number
          storage_path?: string
          taken_at?: string
          title_en?: string
          title_it?: string
          updated_at?: string
          voyage_id?: string | null
          voyage_is_manual?: boolean
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "logbook_photo_points_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logbook_photo_points_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logbook_photo_points_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "logbook_photo_points_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_benefit_events: {
        Row: {
          benefit_key: string
          created_at: string
          id: string
          profile_id: string
          subscription_id: string | null
          target_id: string | null
          target_type: string
          value: Json
        }
        Insert: {
          benefit_key: string
          created_at?: string
          id?: string
          profile_id: string
          subscription_id?: string | null
          target_id?: string | null
          target_type: string
          value?: Json
        }
        Update: {
          benefit_key?: string
          created_at?: string
          id?: string
          profile_id?: string
          subscription_id?: string | null
          target_id?: string | null
          target_type?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "membership_benefit_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_benefit_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_benefit_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "membership_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_payments: {
        Row: {
          amount_cents: number
          bunq_request_id: number | null
          created_at: string
          currency: string
          environment: string
          id: string
          metadata: Json
          paid_at: string | null
          payment_method: string
          period_count: number
          period_end: string | null
          period_start: string
          profile_id: string
          reference: string
          share_url: string | null
          status: Database["public"]["Enums"]["membership_payment_status"]
          subscription_id: string | null
          tier_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          bunq_request_id?: number | null
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          metadata?: Json
          paid_at?: string | null
          payment_method?: string
          period_count?: number
          period_end?: string | null
          period_start?: string
          profile_id: string
          reference: string
          share_url?: string | null
          status?: Database["public"]["Enums"]["membership_payment_status"]
          subscription_id?: string | null
          tier_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          bunq_request_id?: number | null
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          metadata?: Json
          paid_at?: string | null
          payment_method?: string
          period_count?: number
          period_end?: string | null
          period_start?: string
          profile_id?: string
          reference?: string
          share_url?: string | null
          status?: Database["public"]["Enums"]["membership_payment_status"]
          subscription_id?: string | null
          tier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_payments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_payments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "membership_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_payments_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string
          expired_reminder_sent_at: string | null
          grace_period_end: string | null
          id: string
          metadata: Json
          profile_id: string
          renewal_reminder_sent_at: string | null
          status: Database["public"]["Enums"]["membership_subscription_status"]
          tier_id: string
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          expired_reminder_sent_at?: string | null
          grace_period_end?: string | null
          id?: string
          metadata?: Json
          profile_id: string
          renewal_reminder_sent_at?: string | null
          status?: Database["public"]["Enums"]["membership_subscription_status"]
          tier_id: string
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          expired_reminder_sent_at?: string | null
          grace_period_end?: string | null
          id?: string
          metadata?: Json
          profile_id?: string
          renewal_reminder_sent_at?: string | null
          status?: Database["public"]["Enums"]["membership_subscription_status"]
          tier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_subscriptions_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_tiers: {
        Row: {
          benefits: Json
          billing_interval: string
          created_at: string
          currency: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          price_cents: number
          renewal_policy: string
          slug: string
          sort_label: string | null
          tier_family: string
          tier_order: number
          updated_at: string
        }
        Insert: {
          benefits?: Json
          billing_interval?: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          price_cents: number
          renewal_policy?: string
          slug: string
          sort_label?: string | null
          tier_family: string
          tier_order: number
          updated_at?: string
        }
        Update: {
          benefits?: Json
          billing_interval?: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price_cents?: number
          renewal_policy?: string
          slug?: string
          sort_label?: string | null
          tier_family?: string
          tier_order?: number
          updated_at?: string
        }
        Relationships: []
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
      observation_device_keys: {
        Row: {
          created_at: string
          device_id: string
          key_hash: string
          last_used_at: string | null
        }
        Insert: {
          created_at?: string
          device_id: string
          key_hash: string
          last_used_at?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string
          key_hash?: string
          last_used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "observation_device_keys_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "observation_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      observation_devices: {
        Row: {
          code: string
          created_at: string
          description: string | null
          firmware: string | null
          id: string
          is_active: boolean
          label: string
          model: string | null
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          firmware?: string | null
          id?: string
          is_active?: boolean
          label: string
          model?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          firmware?: string | null
          id?: string
          is_active?: boolean
          label?: string
          model?: string | null
        }
        Relationships: []
      }
      observation_measurements: {
        Row: {
          id: string
          observation_id: string
          parameter_code: string
          qc_flag: number
          value: number | null
          value_text: string | null
        }
        Insert: {
          id?: string
          observation_id: string
          parameter_code: string
          qc_flag?: number
          value?: number | null
          value_text?: string | null
        }
        Update: {
          id?: string
          observation_id?: string
          parameter_code?: string
          qc_flag?: number
          value?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "observation_measurements_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observation_measurements_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["observation_id"]
          },
          {
            foreignKeyName: "observation_measurements_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "observations_map"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observation_measurements_parameter_code_fkey"
            columns: ["parameter_code"]
            isOneToOne: false
            referencedRelation: "observation_parameters"
            referencedColumns: ["code"]
          },
        ]
      }
      observation_parameters: {
        Row: {
          accuracy: string | null
          code: string
          color_ramp: string
          created_at: string
          description_en: string | null
          description_it: string | null
          is_published: boolean
          label_en: string
          label_it: string | null
          limitations_en: string | null
          limitations_it: string | null
          method_en: string | null
          method_it: string | null
          scale_max: number | null
          scale_min: number | null
          sort_order: number
          unit: string
          unit_code: string
          updated_at: string
          value_type: string
        }
        Insert: {
          accuracy?: string | null
          code: string
          color_ramp?: string
          created_at?: string
          description_en?: string | null
          description_it?: string | null
          is_published?: boolean
          label_en: string
          label_it?: string | null
          limitations_en?: string | null
          limitations_it?: string | null
          method_en?: string | null
          method_it?: string | null
          scale_max?: number | null
          scale_min?: number | null
          sort_order?: number
          unit: string
          unit_code: string
          updated_at?: string
          value_type?: string
        }
        Update: {
          accuracy?: string | null
          code?: string
          color_ramp?: string
          created_at?: string
          description_en?: string | null
          description_it?: string | null
          is_published?: boolean
          label_en?: string
          label_it?: string | null
          limitations_en?: string | null
          limitations_it?: string | null
          method_en?: string | null
          method_it?: string | null
          scale_max?: number | null
          scale_min?: number | null
          sort_order?: number
          unit?: string
          unit_code?: string
          updated_at?: string
          value_type?: string
        }
        Relationships: []
      }
      observations: {
        Row: {
          created_at: string
          depth_m: number | null
          device_id: string | null
          gps_accuracy_m: number | null
          id: string
          is_published: boolean
          lat: number
          lng: number
          notes: string | null
          qc_flag: number
          recorded_at: string
          source: string
          voyage_id: string | null
        }
        Insert: {
          created_at?: string
          depth_m?: number | null
          device_id?: string | null
          gps_accuracy_m?: number | null
          id?: string
          is_published?: boolean
          lat: number
          lng: number
          notes?: string | null
          qc_flag?: number
          recorded_at: string
          source?: string
          voyage_id?: string | null
        }
        Update: {
          created_at?: string
          depth_m?: number | null
          device_id?: string | null
          gps_accuracy_m?: number | null
          id?: string
          is_published?: boolean
          lat?: number
          lng?: number
          notes?: string | null
          qc_flag?: number
          recorded_at?: string
          source?: string
          voyage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "observations_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "observation_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "observations_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      pack_gallery_photos: {
        Row: {
          alt: string
          category: string
          created_at: string
          created_by: string | null
          height: number | null
          id: string
          is_published: boolean
          sort_order: number
          storage_path: string
          updated_at: string
          width: number | null
        }
        Insert: {
          alt?: string
          category?: string
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          is_published?: boolean
          sort_order?: number
          storage_path: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          alt?: string
          category?: string
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          is_published?: boolean
          sort_order?: number
          storage_path?: string
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pack_gallery_photos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_gallery_photos_created_by_fkey"
            columns: ["created_by"]
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
      sent_emails: {
        Row: {
          attachments: Json
          bcc_addresses: string[]
          brand: string
          cc_addresses: string[]
          created_at: string
          from_address: string
          from_name: string | null
          html_body: string | null
          id: string
          in_reply_to: string | null
          message_id: string | null
          references: string[]
          resend_message_id: string | null
          sent_by_name: string | null
          sent_by_user_id: string | null
          status: string
          subject: string
          text_body: string | null
          thread_key: string | null
          to_addresses: string[]
        }
        Insert: {
          attachments?: Json
          bcc_addresses?: string[]
          brand?: string
          cc_addresses?: string[]
          created_at?: string
          from_address: string
          from_name?: string | null
          html_body?: string | null
          id?: string
          in_reply_to?: string | null
          message_id?: string | null
          references?: string[]
          resend_message_id?: string | null
          sent_by_name?: string | null
          sent_by_user_id?: string | null
          status?: string
          subject?: string
          text_body?: string | null
          thread_key?: string | null
          to_addresses?: string[]
        }
        Update: {
          attachments?: Json
          bcc_addresses?: string[]
          brand?: string
          cc_addresses?: string[]
          created_at?: string
          from_address?: string
          from_name?: string | null
          html_body?: string | null
          id?: string
          in_reply_to?: string | null
          message_id?: string | null
          references?: string[]
          resend_message_id?: string | null
          sent_by_name?: string | null
          sent_by_user_id?: string | null
          status?: string
          subject?: string
          text_body?: string | null
          thread_key?: string | null
          to_addresses?: string[]
        }
        Relationships: []
      }
      social_oauth_connections: {
        Row: {
          access_token_expires_at: string | null
          account_label: string | null
          channel_id: string
          created_at: string
          id: string
          provider: string
          refresh_token_encrypted: string | null
          scopes: string | null
          updated_at: string
        }
        Insert: {
          access_token_expires_at?: string | null
          account_label?: string | null
          channel_id: string
          created_at?: string
          id?: string
          provider: string
          refresh_token_encrypted?: string | null
          scopes?: string | null
          updated_at?: string
        }
        Update: {
          access_token_expires_at?: string | null
          account_label?: string | null
          channel_id?: string
          created_at?: string
          id?: string
          provider?: string
          refresh_token_encrypted?: string | null
          scopes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_oauth_connections_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: true
            referencedRelation: "editorial_plan_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      spritz_easter_egg_discoveries: {
        Row: {
          discovered_at: string
          id: string
          last_played_at: string
          play_count: number
          user_id: string | null
          visitor_key: string | null
        }
        Insert: {
          discovered_at?: string
          id?: string
          last_played_at?: string
          play_count?: number
          user_id?: string | null
          visitor_key?: string | null
        }
        Update: {
          discovered_at?: string
          id?: string
          last_played_at?: string
          play_count?: number
          user_id?: string | null
          visitor_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spritz_easter_egg_discoveries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spritz_easter_egg_discoveries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stories: {
        Row: {
          cover_image: string | null
          created_at: string
          description_en: string | null
          description_it: string | null
          id: string
          slug: string
          slug_en: string | null
          slug_it: string | null
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
          slug_en?: string | null
          slug_it?: string | null
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
          slug_en?: string | null
          slug_it?: string | null
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
      voyage_availability_notifications: {
        Row: {
          emailed_at: string | null
          error_message: string | null
          event_type: string
          failed_at: string | null
          id: string
          leg_ids: string[]
          metadata: Json
          processed_at: string | null
          queued_at: string
          recipient_profile_id: string
          voyage_id: string
          watch_id: string
        }
        Insert: {
          emailed_at?: string | null
          error_message?: string | null
          event_type: string
          failed_at?: string | null
          id?: string
          leg_ids?: string[]
          metadata?: Json
          processed_at?: string | null
          queued_at?: string
          recipient_profile_id: string
          voyage_id: string
          watch_id: string
        }
        Update: {
          emailed_at?: string | null
          error_message?: string | null
          event_type?: string
          failed_at?: string | null
          id?: string
          leg_ids?: string[]
          metadata?: Json
          processed_at?: string | null
          queued_at?: string
          recipient_profile_id?: string
          voyage_id?: string
          watch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_availability_notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_availability_notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_availability_notifications_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "voyage_availability_notifications_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_availability_notifications_watch_id_fkey"
            columns: ["watch_id"]
            isOneToOne: false
            referencedRelation: "voyage_availability_watches"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_availability_watches: {
        Row: {
          active: boolean
          created_at: string
          id: string
          last_notified_at: string | null
          leg_ids: string[]
          profile_id: string
          scope: string
          source: string
          updated_at: string
          voyage_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          last_notified_at?: string | null
          leg_ids?: string[]
          profile_id: string
          scope?: string
          source?: string
          updated_at?: string
          voyage_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          last_notified_at?: string | null
          leg_ids?: string[]
          profile_id?: string
          scope?: string
          source?: string
          updated_at?: string
          voyage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voyage_availability_watches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_availability_watches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_availability_watches_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "voyage_availability_watches_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_bookable_legs: {
        Row: {
          actual_arrival_at: string | null
          actual_departure_at: string | null
          baseline_ends_at_window_end: string | null
          baseline_ends_at_window_start: string | null
          baseline_starts_at_window_end: string | null
          baseline_starts_at_window_start: string | null
          complexity_override: number | null
          created_at: string
          danger_level: number
          danger_reasons: string[]
          ends_at_window_end: string | null
          ends_at_window_start: string | null
          from_waypoint_id: string
          id: string
          is_bookable: boolean
          open_sea: boolean
          planned_nautical_miles: number
          sort_order: number
          starts_at_window_end: string | null
          starts_at_window_start: string | null
          to_waypoint_id: string
          updated_at: string
          voyage_id: string
        }
        Insert: {
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
          baseline_ends_at_window_end?: string | null
          baseline_ends_at_window_start?: string | null
          baseline_starts_at_window_end?: string | null
          baseline_starts_at_window_start?: string | null
          complexity_override?: number | null
          created_at?: string
          danger_level?: number
          danger_reasons?: string[]
          ends_at_window_end?: string | null
          ends_at_window_start?: string | null
          from_waypoint_id: string
          id?: string
          is_bookable?: boolean
          open_sea?: boolean
          planned_nautical_miles?: number
          sort_order?: number
          starts_at_window_end?: string | null
          starts_at_window_start?: string | null
          to_waypoint_id: string
          updated_at?: string
          voyage_id: string
        }
        Update: {
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
          baseline_ends_at_window_end?: string | null
          baseline_ends_at_window_start?: string | null
          baseline_starts_at_window_end?: string | null
          baseline_starts_at_window_start?: string | null
          complexity_override?: number | null
          created_at?: string
          danger_level?: number
          danger_reasons?: string[]
          ends_at_window_end?: string | null
          ends_at_window_start?: string | null
          from_waypoint_id?: string
          id?: string
          is_bookable?: boolean
          open_sea?: boolean
          planned_nautical_miles?: number
          sort_order?: number
          starts_at_window_end?: string | null
          starts_at_window_start?: string | null
          to_waypoint_id?: string
          updated_at?: string
          voyage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_bookable_legs_from_waypoint_id_fkey"
            columns: ["from_waypoint_id"]
            isOneToOne: false
            referencedRelation: "voyage_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_bookable_legs_to_waypoint_id_fkey"
            columns: ["to_waypoint_id"]
            isOneToOne: false
            referencedRelation: "voyage_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_bookable_legs_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "voyage_bookable_legs_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_booking_deposits: {
        Row: {
          amount_cents: number
          booking_request_id: string
          bunq_request_id: number | null
          created_at: string
          currency: string
          environment: string
          id: string
          paid_at: string | null
          participant_id: string | null
          party_size: number
          payer_alias: Json | null
          payment_method: string
          per_person_cents: number
          reference: string
          refund_amount_cents: number
          refund_payment_id: number | null
          refund_policy: string | null
          refund_reference: string | null
          refunded_at: string | null
          share_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          booking_request_id: string
          bunq_request_id?: number | null
          created_at?: string
          currency?: string
          environment: string
          id?: string
          paid_at?: string | null
          participant_id?: string | null
          party_size: number
          payer_alias?: Json | null
          payment_method?: string
          per_person_cents: number
          reference: string
          refund_amount_cents?: number
          refund_payment_id?: number | null
          refund_policy?: string | null
          refund_reference?: string | null
          refunded_at?: string | null
          share_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          booking_request_id?: string
          bunq_request_id?: number | null
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          paid_at?: string | null
          participant_id?: string | null
          party_size?: number
          payer_alias?: Json | null
          payment_method?: string
          per_person_cents?: number
          reference?: string
          refund_amount_cents?: number
          refund_payment_id?: number | null
          refund_policy?: string | null
          refund_reference?: string | null
          refunded_at?: string | null
          share_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_booking_deposits_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "voyage_booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_deposits_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "voyage_booking_participants"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_booking_drafts: {
        Row: {
          candidate_info: Json
          created_at: string
          id: string
          leg_ids: string[]
          message: string | null
          party_size: number
          profile_id: string
          updated_at: string
          voyage_id: string
        }
        Insert: {
          candidate_info?: Json
          created_at?: string
          id?: string
          leg_ids?: string[]
          message?: string | null
          party_size?: number
          profile_id: string
          updated_at?: string
          voyage_id: string
        }
        Update: {
          candidate_info?: Json
          created_at?: string
          id?: string
          leg_ids?: string[]
          message?: string | null
          party_size?: number
          profile_id?: string
          updated_at?: string
          voyage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_booking_drafts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_drafts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_drafts_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "voyage_booking_drafts_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_booking_notifications: {
        Row: {
          booking_request_id: string
          emailed_at: string | null
          error_message: string | null
          event_type: string
          failed_at: string | null
          id: string
          metadata: Json
          processed_at: string | null
          push_sent_at: string | null
          queued_at: string
          recipient_profile_id: string
        }
        Insert: {
          booking_request_id: string
          emailed_at?: string | null
          error_message?: string | null
          event_type: string
          failed_at?: string | null
          id?: string
          metadata?: Json
          processed_at?: string | null
          push_sent_at?: string | null
          queued_at?: string
          recipient_profile_id: string
        }
        Update: {
          booking_request_id?: string
          emailed_at?: string | null
          error_message?: string | null
          event_type?: string
          failed_at?: string | null
          id?: string
          metadata?: Json
          processed_at?: string | null
          push_sent_at?: string | null
          queued_at?: string
          recipient_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_booking_notifications_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "voyage_booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_booking_participants: {
        Row: {
          accepted_at: string | null
          booking_request_id: string
          candidate_info: Json
          conditions_accepted_at: string | null
          created_at: string
          email: string
          expires_at: string | null
          first_name: string | null
          id: string
          invite_sent_at: string | null
          invite_token: string
          is_lead: boolean
          last_name: string | null
          profile_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          booking_request_id: string
          candidate_info?: Json
          conditions_accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string | null
          first_name?: string | null
          id?: string
          invite_sent_at?: string | null
          invite_token?: string
          is_lead?: boolean
          last_name?: string | null
          profile_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          booking_request_id?: string
          candidate_info?: Json
          conditions_accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string | null
          first_name?: string | null
          id?: string
          invite_sent_at?: string | null
          invite_token?: string
          is_lead?: boolean
          last_name?: string | null
          profile_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_booking_participants_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "voyage_booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_booking_plan_changes: {
        Row: {
          booking_request_id: string
          change_kind: string
          created_at: string
          email_status: string
          emailed_at: string | null
          id: string
          metadata: Json
          old_from_waypoint_id: string | null
          old_leg_ids: string[]
          old_to_waypoint_id: string | null
          proposed_from_waypoint_id: string | null
          proposed_leg_ids: string[]
          proposed_to_waypoint_id: string | null
          resolved_at: string | null
          status: string
          updated_at: string
          voyage_id: string
        }
        Insert: {
          booking_request_id: string
          change_kind: string
          created_at?: string
          email_status?: string
          emailed_at?: string | null
          id?: string
          metadata?: Json
          old_from_waypoint_id?: string | null
          old_leg_ids?: string[]
          old_to_waypoint_id?: string | null
          proposed_from_waypoint_id?: string | null
          proposed_leg_ids?: string[]
          proposed_to_waypoint_id?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
          voyage_id: string
        }
        Update: {
          booking_request_id?: string
          change_kind?: string
          created_at?: string
          email_status?: string
          emailed_at?: string | null
          id?: string
          metadata?: Json
          old_from_waypoint_id?: string | null
          old_leg_ids?: string[]
          old_to_waypoint_id?: string | null
          proposed_from_waypoint_id?: string | null
          proposed_leg_ids?: string[]
          proposed_to_waypoint_id?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
          voyage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_booking_plan_changes_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "voyage_booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_plan_changes_old_from_waypoint_id_fkey"
            columns: ["old_from_waypoint_id"]
            isOneToOne: false
            referencedRelation: "voyage_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_plan_changes_old_to_waypoint_id_fkey"
            columns: ["old_to_waypoint_id"]
            isOneToOne: false
            referencedRelation: "voyage_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_plan_changes_proposed_from_waypoint_id_fkey"
            columns: ["proposed_from_waypoint_id"]
            isOneToOne: false
            referencedRelation: "voyage_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_plan_changes_proposed_to_waypoint_id_fkey"
            columns: ["proposed_to_waypoint_id"]
            isOneToOne: false
            referencedRelation: "voyage_waypoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_plan_changes_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "voyage_booking_plan_changes_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_booking_request_legs: {
        Row: {
          bookable_leg_id: string
          booking_request_id: string
          created_at: string
        }
        Insert: {
          bookable_leg_id: string
          booking_request_id: string
          created_at?: string
        }
        Update: {
          bookable_leg_id?: string
          booking_request_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_booking_request_legs_bookable_leg_id_fkey"
            columns: ["bookable_leg_id"]
            isOneToOne: false
            referencedRelation: "voyage_bookable_legs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_request_legs_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "voyage_booking_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_booking_requests: {
        Row: {
          admin_notes: string | null
          cancelled_at: string | null
          candidate_info: Json
          confirmed_at: string | null
          expires_at: string | null
          id: string
          is_crew: boolean
          message: string | null
          party_size: number
          payment_mode: string
          plan_change_metadata: Json
          plan_change_requested_at: string | null
          plan_change_resolved_at: string | null
          plan_change_status: string
          profile_id: string
          requested_at: string
          status: Database["public"]["Enums"]["voyage_booking_status"]
          updated_at: string
          voyage_id: string
        }
        Insert: {
          admin_notes?: string | null
          cancelled_at?: string | null
          candidate_info?: Json
          confirmed_at?: string | null
          expires_at?: string | null
          id?: string
          is_crew?: boolean
          message?: string | null
          party_size?: number
          payment_mode?: string
          plan_change_metadata?: Json
          plan_change_requested_at?: string | null
          plan_change_resolved_at?: string | null
          plan_change_status?: string
          profile_id: string
          requested_at?: string
          status?: Database["public"]["Enums"]["voyage_booking_status"]
          updated_at?: string
          voyage_id: string
        }
        Update: {
          admin_notes?: string | null
          cancelled_at?: string | null
          candidate_info?: Json
          confirmed_at?: string | null
          expires_at?: string | null
          id?: string
          is_crew?: boolean
          message?: string | null
          party_size?: number
          payment_mode?: string
          plan_change_metadata?: Json
          plan_change_requested_at?: string | null
          plan_change_resolved_at?: string | null
          plan_change_status?: string
          profile_id?: string
          requested_at?: string
          status?: Database["public"]["Enums"]["voyage_booking_status"]
          updated_at?: string
          voyage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_booking_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_requests_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "voyage_booking_requests_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_booking_settings: {
        Row: {
          briefing_content_en: string | null
          briefing_content_it: string | null
          confirmation_deadline_hours: number
          created_at: string
          first_briefing_content_en: string | null
          first_briefing_content_it: string | null
          predeparture_info_en: string | null
          predeparture_info_it: string | null
          required_profile_fields: Json
          second_briefing_content_en: string | null
          second_briefing_content_it: string | null
          terms_content_en: string | null
          terms_content_it: string | null
          updated_at: string
          voyage_id: string
        }
        Insert: {
          briefing_content_en?: string | null
          briefing_content_it?: string | null
          confirmation_deadline_hours?: number
          created_at?: string
          first_briefing_content_en?: string | null
          first_briefing_content_it?: string | null
          predeparture_info_en?: string | null
          predeparture_info_it?: string | null
          required_profile_fields?: Json
          second_briefing_content_en?: string | null
          second_briefing_content_it?: string | null
          terms_content_en?: string | null
          terms_content_it?: string | null
          updated_at?: string
          voyage_id: string
        }
        Update: {
          briefing_content_en?: string | null
          briefing_content_it?: string | null
          confirmation_deadline_hours?: number
          created_at?: string
          first_briefing_content_en?: string | null
          first_briefing_content_it?: string | null
          predeparture_info_en?: string | null
          predeparture_info_it?: string | null
          required_profile_fields?: Json
          second_briefing_content_en?: string | null
          second_briefing_content_it?: string | null
          terms_content_en?: string | null
          terms_content_it?: string | null
          updated_at?: string
          voyage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_booking_settings_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: true
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "voyage_booking_settings_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: true
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_booking_task_completions: {
        Row: {
          booking_request_id: string
          completed_at: string
          task_id: string
        }
        Insert: {
          booking_request_id: string
          completed_at?: string
          task_id: string
        }
        Update: {
          booking_request_id?: string
          completed_at?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_booking_task_completions_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "voyage_booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_booking_task_completions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "voyage_booking_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_booking_tasks: {
        Row: {
          created_at: string
          description_en: string | null
          description_it: string | null
          id: string
          required: boolean
          sort_order: number
          title_en: string | null
          title_it: string
          updated_at: string
          voyage_id: string
        }
        Insert: {
          created_at?: string
          description_en?: string | null
          description_it?: string | null
          id?: string
          required?: boolean
          sort_order?: number
          title_en?: string | null
          title_it: string
          updated_at?: string
          voyage_id: string
        }
        Update: {
          created_at?: string
          description_en?: string | null
          description_it?: string | null
          id?: string
          required?: boolean
          sort_order?: number
          title_en?: string | null
          title_it?: string
          updated_at?: string
          voyage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_booking_tasks_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "voyage_booking_tasks_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_waypoints: {
        Row: {
          actual_arrival_at: string | null
          actual_departure_at: string | null
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
          planned_stop_duration_minutes: number
          sort_order: number
          stop_departure_time: string | null
          stop_hours: number | null
          stop_mode: string
          stop_nights: number | null
          visibility_mode: string
          voyage_id: string
          waypoint_type: string
        }
        Insert: {
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
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
          planned_stop_duration_minutes?: number
          sort_order?: number
          stop_departure_time?: string | null
          stop_hours?: number | null
          stop_mode?: string
          stop_nights?: number | null
          visibility_mode?: string
          voyage_id: string
          waypoint_type?: string
        }
        Update: {
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
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
          planned_stop_duration_minutes?: number
          sort_order?: number
          stop_departure_time?: string | null
          stop_hours?: number | null
          stop_mode?: string
          stop_nights?: number | null
          visibility_mode?: string
          voyage_id?: string
          waypoint_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyage_waypoints_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
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
          booking_contribution_per_nm_eur: number
          booking_enabled: boolean
          booking_max_guests: number
          booking_planning_speed_kn: number
          cached_geometry: Json | null
          created_at: string
          departure_window_end: string | null
          departure_window_start: string | null
          description: string | null
          description_en: string | null
          description_it: string | null
          end_date: string | null
          end_date_flex_days: number | null
          end_time: string | null
          id: string
          is_published: boolean
          name: string
          name_en: string | null
          name_it: string | null
          sort_order: number
          start_date: string | null
          start_date_flex_days: number | null
          start_time: string | null
          status: Database["public"]["Enums"]["voyage_status"]
          status_override: Database["public"]["Enums"]["voyage_status"] | null
          type: Database["public"]["Enums"]["voyage_type"]
          updated_at: string
          waterway_autoroute: boolean
        }
        Insert: {
          booking_contribution_per_nm_eur?: number
          booking_enabled?: boolean
          booking_max_guests?: number
          booking_planning_speed_kn?: number
          cached_geometry?: Json | null
          created_at?: string
          departure_window_end?: string | null
          departure_window_start?: string | null
          description?: string | null
          description_en?: string | null
          description_it?: string | null
          end_date?: string | null
          end_date_flex_days?: number | null
          end_time?: string | null
          id?: string
          is_published?: boolean
          name?: string
          name_en?: string | null
          name_it?: string | null
          sort_order?: number
          start_date?: string | null
          start_date_flex_days?: number | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["voyage_status"]
          status_override?: Database["public"]["Enums"]["voyage_status"] | null
          type?: Database["public"]["Enums"]["voyage_type"]
          updated_at?: string
          waterway_autoroute?: boolean
        }
        Update: {
          booking_contribution_per_nm_eur?: number
          booking_enabled?: boolean
          booking_max_guests?: number
          booking_planning_speed_kn?: number
          cached_geometry?: Json | null
          created_at?: string
          departure_window_end?: string | null
          departure_window_start?: string | null
          description?: string | null
          description_en?: string | null
          description_it?: string | null
          end_date?: string | null
          end_date_flex_days?: number | null
          end_time?: string | null
          id?: string
          is_published?: boolean
          name?: string
          name_en?: string | null
          name_it?: string | null
          sort_order?: number
          start_date?: string | null
          start_date_flex_days?: number | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["voyage_status"]
          status_override?: Database["public"]["Enums"]["voyage_status"] | null
          type?: Database["public"]["Enums"]["voyage_type"]
          updated_at?: string
          waterway_autoroute?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      observations_export: {
        Row: {
          air_temp_degc: number | null
          air_temp_degc_qc: number | null
          depth_m: number | null
          device_code: string | null
          dissolved_oxygen_mgl: number | null
          dissolved_oxygen_mgl_qc: number | null
          gps_accuracy_m: number | null
          humidity_pct: number | null
          humidity_pct_qc: number | null
          latitude_deg: number | null
          longitude_deg: number | null
          notes: string | null
          observation_id: string | null
          plankton_density_indm3: number | null
          plankton_density_indm3_qc: number | null
          position_qc: number | null
          pressure_hpa: number | null
          pressure_hpa_qc: number | null
          recorded_at_utc: string | null
          salinity_psu: number | null
          salinity_psu_qc: number | null
          sea_state: string | null
          sea_state_qc: number | null
          source: string | null
          sst_degc: number | null
          sst_degc_qc: number | null
          voyage_id: string | null
          voyage_name: string | null
          wind_direction_deg: number | null
          wind_direction_deg_qc: number | null
          wind_speed_kt: number | null
          wind_speed_kt_qc: number | null
        }
        Relationships: []
      }
      observations_map: {
        Row: {
          depth_m: number | null
          device_code: string | null
          device_label: string | null
          gps_accuracy_m: number | null
          id: string | null
          lat: number | null
          lng: number | null
          measurements: Json | null
          notes: string | null
          qc_flag: number | null
          recorded_at: string | null
          source: string | null
          voyage_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "observations_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "observations_export"
            referencedColumns: ["voyage_id"]
          },
          {
            foreignKeyName: "observations_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
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
      _migration_exec: { Args: { p_file_name: string }; Returns: string }
      accept_booking_participation: {
        Args: { _candidate_info?: Json; _participant_id: string }
        Returns: {
          accepted_at: string | null
          booking_request_id: string
          candidate_info: Json
          conditions_accepted_at: string | null
          created_at: string
          email: string
          expires_at: string | null
          first_name: string | null
          id: string
          invite_sent_at: string | null
          invite_token: string
          is_lead: boolean
          last_name: string | null
          profile_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "voyage_booking_participants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      active_membership_tier_order: {
        Args: { _profile_id: string }
        Returns: number
      }
      admin_booking_over_capacity: {
        Args: {
          _excluding_request_id?: string
          _leg_ids: string[]
          _party_size: number
          _voyage_id: string
        }
        Returns: boolean
      }
      admin_create_voyage_booking: {
        Args: {
          _admin_notes?: string
          _allow_over_capacity?: boolean
          _leg_ids: string[]
          _message?: string
          _party_size?: number
          _profile_id: string
          _status?: Database["public"]["Enums"]["voyage_booking_status"]
          _voyage_id: string
        }
        Returns: {
          booking_request_id: string
          over_capacity: boolean
        }[]
      }
      admin_create_voyage_booking_invite_by_email: {
        Args: {
          _admin_notes?: string
          _allow_over_capacity?: boolean
          _email: string
          _first_name?: string
          _last_name?: string
          _leg_ids: string[]
          _message?: string
          _status?: Database["public"]["Enums"]["voyage_booking_status"]
          _voyage_id: string
        }
        Returns: {
          booking_request_id: string
          over_capacity: boolean
          participant_id: string
        }[]
      }
      admin_list_community_roles: {
        Args: never
        Returns: {
          active_period_end: string
          active_subscription_id: string
          active_tier_name: string
          email: string
          is_admin: boolean
          is_moderator: boolean
          name: string
          profile_id: string
        }[]
      }
      admin_propose_voyage_booking_legs: {
        Args: {
          _admin_note?: string
          _booking_request_id: string
          _proposed_leg_ids: string[]
        }
        Returns: string
      }
      admin_respond_voyage_booking_plan_change: {
        Args: {
          _action: string
          _admin_note?: string
          _booking_request_id: string
        }
        Returns: undefined
      }
      admin_set_community_moderator: {
        Args: { _enabled: boolean; _profile_id: string }
        Returns: undefined
      }
      admin_set_voyage_booking_status: {
        Args: {
          _admin_notes?: string
          _allow_over_capacity?: boolean
          _booking_request_id: string
          _status: Database["public"]["Enums"]["voyage_booking_status"]
        }
        Returns: {
          booking_request_id: string
          over_capacity: boolean
        }[]
      }
      admin_update_booking_legs: {
        Args: {
          _allow_over_capacity?: boolean
          _booking_request_id: string
          _leg_ids: string[]
        }
        Returns: {
          over_capacity: boolean
        }[]
      }
      apply_voyage_schedule: {
        Args: { _notify?: boolean; _voyage_id: string }
        Returns: number
      }
      booking_leg_effective_date: {
        Args: {
          _ends_at_window_end: string
          _ends_at_window_start: string
          _starts_at_window_end: string
          _starts_at_window_start: string
        }
        Returns: string
      }
      booking_leg_is_current_or_future: {
        Args: {
          _ends_at_window_end: string
          _ends_at_window_start: string
          _starts_at_window_end: string
          _starts_at_window_start: string
        }
        Returns: boolean
      }
      booking_leg_remaining_capacity: {
        Args: { _leg_id: string }
        Returns: number
      }
      booking_next_departure: {
        Args: {
          _arrival: string
          _legacy_minutes: number
          _stop_departure_time: string
          _stop_hours: number
          _stop_mode: string
          _stop_nights: number
        }
        Returns: string
      }
      can_read_community_channel: {
        Args: { _channel_id: string; _profile_id: string }
        Returns: boolean
      }
      can_read_community_live_event: {
        Args: { _event_id: string; _profile_id: string }
        Returns: boolean
      }
      can_read_community_poll: {
        Args: { _poll_id: string; _profile_id: string }
        Returns: boolean
      }
      can_read_community_post: {
        Args: { _post_id: string; _profile_id: string }
        Returns: boolean
      }
      cancel_voyage_booking: {
        Args: { _booking_request_id: string }
        Returns: undefined
      }
      compute_voyage_schedule: {
        Args: { _use_actuals: boolean; _voyage_id: string }
        Returns: {
          arrival_window_end: string
          arrival_window_start: string
          departure_window_end: string
          departure_window_start: string
          from_waypoint_id: string
          leg_actual_arrival_at: string
          leg_actual_departure_at: string
          leg_nautical_miles: number
          leg_sort_order: number
          to_waypoint_id: string
        }[]
      }
      confirm_voyage_booking: {
        Args: { _booking_request_id: string }
        Returns: undefined
      }
      deactivate_past_voyage_bookable_legs: { Args: never; Returns: number }
      decline_booking_participation: {
        Args: { _participant_id: string }
        Returns: {
          accepted_at: string | null
          booking_request_id: string
          candidate_info: Json
          conditions_accepted_at: string | null
          created_at: string
          email: string
          expires_at: string | null
          first_name: string | null
          id: string
          invite_sent_at: string | null
          invite_token: string
          is_lead: boolean
          last_name: string | null
          profile_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "voyage_booking_participants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      dispatch_community_live_event_email_reminders: {
        Args: { _limit?: number }
        Returns: number
      }
      dispatch_membership_renewal_reminders: {
        Args: { _limit?: number }
        Returns: number
      }
      editorial_plan_slot_scheduled_at: {
        Args: { _slot_date: string; _slot_time: string; _timezone: string }
        Returns: string
      }
      enqueue_admin_voyage_booking_notifications: {
        Args: {
          _booking_request_id: string
          _event_type: string
          _metadata?: Json
        }
        Returns: number
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enqueue_voyage_availability_notifications: {
        Args: {
          _event_type: string
          _leg_ids?: string[]
          _metadata?: Json
          _voyage_id: string
        }
        Returns: number
      }
      enqueue_voyage_booking_notification: {
        Args: {
          _booking_request_id: string
          _event_type: string
          _metadata?: Json
        }
        Returns: string
      }
      expire_pending_booking_participants: { Args: never; Returns: number }
      expire_pending_voyage_booking_payments: { Args: never; Returns: number }
      get_my_participations: {
        Args: never
        Returns: {
          booking_request_id: string
          deposit_paid: boolean
          expires_at: string
          is_lead: boolean
          participant_id: string
          party_size: number
          payment_mode: string
          requires_payment: boolean
          status: string
          voyage_id: string
          voyage_name: string
          voyage_name_en: string
          voyage_name_it: string
        }[]
      }
      get_public_voyage_leg_availability: {
        Args: { _voyage_ids?: string[] }
        Returns: {
          available: boolean
          capacity: number
          complexity_override: number
          danger_level: number
          ends_at_window_end: string
          ends_at_window_start: string
          from_waypoint_id: string
          id: string
          is_bookable: boolean
          occupied: number
          open_sea: boolean
          planned_nautical_miles: number
          remaining: number
          sort_order: number
          starts_at_window_end: string
          starts_at_window_start: string
          to_waypoint_id: string
          voyage_id: string
        }[]
      }
      has_active_membership: { Args: { _profile_id: string }; Returns: boolean }
      has_community_moderation_role: {
        Args: { _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      admin_article_view_insight_one: {
        Args: { _article_id: string }
        Returns: Json
      }
      admin_article_view_insights: {
        Args: never
        Returns: {
          article_id: string
          anonymous_views: number
          avg_dwell_ms: number
          distinct_registered: number
          distinct_visitors: number
          last_view_at: string
          measured_dwell_count: number
          published_at: string
          registered_views: number
          status: string
          story_id: string
          title_en: string
          title_it: string
          top_lang: string
          tracked_views: number
          view_count: number
          views_en: number
          views_it: number
        }[]
      }
      increment_article_view_count: {
        Args: { _article_id: string; _lang?: string; _visitor_key?: string }
        Returns: number
      }
      record_article_read_dwell: {
        Args: { _article_id: string; _dwell_ms: number; _visitor_key: string }
        Returns: undefined
      }
      invoke_editorial_edge_function: {
        Args: { _function_name: string }
        Returns: number
      }
      invoke_email_queue_worker: { Args: never; Returns: number }
      list_due_community_live_event_push_reminders: {
        Args: { _limit?: number }
        Returns: {
          advance_push_due: boolean
          live_event_id: string
          profile_id: string
          remind_before_minutes: number
          reminder_id: string
          start_push_due: boolean
          starts_at: string
          title: string
        }[]
      }
      list_my_voyage_availability_watches: {
        Args: never
        Returns: {
          active: boolean
          created_at: string
          id: string
          last_notified_at: string
          leg_ids: string[]
          profile_id: string
          scope: string
          source: string
          updated_at: string
          voyage_id: string
        }[]
      }
      list_voyage_booking_occupancy: {
        Args: { _voyage_id: string }
        Returns: {
          booking_request_id: string
          display_name: string
          is_crew: boolean
          is_own: boolean
          leg_ids: string[]
          party_size: number
          status: string
        }[]
      }
      membership_period_end: {
        Args: {
          _billing_interval: string
          _period_count: number
          _start: string
        }
        Returns: string
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
      promote_waitlisted_voyage_bookings: {
        Args: { _changed_leg_ids?: string[]; _voyage_id: string }
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
      reattribute_logbook_photo_voyages: { Args: never; Returns: number }
      reattribute_observation_voyages: { Args: never; Returns: number }
      rebuild_observations_export_view: { Args: never; Returns: undefined }
      record_spritz_discovery: {
        Args: { _visitor_key?: string }
        Returns: string
      }
      refresh_admin_email_aliases: { Args: never; Returns: undefined }
      refresh_all_voyage_statuses: { Args: never; Returns: number }
      refresh_voyage_status: {
        Args: { _voyage_id: string }
        Returns: Database["public"]["Enums"]["voyage_status"]
      }
      request_voyage_booking: {
        Args: {
          _candidate_info?: Json
          _leg_ids: string[]
          _message?: string
          _party_size?: number
          _voyage_id: string
        }
        Returns: {
          booking_request_id: string
          booking_status: Database["public"]["Enums"]["voyage_booking_status"]
        }[]
      }
      resolve_voyage_for_photo: { Args: { taken_at: string }; Returns: string }
      resolve_voyage_for_timestamp: { Args: { ts: string }; Returns: string }
      respond_voyage_booking_plan_change: {
        Args: {
          _action: string
          _booking_request_id: string
          _message?: string
        }
        Returns: undefined
      }
      set_booking_participants: {
        Args: {
          _booking_request_id: string
          _participants: Json
          _payment_mode: string
        }
        Returns: {
          accepted_at: string | null
          booking_request_id: string
          candidate_info: Json
          conditions_accepted_at: string | null
          created_at: string
          email: string
          expires_at: string | null
          first_name: string | null
          id: string
          invite_sent_at: string | null
          invite_token: string
          is_lead: boolean
          last_name: string | null
          profile_id: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "voyage_booking_participants"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_voyage_availability_watch: {
        Args: {
          _active: boolean
          _leg_ids?: string[]
          _scope: string
          _source?: string
          _voyage_id?: string
        }
        Returns: {
          active: boolean
          created_at: string
          id: string
          last_notified_at: string | null
          leg_ids: string[]
          profile_id: string
          scope: string
          source: string
          updated_at: string
          voyage_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "voyage_availability_watches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_voyage_waypoint_actual: {
        Args: { _at: string; _kind: string; _waypoint_id: string }
        Returns: string
      }
      sync_voyage_bookable_legs: {
        Args: { _voyage_id: string }
        Returns: number
      }
      sync_voyage_bookable_legs_plan: {
        Args: { _voyage_id: string }
        Returns: number
      }
      user_propose_voyage_booking_legs: {
        Args: {
          _booking_request_id: string
          _proposed_leg_ids: string[]
          _user_message?: string
        }
        Returns: string
      }
      voyage_crew_profile_ids: { Args: never; Returns: string[] }
      voyage_derived_status: {
        Args: { _voyage_id: string }
        Returns: Database["public"]["Enums"]["voyage_status"]
      }
      voyage_leg_is_bookable_now: {
        Args: {
          _actual_arrival_at: string
          _actual_departure_at: string
          _ends_at_window_end: string
          _starts_at_window_start: string
        }
        Returns: boolean
      }
      voyage_leg_phase: {
        Args: {
          _actual_arrival_at: string
          _actual_departure_at: string
          _ends_at_window_end: string
          _starts_at_window_start: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      article_editorial_type: "pillar" | "support" | "utility_reflection"
      article_status: "draft" | "scheduled" | "published"
      community_message_status: "visible" | "hidden" | "deleted"
      community_post_status: "draft" | "published" | "archived"
      community_post_visibility: "public" | "members" | "tier"
      membership_payment_status:
        | "pending"
        | "paid"
        | "cancelled"
        | "failed"
        | "refunded"
      membership_subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "cancelled"
        | "expired"
      voyage_booking_status:
        | "requested"
        | "waitlisted"
        | "admin_approved"
        | "user_confirmed"
        | "cancelled"
        | "rejected"
        | "expired"
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
      article_editorial_type: ["pillar", "support", "utility_reflection"],
      article_status: ["draft", "scheduled", "published"],
      community_message_status: ["visible", "hidden", "deleted"],
      community_post_status: ["draft", "published", "archived"],
      community_post_visibility: ["public", "members", "tier"],
      membership_payment_status: [
        "pending",
        "paid",
        "cancelled",
        "failed",
        "refunded",
      ],
      membership_subscription_status: [
        "trialing",
        "active",
        "past_due",
        "cancelled",
        "expired",
      ],
      voyage_booking_status: [
        "requested",
        "waitlisted",
        "admin_approved",
        "user_confirmed",
        "cancelled",
        "rejected",
        "expired",
      ],
      voyage_status: ["planned", "active", "completed"],
      voyage_type: ["water", "land"],
    },
  },
} as const
