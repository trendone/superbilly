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
          email: string | null
          id: string
          name: string
          weekly_hours: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name: string
          weekly_hours?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          weekly_hours?: number
        }
        Relationships: []
      }
      milestones: {
        Row: {
          amount_eur: number | null
          due_date: string | null
          id: string
          invoice_status: string
          project_id: string
          title: string
        }
        Insert: {
          amount_eur?: number | null
          due_date?: string | null
          id?: string
          invoice_status?: string
          project_id: string
          title: string
        }
        Update: {
          amount_eur?: number | null
          due_date?: string | null
          id?: string
          invoice_status?: string
          project_id?: string
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
      projects: {
        Row: {
          budget_days: number | null
          budget_eur: number | null
          client: string | null
          color: string | null
          created_at: string
          end_date: string | null
          external_id: string | null
          id: string
          is_system: boolean
          name: string
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
          end_date?: string | null
          external_id?: string | null
          id?: string
          is_system?: boolean
          name: string
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
          end_date?: string | null
          external_id?: string | null
          id?: string
          is_system?: boolean
          name?: string
          probability?: number | null
          source?: string
          start_date?: string | null
          status?: string
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
      [_ in never]: never
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
