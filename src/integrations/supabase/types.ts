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
      fraud_logs: {
        Row: {
          created_at: string
          id: string
          resolution: string | null
          rule_triggered: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          resolution?: string | null
          rule_triggered: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          resolution?: string | null
          rule_triggered?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fraud_logs_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      parental_links: {
        Row: {
          created_at: string
          id: string
          parent_phone: string
          parent_verified: boolean
          spend_limit_daily: number | null
          spend_limit_monthly: number | null
          spend_limit_weekly: number | null
          teen_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          parent_phone: string
          parent_verified?: boolean
          spend_limit_daily?: number | null
          spend_limit_monthly?: number | null
          spend_limit_weekly?: number | null
          teen_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          parent_phone?: string
          parent_verified?: boolean
          spend_limit_daily?: number | null
          spend_limit_monthly?: number | null
          spend_limit_weekly?: number | null
          teen_user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          aadhaar_last4: string | null
          balance: number
          created_at: string
          dob: string | null
          full_name: string | null
          gender: string | null
          id: string
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          onboarding_stage: Database["public"]["Enums"]["onboarding_stage"]
          phone: string | null
          updated_at: string
        }
        Insert: {
          aadhaar_last4?: string | null
          balance?: number
          created_at?: string
          dob?: string | null
          full_name?: string | null
          gender?: string | null
          id: string
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          onboarding_stage?: Database["public"]["Enums"]["onboarding_stage"]
          phone?: string | null
          updated_at?: string
        }
        Update: {
          aadhaar_last4?: string | null
          balance?: number
          created_at?: string
          dob?: string | null
          full_name?: string | null
          gender?: string | null
          id?: string
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          onboarding_stage?: Database["public"]["Enums"]["onboarding_stage"]
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          created_at: string
          fraud_flags: Json
          id: string
          merchant_name: string
          note: string | null
          status: Database["public"]["Enums"]["txn_status"]
          upi_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          fraud_flags?: Json
          id?: string
          merchant_name: string
          note?: string | null
          status?: Database["public"]["Enums"]["txn_status"]
          upi_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          fraud_flags?: Json
          id?: string
          merchant_name?: string
          note?: string | null
          status?: Database["public"]["Enums"]["txn_status"]
          upi_id?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      kyc_status: "not_started" | "pending" | "approved" | "rejected"
      onboarding_stage:
        | "STAGE_0"
        | "STAGE_1"
        | "STAGE_2"
        | "STAGE_3"
        | "STAGE_4"
        | "STAGE_5"
      txn_status: "success" | "pending" | "failed"
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
      kyc_status: ["not_started", "pending", "approved", "rejected"],
      onboarding_stage: [
        "STAGE_0",
        "STAGE_1",
        "STAGE_2",
        "STAGE_3",
        "STAGE_4",
        "STAGE_5",
      ],
      txn_status: ["success", "pending", "failed"],
    },
  },
} as const
