
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "api_tokens": {
                  Row: {
                    "created_at": string,"created_by": string | null,"environment_id": string,"id": string,"last_used_at": string | null,"name": string,"revoked_at": string | null,"scope": string,"space_id": string,"token_hash": string,"token_hint": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"environment_id": string,"id"?: string,"last_used_at"?: string | null,"name": string,"revoked_at"?: string | null,"scope": string,"space_id": string,"token_hash": string,"token_hint": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"environment_id"?: string,"id"?: string,"last_used_at"?: string | null,"name"?: string,"revoked_at"?: string | null,"scope"?: string,"space_id"?: string,"token_hash"?: string,"token_hint"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "api_tokens_environment_id_space_id_fkey"
      columns: ["environment_id","space_id"]
isOneToOne: false
      referencedRelation: "environments"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "api_tokens_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"asset_usages": {
                  Row: {
                    "asset_id": string,"entry_id": string,"field_path": string,"space_id": string
                  }
                  Insert: {
                    "asset_id": string,"entry_id": string,"field_path": string,"space_id": string
                  }
                  Update: {
                    "asset_id"?: string,"entry_id"?: string,"field_path"?: string,"space_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "asset_usages_asset_id_space_id_fkey"
      columns: ["asset_id","space_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "asset_usages_entry_id_space_id_fkey"
      columns: ["entry_id","space_id"]
isOneToOne: false
      referencedRelation: "entries"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "asset_usages_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"assets": {
                  Row: {
                    "alt": string | null,"created_at": string,"deleted_at": string | null,"filename": string,"focal_x": number | null,"focal_y": number | null,"folder": string | null,"height": number | null,"id": string,"mime": string,"path": string,"revision": number,"size_bytes": number,"space_id": string,"tags": (string)[],"title": string | null,"updated_at": string,"uploaded_by": string | null,"width": number | null
                  }
                  Insert: {
                    "alt"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"filename": string,"focal_x"?: number | null,"focal_y"?: number | null,"folder"?: string | null,"height"?: number | null,"id"?: string,"mime": string,"path": string,"revision"?: number,"size_bytes": number,"space_id": string,"tags"?: (string)[],"title"?: string | null,"updated_at"?: string,"uploaded_by"?: string | null,"width"?: number | null
                  }
                  Update: {
                    "alt"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"filename"?: string,"focal_x"?: number | null,"focal_y"?: number | null,"folder"?: string | null,"height"?: number | null,"id"?: string,"mime"?: string,"path"?: string,"revision"?: number,"size_bytes"?: number,"space_id"?: string,"tags"?: (string)[],"title"?: string | null,"updated_at"?: string,"uploaded_by"?: string | null,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "assets_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_events": {
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
                    "content_type_id": string,"created_at": string,"created_by": string | null,"current_version_id": string | null,"deleted_at": string | null,"environment_id": string,"folder_id": string | null,"id": string,"published_at": string | null,"published_version_id": string | null,"slug": string,"space_id": string,"status": string,"updated_at": string
                  }
                  Insert: {
                    "content_type_id": string,"created_at"?: string,"created_by"?: string | null,"current_version_id"?: string | null,"deleted_at"?: string | null,"environment_id": string,"folder_id"?: string | null,"id"?: string,"published_at"?: string | null,"published_version_id"?: string | null,"slug": string,"space_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "content_type_id"?: string,"created_at"?: string,"created_by"?: string | null,"current_version_id"?: string | null,"deleted_at"?: string | null,"environment_id"?: string,"folder_id"?: string | null,"id"?: string,"published_at"?: string | null,"published_version_id"?: string | null,"slug"?: string,"space_id"?: string,"status"?: string,"updated_at"?: string
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
                },"job_dead_letters": {
                  Row: {
                    "attempts": number,"enqueued_at": string,"error": string,"failed_at": string,"id": string,"message": NonNullable<Json>,"msg_id": number,"queue": string
                  }
                  Insert: {
                    "attempts": number,"enqueued_at": string,"error": string,"failed_at"?: string,"id"?: string,"message": NonNullable<Json>,"msg_id": number,"queue": string
                  }
                  Update: {
                    "attempts"?: number,"enqueued_at"?: string,"error"?: string,"failed_at"?: string,"id"?: string,"message"?: NonNullable<Json>,"msg_id"?: number,"queue"?: string
                  }
                  Relationships: [
                    
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
                },"not_found_hits": {
                  Row: {
                    "day": string,"hits": number,"last_referrer": string | null,"last_seen_at": string,"path": string,"space_id": string
                  }
                  Insert: {
                    "day": string,"hits"?: number,"last_referrer"?: string | null,"last_seen_at"?: string,"path": string,"space_id": string
                  }
                  Update: {
                    "day"?: string,"hits"?: number,"last_referrer"?: string | null,"last_seen_at"?: string,"path"?: string,"space_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "not_found_hits_space_id_fkey"
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
                    "cache_tags": (string)[],"content_type_api_id": string,"data": NonNullable<Json>,"entry_id": string,"environment_id": string,"full_path": string,"published_at": string,"space_id": string
                  }
                  Insert: {
                    "cache_tags"?: (string)[],"content_type_api_id": string,"data": NonNullable<Json>,"entry_id": string,"environment_id": string,"full_path": string,"published_at": string,"space_id": string
                  }
                  Update: {
                    "cache_tags"?: (string)[],"content_type_api_id"?: string,"data"?: NonNullable<Json>,"entry_id"?: string,"environment_id"?: string,"full_path"?: string,"published_at"?: string,"space_id"?: string
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
                },"redirects": {
                  Row: {
                    "created_at": string,"created_by": string | null,"from_path": string,"id": string,"space_id": string,"status": number,"to_path": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"from_path": string,"id"?: string,"space_id": string,"status"?: number,"to_path": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"from_path"?: string,"id"?: string,"space_id"?: string,"status"?: number,"to_path"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "redirects_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"release_items": {
                  Row: {
                    "added_at": string,"entry_id": string,"environment_id": string,"release_id": string,"space_id": string,"version_id": string
                  }
                  Insert: {
                    "added_at"?: string,"entry_id": string,"environment_id": string,"release_id": string,"space_id": string,"version_id": string
                  }
                  Update: {
                    "added_at"?: string,"entry_id"?: string,"environment_id"?: string,"release_id"?: string,"space_id"?: string,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "release_items_entry_id_environment_id_fkey"
      columns: ["entry_id","environment_id"]
isOneToOne: false
      referencedRelation: "entries"
      referencedColumns: ["id","environment_id"]
    },{
      foreignKeyName: "release_items_release_id_environment_id_fkey"
      columns: ["release_id","environment_id"]
isOneToOne: false
      referencedRelation: "releases"
      referencedColumns: ["id","environment_id"]
    },{
      foreignKeyName: "release_items_release_id_space_id_fkey"
      columns: ["release_id","space_id"]
isOneToOne: false
      referencedRelation: "releases"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "release_items_version_id_entry_id_fkey"
      columns: ["version_id","entry_id"]
isOneToOne: false
      referencedRelation: "entry_versions"
      referencedColumns: ["id","entry_id"]
    }
                  ]
                },"releases": {
                  Row: {
                    "created_at": string,"created_by": string | null,"environment_id": string,"error": string | null,"id": string,"name": string,"published_at": string | null,"published_by": string | null,"scheduled_at": string | null,"space_id": string,"status": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"environment_id": string,"error"?: string | null,"id"?: string,"name": string,"published_at"?: string | null,"published_by"?: string | null,"scheduled_at"?: string | null,"space_id": string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"environment_id"?: string,"error"?: string | null,"id"?: string,"name"?: string,"published_at"?: string | null,"published_by"?: string | null,"scheduled_at"?: string | null,"space_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "releases_environment_id_space_id_fkey"
      columns: ["environment_id","space_id"]
isOneToOne: false
      referencedRelation: "environments"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "releases_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"review_requests": {
                  Row: {
                    "comment": string | null,"decided_at": string | null,"decided_by": string | null,"decision": string | null,"entry_id": string,"id": string,"message": string | null,"requested_at": string,"requested_by": string | null,"space_id": string,"version_id": string
                  }
                  Insert: {
                    "comment"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string | null,"entry_id": string,"id"?: string,"message"?: string | null,"requested_at"?: string,"requested_by"?: string | null,"space_id": string,"version_id": string
                  }
                  Update: {
                    "comment"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string | null,"entry_id"?: string,"id"?: string,"message"?: string | null,"requested_at"?: string,"requested_by"?: string | null,"space_id"?: string,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "review_requests_entry_id_space_id_fkey"
      columns: ["entry_id","space_id"]
isOneToOne: false
      referencedRelation: "entries"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "review_requests_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "review_requests_version_id_entry_id_fkey"
      columns: ["version_id","entry_id"]
isOneToOne: false
      referencedRelation: "entry_versions"
      referencedColumns: ["id","entry_id"]
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
                },"scheduled_actions": {
                  Row: {
                    "action": string,"created_at": string,"created_by": string | null,"entry_id": string | null,"error": string | null,"finished_at": string | null,"id": string,"release_id": string | null,"run_at": string,"space_id": string,"status": string
                  }
                  Insert: {
                    "action": string,"created_at"?: string,"created_by"?: string | null,"entry_id"?: string | null,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"release_id"?: string | null,"run_at": string,"space_id": string,"status"?: string
                  }
                  Update: {
                    "action"?: string,"created_at"?: string,"created_by"?: string | null,"entry_id"?: string | null,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"release_id"?: string | null,"run_at"?: string,"space_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scheduled_actions_entry_id_space_id_fkey"
      columns: ["entry_id","space_id"]
isOneToOne: false
      referencedRelation: "entries"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "scheduled_actions_release_id_space_id_fkey"
      columns: ["release_id","space_id"]
isOneToOne: false
      referencedRelation: "releases"
      referencedColumns: ["id","space_id"]
    },{
      foreignKeyName: "scheduled_actions_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"space_locales": {
                  Row: {
                    "code": string,"created_at": string,"fallback_code": string | null,"is_default": boolean,"name": string,"path_prefix": string,"space_id": string
                  }
                  Insert: {
                    "code": string,"created_at"?: string,"fallback_code"?: string | null,"is_default"?: boolean,"name": string,"path_prefix": string,"space_id": string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"fallback_code"?: string | null,"is_default"?: boolean,"name"?: string,"path_prefix"?: string,"space_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "space_locales_space_id_fallback_code_fkey"
      columns: ["space_id","fallback_code"]
isOneToOne: false
      referencedRelation: "space_locales"
      referencedColumns: ["space_id","code"]
    },{
      foreignKeyName: "space_locales_space_id_fkey"
      columns: ["space_id"]
isOneToOne: false
      referencedRelation: "spaces"
      referencedColumns: ["id"]
    }
                  ]
                },"spaces": {
                  Row: {
                    "created_at": string,"id": string,"locale_prefixes": boolean,"name": string,"organisation_id": string,"preview_url": string | null,"require_approval": boolean,"settings": NonNullable<Json>,"slug": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"locale_prefixes"?: boolean,"name": string,"organisation_id": string,"preview_url"?: string | null,"require_approval"?: boolean,"settings"?: NonNullable<Json>,"slug": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"locale_prefixes"?: boolean,"name"?: string,"organisation_id"?: string,"preview_url"?: string | null,"require_approval"?: boolean,"settings"?: NonNullable<Json>,"slug"?: string
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
"complete_onboarding_step":
{ Args: { "p_space_id": string,"p_step": string }; Returns: undefined
                           },
"custom_access_token_hook":
{ Args: { "event": Json }; Returns: Json
                           },
"dismiss_onboarding":
{ Args: { "p_space_id": string }; Returns: undefined
                           },
"editor_topic_space":
{ Args: { "topic": string }; Returns: string
                           },
"enqueue_due_scheduled_actions":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"has_space_role":
{ Args: { "roles": (string)[],"space": string }; Returns: boolean
                           },
"is_agency_staff":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"onboarding_steps":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"record_not_found":
{ Args: { "missed_path": string,"referrer"?: string,"space": string }; Returns: undefined
                           },
"site_path":
{ Args: { "full_path": string }; Returns: string
                           },
"space_requires_approval":
{ Args: { "space": string }; Returns: boolean
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
