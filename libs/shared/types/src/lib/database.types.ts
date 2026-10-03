
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
                },"block_types": {
                  Row: {
                    "allowed_children": (string)[],"api_id": string,"created_at": string,"environment_id": string,"fields": NonNullable<Json>,"icon": string | null,"id": string,"name": string,"preview_image_path": string | null,"schema_version": number,"space_id": string,"style_options": NonNullable<Json>,"updated_at": string
                  }
                  Insert: {
                    "allowed_children"?: (string)[],"api_id": string,"created_at"?: string,"environment_id": string,"fields"?: NonNullable<Json>,"icon"?: string | null,"id"?: string,"name": string,"preview_image_path"?: string | null,"schema_version"?: number,"space_id": string,"style_options"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "allowed_children"?: (string)[],"api_id"?: string,"created_at"?: string,"environment_id"?: string,"fields"?: NonNullable<Json>,"icon"?: string | null,"id"?: string,"name"?: string,"preview_image_path"?: string | null,"schema_version"?: number,"space_id"?: string,"style_options"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "block_types_environment_id_space_id_fkey"
      columns: ["environment_id","space_id"]
isOneToOne: false
      referencedRelation: "environments"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "block_types_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"content_types": {
                  Row: {
                    "api_id": string,"created_at": string,"description": string | null,"environment_id": string,"fields": NonNullable<Json>,"id": string,"kind": string,"name": string,"space_id": string,"updated_at": string
                  }
                  Insert: {
                    "api_id": string,"created_at"?: string,"description"?: string | null,"environment_id": string,"fields"?: NonNullable<Json>,"id"?: string,"kind": string,"name": string,"space_id": string,"updated_at"?: string
                  }
                  Update: {
                    "api_id"?: string,"created_at"?: string,"description"?: string | null,"environment_id"?: string,"fields"?: NonNullable<Json>,"id"?: string,"kind"?: string,"name"?: string,"space_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_types_environment_id_space_id_fkey"
      columns: ["environment_id","space_id"]
isOneToOne: false
      referencedRelation: "environments"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "content_types_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"entries": {
                  Row: {
                    "content_type_id": string,"created_at": string,"created_by": string | null,"current_version_id": string | null,"deleted_at": string | null,"environment_id": string,"folder_id": string | null,"id": string,"locale": string,"published_at": string | null,"published_version_id": string | null,"slug": string,"space_id": string,"status": string,"updated_at": string
                  }
                  Insert: {
                    "content_type_id": string,"created_at"?: string,"created_by"?: string | null,"current_version_id"?: string | null,"deleted_at"?: string | null,"environment_id": string,"folder_id"?: string | null,"id"?: string,"locale": string,"published_at"?: string | null,"published_version_id"?: string | null,"slug": string,"space_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "content_type_id"?: string,"created_at"?: string,"created_by"?: string | null,"current_version_id"?: string | null,"deleted_at"?: string | null,"environment_id"?: string,"folder_id"?: string | null,"id"?: string,"locale"?: string,"published_at"?: string | null,"published_version_id"?: string | null,"slug"?: string,"space_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "entries_content_type_id_environment_id_fkey"
      columns: ["content_type_id","environment_id"]
isOneToOne: false
      referencedRelation: "content_types"
      referencedColumns: ["id","environment_id"]
    },{
      foreignKeyName: "entries_current_version_id_id_fkey"
      columns: ["current_version_id","id"]
isOneToOne: false
      referencedRelation: "entry_versions"
      referencedColumns: ["id","entry_id"]
    },{
      foreignKeyName: "entries_environment_id_space_id_fkey"
      columns: ["environment_id","space_id"]
isOneToOne: false
      referencedRelation: "environments"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "entries_folder_id_environment_id_fkey"
      columns: ["folder_id","environment_id"]
isOneToOne: false
      referencedRelation: "folders"
      referencedColumns: ["id","environment_id"]
    },{
      foreignKeyName: "entries_published_version_id_id_fkey"
      columns: ["published_version_id","id"]
isOneToOne: false
      referencedRelation: "entry_versions"
      referencedColumns: ["id","entry_id"]
    },{
      foreignKeyName: "entries_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"entry_versions": {
                  Row: {
                    "autosave": boolean,"created_at": string,"created_by": string | null,"data": NonNullable<Json>,"entry_id": string,"id": string,"message": string | null,"space_id": string
                  }
                  Insert: {
                    "autosave"?: boolean,"created_at"?: string,"created_by"?: string | null,"data": NonNullable<Json>,"entry_id": string,"id"?: string,"message"?: string | null,"space_id": string
                  }
                  Update: {
                    "autosave"?: boolean,"created_at"?: string,"created_by"?: string | null,"data"?: NonNullable<Json>,"entry_id"?: string,"id"?: string,"message"?: string | null,"space_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "entry_versions_entry_id_space_id_fkey"
      columns: ["entry_id","space_id"]
isOneToOne: false
      referencedRelation: "entries"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "entry_versions_space_id_fkey"
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
                },"folders": {
                  Row: {
                    "created_at": string,"environment_id": string,"id": string,"name": string,"parent_id": string | null,"path": string,"slug": string,"space_id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"environment_id": string,"id"?: string,"name": string,"parent_id"?: string | null,"path"?: string,"slug": string,"space_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"environment_id"?: string,"id"?: string,"name"?: string,"parent_id"?: string | null,"path"?: string,"slug"?: string,"space_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "folders_environment_id_space_id_fkey"
      columns: ["environment_id","space_id"]
isOneToOne: false
      referencedRelation: "environments"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "folders_parent_id_environment_id_fkey"
      columns: ["parent_id","environment_id"]
isOneToOne: false
      referencedRelation: "folders"
      referencedColumns: ["id","environment_id"]
    },{
      foreignKeyName: "folders_space_id_fkey"
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
                },"published_content": {
                  Row: {
                    "cache_tags": (string)[],"content_type_api_id": string,"data": NonNullable<Json>,"entry_id": string,"environment_id": string,"full_path": string,"locale": string,"published_at": string,"space_id": string
                  }
                  Insert: {
                    "cache_tags"?: (string)[],"content_type_api_id": string,"data": NonNullable<Json>,"entry_id": string,"environment_id": string,"full_path": string,"locale": string,"published_at": string,"space_id": string
                  }
                  Update: {
                    "cache_tags"?: (string)[],"content_type_api_id"?: string,"data"?: NonNullable<Json>,"entry_id"?: string,"environment_id"?: string,"full_path"?: string,"locale"?: string,"published_at"?: string,"space_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "published_content_entry_id_environment_id_fkey"
      columns: ["entry_id","environment_id"]
isOneToOne: false
      referencedRelation: "entries"
      referencedColumns: ["id","environment_id"]
    },{
      foreignKeyName: "published_content_entry_id_space_id_fkey"
      columns: ["entry_id","space_id"]
isOneToOne: false
      referencedRelation: "entries"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "published_content_environment_id_space_id_fkey"
      columns: ["environment_id","space_id"]
isOneToOne: false
      referencedRelation: "environments"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "published_content_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
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
            "auth_space_ids":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"custom_access_token_hook":
{ Args: { "event": Json }; Returns: Json
                           },
"has_space_role":
{ Args: { "roles": (string)[],"space": string }; Returns: boolean
                           },
"is_agency_staff":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           }
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
