export interface Card {
  _id?: string;
  notion_id: string;
  title: string;
  status?: string;
  type?: string | null;
  client_id?: string; // Client Notion ID
  client_name?: string; // Client name for easy filtering
  created_at: Date;
  updated_at: Date;
  last_synced_at: Date;
  metadata: {
    // Hours & Budget Fields
    projected_dev_hours?: number;
    actual_dev_hours?: number;
    actual_dev_hours_number?: number;
    actual_dev_hours_used?: string;
    total_project_hours?: number;
    projected_qi_hours?: number;
    total_qi_hours_decimal?: number;
    qi_hours?: string;
    buffer_hours?: number;
    projected_design_hours?: number;
    
    // Date Fields
    done_date?: Date;
    ready_for_client_date?: Date;
    deployment_date?: Date;
    original_due_date?: { start?: string; end?: string; time_zone?: string | null } | Date;
    previous_original_due_date?: Date;
    previous_dev_due_date?: Date;
    dev_due_date?: Date;
    created_time?: Date;
    last_updated?: Date;
    
    // People Assignments (arrays of Notion User IDs)
    account_manager_ids?: string[];
    developer_ids?: string[];
    lead_developer_ids?: string[];
    quality_inspector_ids?: string[];
    designer_ids?: string[];
    // Alternative field names (arrays of Notion User IDs)
    account_manager?: string[];
    developer?: string[];
    lead_developer?: string[];
    quality_inspector?: string[];
    designer?: string[];
    
    // Pushbacks
    pushback_count?: number; // Number of times pushed to QI (from "Push Back Count" property)
    client_pushback_count?: number; // Client pushback count (from "Client Pushback Count" property)
    quantifiable_client_pushback?: number; // Quantifiable client pushback (from "Quantifiable Client Push Back" property)
    
    // Days Late
    days_late?: number;
    late?: string; // Late status string (e.g., "💀 LATE")
    is_late?: boolean;
    
    // Tasks & Relations
    tasks?: string[];
    task_ids?: string[];
    client?: string[];
    client_ids?: string[];
    all_qi_time_tracker_entries?: string[];
    
    // Task Completion
    completed_tasks?: number;
    completed_qi_tasks?: number;
    
    // Time Doctor Integration
    time_doctor_task_id?: string;
    time_doctor_project_id?: string;
    add_to_time_doctor_projects?: boolean;
    
    // Client Information
    client_db_id?: Array<{
      type: string;
      rich_text?: Array<{
        type: string;
        text: {
          content: string;
          link: string | null;
        };
        annotations: {
          bold: boolean;
          italic: boolean;
          strikethrough: boolean;
          underline: boolean;
          code: boolean;
          color: string;
        };
        plain_text: string;
        href: string | null;
      }>;
    }>;
    client_name_duplicate?: string;
    
    // Status & Properties
    status?: string; // Status in metadata (duplicate of top-level status)
    name?: string;
    temp?: string;
    lastqiworked?: string;
    checknotionbi?: Array<{
      type: string;
      select?: {
        id: string;
        name: string;
        color: string;
      };
    }>;
    urgency_status_client?: Array<{
      type: string;
      select?: {
        id: string;
        name: string;
        color: string;
      };
    }>;
    
    // Notion Property Mapping
    _notion_property_mapping?: Record<string, string>;
    
    // Allow additional properties
    [key: string]: any;
  };
}

export interface TeamMember {
  _id?: string;
  notion_id?: string;
  notion_user_id?: string; // Notion user ID for mapping people properties
  name: string;
  email?: string;
  role?: string; // Position
  team?: string; // First department
  active: boolean;
  created_at?: Date;
  metadata?: {
    // Performance & Organization
    level?: string; // Junior, Mid, Senior, Lead
    departments?: string[]; // All departments (multi-select)
    country?: string;
    tech_stack?: string[]; // Technologies they work with
    lead_id?: string; // Lead Notion user ID (from people property)
    referral_id?: string; // Referral Notion user ID (from people property)
    
    // Rates & Compensation
    salary?: number;
    future_salary?: number;
    last_increase_date?: Date;
    next_increase_date?: Date;
    
    // Contact & Profile
    phone?: string;
    company_email?: string;
    personal_email?: string;
    linkedin_url?: string;
    github_url?: string;
    profile_picture_url?: string;
    cv_url?: string;
    
    // Dates
    birthday?: Date;
    hire_date?: Date;
    last_day?: Date; // For resigned/deactivated members
    
    // Leave Balances
    vacation_balance?: number;
    sick_balance?: number;
    emergency_balance?: number;
    maternity_balance?: number;
    last_balance_update?: Date;
    
    // Hiring & Status
    source?: string; // How they were hired (Applied Website, Referral, LinkedIn, etc.)
    interview_stage?: string;
    employment_status?: string; // Active, Resigned, Deactivated
    reason_leaving?: string; // If resigned/deactivated
    gender?: string;
    
    // Additional
    payday?: Date;
    invoices_url?: string;
    notes?: string;
    [key: string]: any;
  };
}

export interface CardStatusHistory {
  _id?: string;
  card_id: string;
  status: string;
  changed_at: Date;
  detected_at: Date;
  source?: 'notion' | 'manual' | 'automated';
  metadata?: Record<string, any>;
}

export interface MetricsCache {
  _id?: string;
  metric_type: string;
  period_type: 'daily' | 'weekly' | 'monthly';
  period_start: Date;
  period_end: Date;
  team_member_id?: string;
  team?: string;
  value: number;
  metadata?: Record<string, any>;
  calculated_at?: Date;
}

export interface SyncLog {
  _id?: string;
  sync_type: 'full' | 'incremental' | 'backfill';
  status: 'success' | 'partial' | 'failed';
  records_processed: number;
  records_failed: number;
  error_count: number;
  started_at: Date;
  completed_at?: Date;
  error_message?: string;
  metadata?: Record<string, any>;
}

// Time Doctor Integration Types
export interface TimeDoctorUser {
  _id?: string;
  time_doctor_id: string; // Time Doctor user ID
  notion_user_id?: string; // Matched Notion team member ID
  name: string;
  email?: string;
  role?: string;
  active: boolean;
  created_at: Date;
  last_synced_at: Date;
  metadata?: Record<string, any>;
}

export interface TimeDoctorProject {
  _id?: string;
  time_doctor_id: string; // Time Doctor project ID
  notion_card_id?: string; // Matched Notion card/project ID
  notion_client_id?: string; // Matched Notion client ID
  name: string;
  client_name?: string;
  is_internal: boolean;
  created_at: Date;
  last_synced_at: Date;
  metadata?: Record<string, any>;
}

export interface TimeDoctorWorklog {
  _id?: string;
  time_doctor_id?: string; // Time Doctor worklog entry ID
  time_doctor_user_id: string; // Time Doctor user ID
  time_doctor_project_id: string; // Time Doctor project ID
  notion_user_id?: string; // Matched Notion team member ID
  notion_card_id?: string; // Matched Notion card ID
  notion_client_id?: string; // Matched Notion client ID
  date: Date; // Date of work
  hours: number; // Hours worked
  minutes: number; // Minutes worked (for precision)
  task_name?: string;
  cost?: number; // Calculated cost (hours × hourly_rate)
  hourly_rate?: number; // Employee hourly rate at time of work
  period_start?: Date; // Time Doctor period start
  period_end?: Date; // Time Doctor period end
  mode?: string; // Work mode (manual, automatic, etc.)
  created_at: Date;
  synced_at: Date;
  metadata?: Record<string, any>;
}

export interface TimeDoctorMetrics {
  client_id?: string;
  client_name?: string;
  user_id?: string;
  user_name?: string;
  period_start: Date;
  period_end: Date;
  total_hours: number;
  total_cost: number;
  total_entries: number;
  avg_hours_per_day: number;
  metadata?: Record<string, any>;
}

export interface Client {
  _id?: string;
  notion_id: string; // Notion page ID (unique)
  name: string; // Client name
  is_retired?: boolean; // Whether client is retired (from Type property)
  revenue?: number; // Monthly revenue in USD (from client_revenue import)
  created_at: Date;
  updated_at: Date;
  last_synced_at: Date;
  metadata?: {
    type?: string; // Client type (Full Time, Part Time, Retired, etc.)
    status?: string; // Status (Not started, In progress, Done)
    urgency_status?: string; // Urgency Status (💚 All OK, 📡Radar, 💨Smoke, 🔥FIRE)
    account_manager?: string[]; // Account Manager Notion User IDs
    time_doctor_project_id?: string; // Time Doctor (Client) Project ID
    [key: string]: any;
  };
}

export interface ClientRevenue {
  _id?: string;
  client_name: string; // Client name (indexed)
  client_id?: string; // Notion client ID if matched
  revenue: number; // Monthly revenue in USD
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

