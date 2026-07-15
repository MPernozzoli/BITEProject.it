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
          synced_at: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id: string
          lat_end?: number | null
          lat_start?: number | null
          lng_end?: number | null
          lng_start?: number | null
          name?: string
          nautical_miles?: number | null
          sort_order?: number
          started_at?: string | null
          status?: string
          synced_at?: string
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
          synced_at?: string
          updated_at?: string
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
          synced_at: string
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
          id: string
          lat: number
          lng: number
          media?: Json
          name?: string | null
          name_en?: string | null
          name_it?: string | null
          sort_order?: number
          synced_at?: string
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
          synced_at?: string
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
          synced_at: string
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
          id: string
          is_published?: boolean
          name?: string
          name_en?: string | null
          name_it?: string | null
          sort_order?: number
          start_date?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["voyage_status"]
          synced_at?: string
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
          synced_at?: string
          type?: Database["public"]["Enums"]["voyage_type"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      observations_map: {
        Row: {
          device_code: string | null
          device_label: string | null
          gps_accuracy_m: number | null
          depth_m: number | null
          id: string
          lat: number
          lng: number
          measurements: Json
          notes: string | null
          qc_flag: number
          recorded_at: string
          source: string
          voyage_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
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
      voyage_status: ["planned", "active", "completed"],
      voyage_type: ["water", "land"],
    },
  },
} as const
