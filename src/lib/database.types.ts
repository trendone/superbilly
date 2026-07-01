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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      actuals: {
        Row: {
          booking_id: string | null
          date: string
          employee_id: string | null
          hours: number
          id: string
        }
        Insert: {
          booking_id?: string | null
          date: string
          employee_id?: string | null
          hours: number
          id?: string
        }
        Update: {
          booking_id?: string | null
          date?: string
          employee_id?: string | null
          hours?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "actuals_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actuals_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          budget: number
          created_at: string
          employee_id: string
          end_date: string
          external_id: string | null
          id: string
          is_workshop: boolean
          locked: boolean
          note: string | null
          project_id: string
          source: string
          start_date: string
          workpackage_id: string | null
        }
        Insert: {
          budget: number
          created_at?: string
          employee_id: string
          end_date: string
          external_id?: string | null
          id?: string
          is_workshop?: boolean
          locked?: boolean
          note?: string | null
          project_id: string
          source?: string
          start_date: string
          workpackage_id?: string | null
        }
        Update: {
          budget?: number
          created_at?: string
          employee_id?: string
          end_date?: string
          external_id?: string | null
          id?: string
          is_workshop?: boolean
          locked?: boolean
          note?: string | null
          project_id?: string
          source?: string
          start_date?: string
          workpackage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_workpackage_id_fkey"
            columns: ["workpackage_id"]
            isOneToOne: false
            referencedRelation: "workpackages"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      employee_hours_periods: {
        Row: {
          employee_id: string
          id: string
          valid_from: string
          weekly_hours: number
        }
        Insert: {
          employee_id: string
          id?: string
          valid_from: string
          weekly_hours: number
        }
        Update: {
          employee_id?: string
          id?: string
          valid_from?: string
          weekly_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_hours_periods_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          active: boolean
          created_at: string
          department_id: string | null
          email: string | null
          id: string
          name: string
          weekly_hours: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          department_id?: string | null
          email?: string | null
          id?: string
          name: string
          weekly_hours?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          department_id?: string | null
          email?: string | null
          id?: string
          name?: string
          weekly_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          amount_eur: number | null
          due_date: string | null
          external_id: string | null
          id: string
          invoice_number: string | null
          invoice_status: string
          product: string | null
          project_id: string
          source: string
          title: string
        }
        Insert: {
          amount_eur?: number | null
          due_date?: string | null
          external_id?: string | null
          id?: string
          invoice_number?: string | null
          invoice_status?: string
          product?: string | null
          project_id: string
          source?: string
          title: string
        }
        Update: {
          amount_eur?: number | null
          due_date?: string | null
          external_id?: string | null
          id?: string
          invoice_number?: string | null
          invoice_status?: string
          product?: string | null
          project_id?: string
          source?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_actuals: {
        Row: {
          minutes: number
          period: string
          project_id: string
          revenue_eur: number | null
          service_code: string
          service_name: string | null
          source: string
          updated_at: string
        }
        Insert: {
          minutes?: number
          period: string
          project_id: string
          revenue_eur?: number | null
          service_code?: string
          service_name?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          minutes?: number
          period?: string
          project_id?: string
          revenue_eur?: number | null
          service_code?: string
          service_name?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_actuals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_external_map: {
        Row: {
          created_at: string
          external_id: string
          note: string | null
          project_id: string
          source: string
        }
        Insert: {
          created_at?: string
          external_id: string
          note?: string | null
          project_id: string
          source: string
        }
        Update: {
          created_at?: string
          external_id?: string
          note?: string | null
          project_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_external_map_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget_days: number | null
          budget_eur: number | null
          client: string | null
          color: string | null
          created_at: string
          day_rate_eur: number | null
          end_date: string | null
          external_id: string | null
          id: string
          is_new: boolean
          is_system: boolean
          name: string
          offer_number: string | null
          probability: number | null
          source: string
          start_date: string | null
          status: string
        }
        Insert: {
          budget_days?: number | null
          budget_eur?: number | null
          client?: string | null
          color?: string | null
          created_at?: string
          day_rate_eur?: number | null
          end_date?: string | null
          external_id?: string | null
          id?: string
          is_new?: boolean
          is_system?: boolean
          name: string
          offer_number?: string | null
          probability?: number | null
          source?: string
          start_date?: string | null
          status?: string
        }
        Update: {
          budget_days?: number | null
          budget_eur?: number | null
          client?: string | null
          color?: string | null
          created_at?: string
          day_rate_eur?: number | null
          end_date?: string | null
          external_id?: string | null
          id?: string
          is_new?: boolean
          is_system?: boolean
          name?: string
          offer_number?: string | null
          probability?: number | null
          source?: string
          start_date?: string | null
          status?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          email: string
          role: string
        }
        Insert: {
          created_at?: string
          email: string
          role?: string
        }
        Update: {
          created_at?: string
          email?: string
          role?: string
        }
        Relationships: []
      }
      workpackages: {
        Row: {
          assignee_id: string | null
          budget_days: number | null
          done: boolean
          end_date: string | null
          id: string
          project_id: string
          start_date: string | null
          title: string
        }
        Insert: {
          assignee_id?: string | null
          budget_days?: number | null
          done?: boolean
          end_date?: string | null
          id?: string
          project_id: string
          start_date?: string | null
          title: string
        }
        Update: {
          assignee_id?: string | null
          budget_days?: number | null
          done?: boolean
          end_date?: string | null
          id?: string
          project_id?: string
          start_date?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "workpackages_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workpackages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
