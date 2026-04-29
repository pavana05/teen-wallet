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
      admin_audit_log: {
        Row: {
          action_type: string
          admin_email: string | null
          admin_id: string | null
          admin_role: Database["public"]["Enums"]["app_admin_role"] | null
          created_at: string
          id: string
          ip_address: string | null
          new_value: Json | null
          old_value: Json | null
          session_id: string | null
          target_entity: string | null
          target_id: string | null
          user_agent: string | null
        }
        Insert: {
          action_type: string
          admin_email?: string | null
          admin_id?: string | null
          admin_role?: Database["public"]["Enums"]["app_admin_role"] | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          old_value?: Json | null
          session_id?: string | null
          target_entity?: string | null
          target_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action_type?: string
          admin_email?: string | null
          admin_id?: string | null
          admin_role?: Database["public"]["Enums"]["app_admin_role"] | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          old_value?: Json | null
          session_id?: string | null
          target_entity?: string | null
          target_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_notifications: {
        Row: {
          admin_id: string
          body: string | null
          created_at: string
          id: string
          link: string | null
          priority: string
          read: boolean
          title: string
          type: string
        }
        Insert: {
          admin_id: string
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          priority?: string
          read?: boolean
          title: string
          type: string
        }
        Update: {
          admin_id?: string
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          priority?: string
          read?: boolean
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_notifications_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_sessions: {
        Row: {
          admin_id: string
          created_at: string
          expires_at: string
          id: string
          invalidated_at: string | null
          ip_address: string | null
          last_seen_at: string
          session_token_hash: string
          user_agent: string | null
        }
        Insert: {
          admin_id: string
          created_at?: string
          expires_at: string
          id?: string
          invalidated_at?: string | null
          ip_address?: string | null
          last_seen_at?: string
          session_token_hash: string
          user_agent?: string | null
        }
        Update: {
          admin_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          invalidated_at?: string | null
          ip_address?: string | null
          last_seen_at?: string
          session_token_hash?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_sessions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          created_at: string
          email: string
          failed_attempts: number
          id: string
          ip_allowlist: string[]
          last_login_at: string | null
          last_login_ip: string | null
          locked_until: string | null
          name: string
          password_hash: string | null
          role: Database["public"]["Enums"]["app_admin_role"]
          status: Database["public"]["Enums"]["admin_status"]
          totp_enrolled: boolean
          totp_secret: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          failed_attempts?: number
          id?: string
          ip_allowlist?: string[]
          last_login_at?: string | null
          last_login_ip?: string | null
          locked_until?: string | null
          name: string
          password_hash?: string | null
          role: Database["public"]["Enums"]["app_admin_role"]
          status?: Database["public"]["Enums"]["admin_status"]
          totp_enrolled?: boolean
          totp_secret?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          failed_attempts?: number
          id?: string
          ip_allowlist?: string[]
          last_login_at?: string | null
          last_login_ip?: string | null
          locked_until?: string | null
          name?: string
          password_hash?: string | null
          role?: Database["public"]["Enums"]["app_admin_role"]
          status?: Database["public"]["Enums"]["admin_status"]
          totp_enrolled?: boolean
          totp_secret?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      app_images: {
        Row: {
          alt: string
          bytes: number | null
          content_type: string | null
          created_at: string
          description: string | null
          height: number | null
          key: string
          label: string
          storage_path: string | null
          updated_at: string
          updated_by_email: string | null
          url: string | null
          width: number | null
        }
        Insert: {
          alt?: string
          bytes?: number | null
          content_type?: string | null
          created_at?: string
          description?: string | null
          height?: number | null
          key: string
          label: string
          storage_path?: string | null
          updated_at?: string
          updated_by_email?: string | null
          url?: string | null
          width?: number | null
        }
        Update: {
          alt?: string
          bytes?: number | null
          content_type?: string | null
          created_at?: string
          description?: string | null
          height?: number | null
          key?: string
          label?: string
          storage_path?: string | null
          updated_at?: string
          updated_by_email?: string | null
          url?: string | null
          width?: number | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          created_at: string
          emoji: string | null
          id: string
          last_paid_at: string | null
          name: string
          phone: string | null
          updated_at: string
          upi_id: string
          user_id: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          emoji?: string | null
          id?: string
          last_paid_at?: string | null
          name: string
          phone?: string | null
          updated_at?: string
          upi_id: string
          user_id: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          emoji?: string | null
          id?: string
          last_paid_at?: string | null
          name?: string
          phone?: string | null
          updated_at?: string
          upi_id?: string
          user_id?: string
          verified?: boolean
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
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
      gender_offers: {
        Row: {
          accent: string
          active: boolean
          created_at: string
          cta_label: string
          emphasis: string
          eyebrow: string
          gender_target: string
          headline: string
          id: string
          sort_order: number
          subtitle: string
          updated_at: string
        }
        Insert: {
          accent?: string
          active?: boolean
          created_at?: string
          cta_label?: string
          emphasis: string
          eyebrow: string
          gender_target: string
          headline: string
          id?: string
          sort_order?: number
          subtitle: string
          updated_at?: string
        }
        Update: {
          accent?: string
          active?: boolean
          created_at?: string
          cta_label?: string
          emphasis?: string
          eyebrow?: string
          gender_target?: string
          headline?: string
          id?: string
          sort_order?: number
          subtitle?: string
          updated_at?: string
        }
        Relationships: []
      }
      gender_rewards_rules: {
        Row: {
          active: boolean
          cashback_pct: number
          category: string
          created_at: string
          description: string
          gender_target: string
          id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          cashback_pct: number
          category: string
          created_at?: string
          description: string
          gender_target: string
          id?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          cashback_pct?: number
          category?: string
          created_at?: string
          description?: string
          gender_target?: string
          id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      issue_report_notes: {
        Row: {
          admin_email: string
          body: string
          created_at: string
          id: string
          report_id: string
        }
        Insert: {
          admin_email: string
          body: string
          created_at?: string
          id?: string
          report_id: string
        }
        Update: {
          admin_email?: string
          body?: string
          created_at?: string
          id?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_report_notes_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "issue_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_reports: {
        Row: {
          app_version: string | null
          assigned_to_email: string | null
          camera_photo_path: string | null
          category: string
          console_errors: Json
          created_at: string
          id: string
          last_activity_at: string
          message: string
          priority: Database["public"]["Enums"]["issue_priority"]
          resolved_at: string | null
          resolved_by_email: string | null
          route: string | null
          screenshot_path: string | null
          stack_trace: string | null
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          assigned_to_email?: string | null
          camera_photo_path?: string | null
          category?: string
          console_errors?: Json
          created_at?: string
          id?: string
          last_activity_at?: string
          message: string
          priority?: Database["public"]["Enums"]["issue_priority"]
          resolved_at?: string | null
          resolved_by_email?: string | null
          route?: string | null
          screenshot_path?: string | null
          stack_trace?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          assigned_to_email?: string | null
          camera_photo_path?: string | null
          category?: string
          console_errors?: Json
          created_at?: string
          id?: string
          last_activity_at?: string
          message?: string
          priority?: Database["public"]["Enums"]["issue_priority"]
          resolved_at?: string | null
          resolved_by_email?: string | null
          route?: string | null
          screenshot_path?: string | null
          stack_trace?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      kyc_message_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          stage: string
          title: string
          updated_at: string
          updated_by_email: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          stage: string
          title: string
          updated_at?: string
          updated_by_email?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          stage?: string
          title?: string
          updated_at?: string
          updated_by_email?: string | null
        }
        Relationships: []
      }
      kyc_reminder_log: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          sent_by_admin_id: string | null
          sent_by_email: string | null
          stage: string | null
          status: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          sent_by_admin_id?: string | null
          sent_by_email?: string | null
          stage?: string | null
          status?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          sent_by_admin_id?: string | null
          sent_by_email?: string | null
          stage?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      kyc_submissions: {
        Row: {
          created_at: string
          doc_back_path: string | null
          doc_front_path: string | null
          id: string
          match_score: number | null
          provider: string
          provider_ref: string | null
          reason: string | null
          selfie_height: number | null
          selfie_path: string | null
          selfie_size_bytes: number | null
          selfie_width: number | null
          status: Database["public"]["Enums"]["kyc_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          doc_back_path?: string | null
          doc_front_path?: string | null
          id?: string
          match_score?: number | null
          provider?: string
          provider_ref?: string | null
          reason?: string | null
          selfie_height?: number | null
          selfie_path?: string | null
          selfie_size_bytes?: number | null
          selfie_width?: number | null
          status?: Database["public"]["Enums"]["kyc_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          doc_back_path?: string | null
          doc_front_path?: string | null
          id?: string
          match_score?: number | null
          provider?: string
          provider_ref?: string | null
          reason?: string | null
          selfie_height?: number | null
          selfie_path?: string | null
          selfie_size_bytes?: number | null
          selfie_width?: number | null
          status?: Database["public"]["Enums"]["kyc_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      payment_attempts: {
        Row: {
          amount: number
          client_ref: string | null
          completed_at: string | null
          created_at: string
          failure_reason: string | null
          fraud_flags: Json
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          payee_name: string
          processing_started_at: string | null
          provider_ref: string | null
          stage: Database["public"]["Enums"]["payment_stage"]
          transaction_id: string | null
          updated_at: string
          upi_id: string
          user_id: string
          webhook_due_at: string | null
        }
        Insert: {
          amount: number
          client_ref?: string | null
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          fraud_flags?: Json
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          payee_name: string
          processing_started_at?: string | null
          provider_ref?: string | null
          stage?: Database["public"]["Enums"]["payment_stage"]
          transaction_id?: string | null
          updated_at?: string
          upi_id: string
          user_id: string
          webhook_due_at?: string | null
        }
        Update: {
          amount?: number
          client_ref?: string | null
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          fraud_flags?: Json
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          payee_name?: string
          processing_started_at?: string | null
          provider_ref?: string | null
          stage?: Database["public"]["Enums"]["payment_stage"]
          transaction_id?: string | null
          updated_at?: string
          upi_id?: string
          user_id?: string
          webhook_due_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          aadhaar_last4: string | null
          account_locked: boolean
          account_tag: string
          address_city: string | null
          address_line1: string | null
          address_pincode: string | null
          address_state: string | null
          balance: number
          created_at: string
          dob: string | null
          email: string | null
          full_name: string | null
          gender: string | null
          id: string
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          notif_prefs: Json
          onboarding_stage: Database["public"]["Enums"]["onboarding_stage"]
          phone: string | null
          school_name: string | null
          updated_at: string
        }
        Insert: {
          aadhaar_last4?: string | null
          account_locked?: boolean
          account_tag?: string
          address_city?: string | null
          address_line1?: string | null
          address_pincode?: string | null
          address_state?: string | null
          balance?: number
          created_at?: string
          dob?: string | null
          email?: string | null
          full_name?: string | null
          gender?: string | null
          id: string
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          notif_prefs?: Json
          onboarding_stage?: Database["public"]["Enums"]["onboarding_stage"]
          phone?: string | null
          school_name?: string | null
          updated_at?: string
        }
        Update: {
          aadhaar_last4?: string | null
          account_locked?: boolean
          account_tag?: string
          address_city?: string | null
          address_line1?: string | null
          address_pincode?: string | null
          address_state?: string | null
          balance?: number
          created_at?: string
          dob?: string | null
          email?: string | null
          full_name?: string | null
          gender?: string | null
          id?: string
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          notif_prefs?: Json
          onboarding_stage?: Database["public"]["Enums"]["onboarding_stage"]
          phone?: string | null
          school_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          code: string
          completed_at: string | null
          created_at: string
          id: string
          referred_reward: number
          referred_user_id: string
          referrer_reward: number
          referrer_user_id: string
          status: Database["public"]["Enums"]["referral_status"]
        }
        Insert: {
          code: string
          completed_at?: string | null
          created_at?: string
          id?: string
          referred_reward?: number
          referred_user_id: string
          referrer_reward?: number
          referrer_user_id: string
          status?: Database["public"]["Enums"]["referral_status"]
        }
        Update: {
          code?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          referred_reward?: number
          referred_user_id?: string
          referrer_reward?: number
          referrer_user_id?: string
          status?: Database["public"]["Enums"]["referral_status"]
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
      user_security: {
        Row: {
          app_lock_enabled: boolean
          auto_lock_seconds: number
          biometric_aaguid: string | null
          biometric_credential_id: string | null
          biometric_public_key: string | null
          biometric_sign_count: number
          biometric_transports: string[] | null
          created_at: string
          failed_attempts: number
          lock_after_payment: boolean
          locked_until: string | null
          pin_hash: string | null
          pin_iterations: number
          pin_length: number | null
          pin_salt: string | null
          setup_prompt_dismissed_at: string | null
          updated_at: string
          user_id: string
          webauthn_challenge: string | null
          webauthn_challenge_expires_at: string | null
          webauthn_challenge_purpose: string | null
        }
        Insert: {
          app_lock_enabled?: boolean
          auto_lock_seconds?: number
          biometric_aaguid?: string | null
          biometric_credential_id?: string | null
          biometric_public_key?: string | null
          biometric_sign_count?: number
          biometric_transports?: string[] | null
          created_at?: string
          failed_attempts?: number
          lock_after_payment?: boolean
          locked_until?: string | null
          pin_hash?: string | null
          pin_iterations?: number
          pin_length?: number | null
          pin_salt?: string | null
          setup_prompt_dismissed_at?: string | null
          updated_at?: string
          user_id: string
          webauthn_challenge?: string | null
          webauthn_challenge_expires_at?: string | null
          webauthn_challenge_purpose?: string | null
        }
        Update: {
          app_lock_enabled?: boolean
          auto_lock_seconds?: number
          biometric_aaguid?: string | null
          biometric_credential_id?: string | null
          biometric_public_key?: string | null
          biometric_sign_count?: number
          biometric_transports?: string[] | null
          created_at?: string
          failed_attempts?: number
          lock_after_payment?: boolean
          locked_until?: string | null
          pin_hash?: string | null
          pin_iterations?: number
          pin_length?: number | null
          pin_salt?: string | null
          setup_prompt_dismissed_at?: string | null
          updated_at?: string
          user_id?: string
          webauthn_challenge?: string | null
          webauthn_challenge_expires_at?: string | null
          webauthn_challenge_purpose?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_email_allowed: { Args: { _email: string }; Returns: boolean }
      dismiss_app_lock_prompt: { Args: never; Returns: undefined }
      finalize_due_payment_attempt: {
        Args: { _attempt_id: string }
        Returns: {
          failure_reason: string
          id: string
          new_balance: number
          stage: Database["public"]["Enums"]["payment_stage"]
          transaction_id: string
        }[]
      }
      get_or_create_my_referral_code: { Args: never; Returns: string }
      redeem_referral_code: {
        Args: { _code: string }
        Returns: {
          message: string
          ok: boolean
          referred_reward: number
        }[]
      }
    }
    Enums: {
      admin_status: "active" | "locked" | "disabled" | "pending"
      app_admin_role:
        | "super_admin"
        | "operations_manager"
        | "compliance_officer"
        | "customer_support"
        | "fraud_analyst"
        | "finance_manager"
      issue_priority: "low" | "normal" | "high" | "urgent"
      kyc_status: "not_started" | "pending" | "approved" | "rejected"
      onboarding_stage:
        | "STAGE_0"
        | "STAGE_1"
        | "STAGE_2"
        | "STAGE_3"
        | "STAGE_4"
        | "STAGE_5"
      payment_method: "upi" | "wallet" | "card"
      payment_stage:
        | "confirm"
        | "processing"
        | "success"
        | "failed"
        | "cancelled"
      referral_status: "pending" | "completed" | "rejected"
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
      admin_status: ["active", "locked", "disabled", "pending"],
      app_admin_role: [
        "super_admin",
        "operations_manager",
        "compliance_officer",
        "customer_support",
        "fraud_analyst",
        "finance_manager",
      ],
      issue_priority: ["low", "normal", "high", "urgent"],
      kyc_status: ["not_started", "pending", "approved", "rejected"],
      onboarding_stage: [
        "STAGE_0",
        "STAGE_1",
        "STAGE_2",
        "STAGE_3",
        "STAGE_4",
        "STAGE_5",
      ],
      payment_method: ["upi", "wallet", "card"],
      payment_stage: [
        "confirm",
        "processing",
        "success",
        "failed",
        "cancelled",
      ],
      referral_status: ["pending", "completed", "rejected"],
      txn_status: ["success", "pending", "failed"],
    },
  },
} as const
