
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"diff": Json | null,"id": string,"space_id": string,"target_id": string | null,"target_type": string | null
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"diff"?: Json | null,"id"?: string,"space_id": string,"target_id"?: string | null,"target_type"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"diff"?: Json | null,"id"?: string,"space_id"?: string,"target_id"?: string | null,"target_type"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"environments": {
                  Row: {
                    "cloned_from_id": string | null,"created_at": string,"id": string,"is_main": boolean,"name": string,"space_id": string
                  }
                  Insert: {
                    "cloned_from_id"?: string | null,"created_at"?: string,"id"?: string,"is_main"?: boolean,"name": string,"space_id": string
                  }
                  Update: {
                    "cloned_from_id"?: string | null,"created_at"?: string,"id"?: string,"is_main"?: boolean,"name"?: string,"space_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "environments_cloned_from_id_space_id_fkey"
      columns: ["cloned_from_id","space_id"]
isOneToOne: false
      referencedRelation: "environments"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "environments_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"members": {
                  Row: {
                    "created_at": string,"invited_by": string | null,"role_id": string,"space_id": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"invited_by"?: string | null,"role_id": string,"space_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"invited_by"?: string | null,"role_id"?: string,"space_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "members_role_id_space_id_fkey"
      columns: ["role_id","space_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "members_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"organisations": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"plan": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"plan"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"plan"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"display_name": string | null,"is_agency_staff": boolean,"user_id": string
                  }
                  Insert: {
                    "avatar_url"?: string | null,"display_name"?: string | null,"is_agency_staff"?: boolean,"user_id": string
                  }
                  Update: {
                    "avatar_url"?: string | null,"display_name"?: string | null,"is_agency_staff"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"roles": {
                  Row: {
                    "id": string,"key": string,"name": string,"permissions": NonNullable<Json>,"space_id": string
                  }
                  Insert: {
                    "id"?: string,"key": string,"name": string,"permissions"?: NonNullable<Json>,"space_id": string
                  }
                  Update: {
                    "id"?: string,"key"?: string,"name"?: string,"permissions"?: NonNullable<Json>,"space_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "roles_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"spaces": {
                  Row: {
                    "created_at": string,"default_locale": string,"id": string,"name": string,"organisation_id": string,"preview_url": string | null,"settings": NonNullable<Json>,"slug": string
                  }
                  Insert: {
                    "created_at"?: string,"default_locale"?: string,"id"?: string,"name": string,"organisation_id": string,"preview_url"?: string | null,"settings"?: NonNullable<Json>,"slug": string
                  }
                  Update: {
                    "created_at"?: string,"default_locale"?: string,"id"?: string,"name"?: string,"organisation_id"?: string,"preview_url"?: string | null,"settings"?: NonNullable<Json>,"slug"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "spaces_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
