/** Database types for the Supabase schema. Regenerate with `npm run db:types`. */

// Hand-authored to match the output shape of
//   supabase gen types typescript --linked
// exactly, so regenerating is a drop-in replacement rather than a refactor.
// Kept in step with supabase/migrations/0001_core.sql by hand until the project
// is linked and generation can run in CI.
//
// CLAUDE.md §14: no `any`. Everything the application touches is typed from here.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      /* -- 0023: employment and compensation. §5's salary confinement means
            these three are the most restricted tables in the system: HR and the
            MD only, and salary_history has no UPDATE or DELETE for anyone. -- */
      employment_records: {
        Row: {
          profile_id: string;
          // 0024: `date_of_joining` lives on `profiles` and ONLY there.
          confirmation_date: string | null;
          last_increment_date: string | null;
          /** Derived by trigger. Never written by the application. */
          next_increment_date: string | null;
          increment_frequency_months: number;
          current_ctc: number | null;
          joining_ctc: number | null;
          // 0044: provenance for the baseline, which a column cannot carry
          // the way a history row does.
          joining_ctc_recorded_by: string | null;
          joining_ctc_recorded_at: string | null;
          salary_effective_from: string | null;
          employment_type: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          confirmation_date?: string | null;
          last_increment_date?: string | null;
          increment_frequency_months?: number;
          current_ctc?: number | null;
          joining_ctc?: number | null;
          joining_ctc_recorded_by?: string | null;
          joining_ctc_recorded_at?: string | null;
          salary_effective_from?: string | null;
          employment_type?: string;
        };
        Update: {
          confirmation_date?: string | null;
          last_increment_date?: string | null;
          increment_frequency_months?: number;
          current_ctc?: number | null;
          joining_ctc?: number | null;
          joining_ctc_recorded_by?: string | null;
          joining_ctc_recorded_at?: string | null;
          salary_effective_from?: string | null;
          employment_type?: string;
        };
        Relationships: [];
      };
      salary_history: {
        Row: {
          id: string;
          profile_id: string;
          effective_from: string;
          previous_ctc: number | null;
          new_ctc: number;
          hike_amount: number | null;
          hike_pct: number | null;
          reason: string;
          evaluation_id: string | null;
          recorded_by: string | null;
          recorded_at: string;
          note: string | null;
        };
        Insert: {
          profile_id: string;
          effective_from: string;
          previous_ctc?: number | null;
          new_ctc: number;
          hike_amount?: number | null;
          hike_pct?: number | null;
          reason: string;
          evaluation_id?: string | null;
          recorded_by?: string | null;
          note?: string | null;
        };
        // No Update type. The table refuses one, and a type that suggested
        // otherwise would be an invitation to write code that cannot run.
        Update: never;
        Relationships: [];
      };
      increment_reviews: {
        Row: {
          evaluation_id: string;
          joining_ctc: number | null;
          current_ctc: number;
          months_since_last_increment: number | null;
          employee_expectation_ctc: number | null;
          employee_expectation_note: string | null;
          hr_proposed_ctc: number | null;
          hr_proposed_hike_pct: number | null;
          hr_justification: string | null;
          md_approved_ctc: number | null;
          md_approved_hike_pct: number | null;
          md_remarks: string | null;
          interview_date: string | null;
          interview_attendees: string | null;
          interview_notes: string | null;
          final_ctc: number | null;
          final_hike_pct: number | null;
          effective_from: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          evaluation_id: string;
          joining_ctc?: number | null;
          current_ctc: number;
          months_since_last_increment?: number | null;
          employee_expectation_ctc?: number | null;
          employee_expectation_note?: string | null;
          hr_proposed_ctc?: number | null;
          hr_proposed_hike_pct?: number | null;
          hr_justification?: string | null;
          md_approved_ctc?: number | null;
          md_approved_hike_pct?: number | null;
          md_remarks?: string | null;
          interview_date?: string | null;
          interview_attendees?: string | null;
          interview_notes?: string | null;
          final_ctc?: number | null;
          final_hike_pct?: number | null;
          effective_from?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          evaluation_id?: string;
          joining_ctc?: number | null;
          current_ctc?: number;
          months_since_last_increment?: number | null;
          employee_expectation_ctc?: number | null;
          employee_expectation_note?: string | null;
          hr_proposed_ctc?: number | null;
          hr_proposed_hike_pct?: number | null;
          hr_justification?: string | null;
          md_approved_ctc?: number | null;
          md_approved_hike_pct?: number | null;
          md_remarks?: string | null;
          interview_date?: string | null;
          interview_attendees?: string | null;
          interview_notes?: string | null;
          final_ctc?: number | null;
          final_hike_pct?: number | null;
          effective_from?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      due_items: {
        Row: {
          id: string;
          profile_id: string;
          milestone_type: string;
          due_on: string;
          status: string;
          skip_reason: string | null;
          evaluation_id: string | null;
          actioned_by: string | null;
          actioned_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          milestone_type: string;
          due_on: string;
          status?: string;
          skip_reason?: string | null;
          evaluation_id?: string | null;
          actioned_by?: string | null;
          actioned_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: string;
          skip_reason?: string | null;
          evaluation_id?: string | null;
          actioned_by?: string | null;
          actioned_at?: string | null;
        };
        Relationships: [];
      };
      increment_settings: {
        Row: {
          id: boolean;
          hike_bands: number[];
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          hike_bands?: number[];
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          hike_bands?: number[];
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      evaluation_reviews: {
        Row: {
          evaluation_id: string;
          hr_reviewed_by: string | null;
          hr_reviewed_at: string | null;
          hr_summary: string | null;
          hr_recommendation: string | null;
          md_reviewed_by: string | null;
          md_reviewed_at: string | null;
          md_remarks: string | null;
          md_outcome: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          evaluation_id: string;
          hr_reviewed_by?: string | null;
          hr_reviewed_at?: string | null;
          hr_summary?: string | null;
          hr_recommendation?: string | null;
          md_reviewed_by?: string | null;
          md_reviewed_at?: string | null;
          md_remarks?: string | null;
          md_outcome?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          evaluation_id?: string;
          hr_reviewed_by?: string | null;
          hr_reviewed_at?: string | null;
          hr_summary?: string | null;
          hr_recommendation?: string | null;
          md_reviewed_by?: string | null;
          md_reviewed_at?: string | null;
          md_remarks?: string | null;
          md_outcome?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      increment_reminders: {
        Row: {
          id: string;
          profile_id: string;
          due_date: string;
          remind_on: string;
          status: string;
          sent_at: string | null;
          evaluation_id: string | null;
          created_at: string;
        };
        Insert: {
          profile_id: string;
          due_date: string;
          remind_on: string;
          status?: string;
          sent_at?: string | null;
          evaluation_id?: string | null;
        };
        Update: { status?: string; sent_at?: string | null; evaluation_id?: string | null };
        Relationships: [];
      };
      /** 0036. What each section is called and where it sits. */
      form_sections: {
        Row: {
          section: Enums<"question_section">;
          label: string;
          sort_order: number;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          section: Enums<"question_section">;
          label: string;
          sort_order: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: {
          section?: Enums<"question_section">;
          label?: string;
          sort_order?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * 0035. §7's worker module — the shop-floor tick sheet.
       * Deliberately shares NO structure with `questions`: §5's module boundary
       * is enforced by 0008's CHECK, and the two banks never join.
       */
      /* -- The worker appraisal (0047). Four tables, and none of them shares a
            row with the staff module — §7's isolation rule made structural. -- */
      worker_cycles: {
        Row: {
          id: string;
          name: string;
          period_label: string;
          starts_on: string | null;
          self_due_on: string | null;
          supervisor_due_on: string | null;
          md_due_on: string | null;
          status: "DRAFT" | "ACTIVE" | "CLOSED";
          disclosure: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          period_label: string;
          starts_on?: string | null;
          self_due_on?: string | null;
          supervisor_due_on?: string | null;
          md_due_on?: string | null;
          status?: "DRAFT" | "ACTIVE" | "CLOSED";
          disclosure?: string;
          created_by?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          name?: string;
          period_label?: string;
          starts_on?: string | null;
          self_due_on?: string | null;
          supervisor_due_on?: string | null;
          md_due_on?: string | null;
          status?: "DRAFT" | "ACTIVE" | "CLOSED";
          disclosure?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      worker_evaluations: {
        Row: {
          id: string;
          cycle_id: string;
          worker_id: string;
          supervisor_id: string | null;
          department_id: string | null;
          status: "DRAFT" | "OPEN" | "PENDING_REVIEW" | "REVIEWED" | "CLOSED";
          self_submitted_at: string | null;
          supervisor_submitted_at: string | null;
          self_skipped: boolean;
          supervisor_skipped: boolean;
          md_reviewed_at: string | null;
          closed_at: string | null;
          excluded_at: string | null;
          excluded_reason: string | null;
          overall_tick: string | null;
          self_filled_via: string | null;
          self_filled_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          worker_id: string;
          supervisor_id?: string | null;
          department_id?: string | null;
          status?: "DRAFT" | "OPEN" | "PENDING_REVIEW" | "REVIEWED" | "CLOSED";
          self_submitted_at?: string | null;
          supervisor_submitted_at?: string | null;
          self_skipped?: boolean;
          supervisor_skipped?: boolean;
          overall_tick?: string | null;
        };
        Update: {
          supervisor_id?: string | null;
          status?: "DRAFT" | "OPEN" | "PENDING_REVIEW" | "REVIEWED" | "CLOSED";
          self_submitted_at?: string | null;
          supervisor_submitted_at?: string | null;
          self_skipped?: boolean;
          supervisor_skipped?: boolean;
          md_reviewed_at?: string | null;
          closed_at?: string | null;
          excluded_at?: string | null;
          excluded_reason?: string | null;
          overall_tick?: string | null;
          self_filled_via?: string | null;
          self_filled_by?: string | null;
        };
        Relationships: [];
      };
      /* 0050/0051: the worker form's salary block. Its own table because
         worker_evaluations is readable by the worker and their supervisor, and
         a column cannot be withheld by RLS — only a row. */
      worker_evaluation_decisions: {
        Row: {
          evaluation_id: string;
          salary_changed: boolean;
          old_ctc: number | null;
          increment_pct: number | null;
          new_ctc: number | null;
          md_remarks: string | null;
          decided_by: string | null;
          decided_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          evaluation_id: string;
          salary_changed?: boolean;
          old_ctc?: number | null;
          increment_pct?: number | null;
          new_ctc?: number | null;
          md_remarks?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
        };
        Update: {
          salary_changed?: boolean;
          old_ctc?: number | null;
          increment_pct?: number | null;
          new_ctc?: number | null;
          md_remarks?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
        };
        Relationships: [];
      };
      worker_evaluation_questions: {
        Row: {
          id: string;
          evaluation_id: string;
          question_id: string;
          text: string;
          help_text: string | null;
          sort_order: number;
          is_required: boolean;
          is_overall: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          evaluation_id: string;
          question_id: string;
          text: string;
          help_text?: string | null;
          sort_order: number;
          is_required?: boolean;
          is_overall?: boolean;
        };
        Update: never;
        Relationships: [];
      };
      worker_evaluation_responses: {
        Row: {
          id: string;
          evaluation_id: string;
          layer: "SELF" | "SUPERVISOR" | "MD";
          answers: Json;
          comments: Json;
          // 0050: the paper form's Supervisor Comment and Training Required.
          // On the RESPONSE row, so blindness comes from the existing per-layer
          // policy rather than needing a new one.
          overall_comment: string | null;
          training_required: boolean | null;
          submitted_at: string | null;
          submitted_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          evaluation_id: string;
          layer: "SELF" | "SUPERVISOR" | "MD";
          answers?: Json;
          comments?: Json;
          overall_comment?: string | null;
          training_required?: boolean | null;
          submitted_at?: string | null;
          submitted_by?: string | null;
        };
        Update: {
          answers?: Json;
          comments?: Json;
          overall_comment?: string | null;
          training_required?: boolean | null;
          submitted_at?: string | null;
          submitted_by?: string | null;
        };
        Relationships: [];
      };
      worker_questions: {
        Row: {
          id: string;
          text: string;
          help_text: string | null;
          response_type: Enums<"response_type">;
          answered_by: Enums<"answered_by">;
          is_required: boolean;
          sort_order: number;
          is_active: boolean;
          is_overall: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          text: string;
          help_text?: string | null;
          response_type?: Enums<"response_type">;
          answered_by?: Enums<"answered_by">;
          is_required?: boolean;
          sort_order?: number;
          is_active?: boolean;
          is_overall?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          text?: string;
          help_text?: string | null;
          response_type?: Enums<"response_type">;
          answered_by?: Enums<"answered_by">;
          is_required?: boolean;
          sort_order?: number;
          is_active?: boolean;
          is_overall?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      departments: {
        Row: {
          id: string;
          name: string;
          code: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          code?: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      profiles: {
        Row: {
          id: string;
          full_name: string;
          employee_code: string | null;
          /** NULL for a production worker, who never signs in (0071). */
          email: string | null;
          phone_e164: string | null;
          department_id: string | null;
          designation: string | null;
          date_of_joining: string | null;
          /** 0065: a data URI, shown on sheets this person has signed. */
          signature_image: string | null;
          track: Database["public"]["Enums"]["track_type"];
          reports_to: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          employee_code?: string | null;
          /** NULL for a production worker, who never signs in (0071). */
          email: string | null;
          phone_e164?: string | null;
          department_id?: string | null;
          designation?: string | null;
          date_of_joining?: string | null;
          signature_image?: string | null;
          track?: Database["public"]["Enums"]["track_type"];
          reports_to?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          employee_code?: string | null;
          /** NULL for a production worker, who never signs in (0071). */
          email?: string | null;
          phone_e164?: string | null;
          department_id?: string | null;
          designation?: string | null;
          date_of_joining?: string | null;
          signature_image?: string | null;
          track?: Database["public"]["Enums"]["track_type"];
          reports_to?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_reports_to_fkey";
            columns: ["reports_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      questions: {
        Row: {
          id: string;
          text: string;
          help_text: string | null;
          section: Database["public"]["Enums"]["question_section"];
          response_type: Database["public"]["Enums"]["response_type"];
          category: Database["public"]["Enums"]["question_category"];
          track: Database["public"]["Enums"]["track_type"];
          answered_by: Database["public"]["Enums"]["answered_by"];
          is_required: boolean;
          min_value: number | null;
          max_value: number | null;
          depends_on: string | null;
          depends_value: string | null;
          sort_order: number;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          // 0022 / §6: BOTH, EVALUATION_ONLY or INCREMENT_ONLY.
          cycle_scope: string;
        };
        Insert: {
          id?: string;
          text: string;
          help_text?: string | null;
          section: Database["public"]["Enums"]["question_section"];
          response_type: Database["public"]["Enums"]["response_type"];
          category: Database["public"]["Enums"]["question_category"];
          track?: Database["public"]["Enums"]["track_type"];
          answered_by?: Database["public"]["Enums"]["answered_by"];
          is_required?: boolean;
          min_value?: number | null;
          max_value?: number | null;
          depends_on?: string | null;
          depends_value?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          text?: string;
          help_text?: string | null;
          section?: Database["public"]["Enums"]["question_section"];
          response_type?: Database["public"]["Enums"]["response_type"];
          category?: Database["public"]["Enums"]["question_category"];
          track?: Database["public"]["Enums"]["track_type"];
          answered_by?: Database["public"]["Enums"]["answered_by"];
          is_required?: boolean;
          min_value?: number | null;
          max_value?: number | null;
          depends_on?: string | null;
          depends_value?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "questions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_depends_on_fkey";
            columns: ["depends_on"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };

      question_options: {
        Row: {
          id: string;
          question_id: string;
          label: string;
          value: string;
          sort_order: number;
        };
        Insert: {
          id?: string;
          question_id: string;
          label: string;
          value: string;
          sort_order?: number;
        };
        Update: {
          id?: string;
          question_id?: string;
          label?: string;
          value?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "question_options_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };

      department_questions: {
        Row: {
          id: string;
          department_id: string;
          question_id: string;
          sort_order: number;
        };
        Insert: {
          id?: string;
          department_id: string;
          question_id: string;
          sort_order?: number;
        };
        Update: {
          id?: string;
          department_id?: string;
          question_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "department_questions_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "department_questions_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };

      // Insert-only (§12). Update and delete are blocked by trigger, so the
      // Update type exists only to satisfy the generated shape.
      notification_settings: {
        Row: {
          id: boolean;
          outbound_paused: boolean;
          paused_by: string | null;
          paused_at: string | null;
          paused_reason: string | null;
          updated_at: string;
        };
        // No RLS policy admits either — set_outbound_paused is the write path.
        Insert: { id?: boolean; outbound_paused?: boolean };
        Update: Partial<Database["public"]["Tables"]["notification_settings"]["Insert"]>;
        Relationships: [];
      };

      app_notifications: {
        Row: {
          id: string;
          profile_id: string;
          template: string;
          title: string;
          body: string;
          href: string | null;
          evaluation_id: string | null;
          read_at: string | null;
          created_at: string;
          created_on: string;
        };
        // No client insert policy exists (0059) — the write path is
        // `raise_app_notification`. The type is here because `gen types` emits
        // it, not because anything may use it.
        Insert: {
          id?: string;
          profile_id: string;
          template: string;
          title: string;
          body: string;
          href?: string | null;
          evaluation_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        // Only `read_at` may change — 0059 has a trigger that refuses the rest.
        Update: { read_at?: string | null };
        Relationships: [];
      };

      notifications_log: {
        Row: {
          id: string;
          channel: string;
          recipient: string;
          template: string;
          evaluation_id: string | null;
          profile_id: string | null;
          status: string;
          provider_message_id: string | null;
          error: string | null;
          payload: Json;
          sent_by: string | null;
          created_at: string;
          sent_at: string | null;
        };
        // Insert and Update are typed for completeness only. There is no RLS
        // policy admitting either — queue_notification and settle_notification
        // are the sole write path (0010).
        Insert: {
          id?: string;
          channel: string;
          recipient: string;
          template: string;
          evaluation_id?: string | null;
          profile_id?: string | null;
          status?: string;
          provider_message_id?: string | null;
          error?: string | null;
          payload?: Json;
          sent_by?: string | null;
          created_at?: string;
          sent_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["notifications_log"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "notifications_log_evaluation_id_fkey";
            columns: ["evaluation_id"];
            isOneToOne: false;
            referencedRelation: "evaluations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_log_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      audit_log: {
        Row: {
          id: string;
          actor_id: string | null;
          entity: string;
          entity_id: string;
          action: string;
          from_status: string | null;
          to_status: string | null;
          diff: Json | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          entity: string;
          entity_id: string;
          action: string;
          from_status?: string | null;
          to_status?: string | null;
          diff?: Json | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_log"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      // §10: only SHA-256 hashes are stored. Clients never select from this
      // table — the SECURITY DEFINER functions are the only path.
      invite_tokens: {
        Row: {
          id: string;
          evaluation_id: string;
          profile_id: string;
          token_hash: string;
          channel: string;
          expires_at: string;
          used_at: string | null;
          revoked_at: string | null;
          attempt_count: number;
          created_by: string | null;
          created_at: string;
          // 0022: which layer this link opens. Neither opens the other.
          layer: Database["public"]["Enums"]["rating_layer"];
        };
        Insert: {
          id?: string;
          evaluation_id: string;
          profile_id: string;
          token_hash: string;
          channel: string;
          expires_at: string;
          used_at?: string | null;
          revoked_at?: string | null;
          attempt_count?: number;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["invite_tokens"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "invite_tokens_evaluation_id_fkey";
            columns: ["evaluation_id"];
            isOneToOne: false;
            referencedRelation: "evaluations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invite_tokens_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      evaluation_cycles: {
        Row: {
          id: string;
          name: string;
          period_label: string;
          track_scope: Database["public"]["Enums"]["track_type"];
          starts_on: string | null;
          self_due_on: string | null;
          lead_due_on: string | null;
          md_due_on: string | null;
          status: Database["public"]["Enums"]["cycle_status"];
          disclosure: Database["public"]["Enums"]["disclosure_policy"];
          variance_threshold: number;
          // 0022. Text with a CHECK, not enums — see the migration for why.
          cycle_type: string;
          cycle_kind: string;
          default_self_days: number;
          default_lead_days: number;
          launched_at: string | null;
          // 0032: the recycle bin. NULL means live.
          deleted_at: string | null;
          deleted_by: string | null;
          delete_reason: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          period_label: string;
          track_scope?: Database["public"]["Enums"]["track_type"];
          starts_on?: string | null;
          self_due_on?: string | null;
          lead_due_on?: string | null;
          md_due_on?: string | null;
          status?: Database["public"]["Enums"]["cycle_status"];
          disclosure?: Database["public"]["Enums"]["disclosure_policy"];
          variance_threshold?: number;
          cycle_type?: string;
          cycle_kind?: string;
          default_self_days?: number;
          default_lead_days?: number;
          launched_at?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          delete_reason?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["evaluation_cycles"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "evaluation_cycles_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      evaluations: {
        Row: {
          id: string;
          cycle_id: string;
          evaluatee_id: string;
          lead_id: string | null;
          department_id: string | null;
          track: Database["public"]["Enums"]["track_type"];
          status: Database["public"]["Enums"]["evaluation_status"];
          self_submitted_at: string | null;
          lead_submitted_at: string | null;
          md_finalized_at: string | null;
          closed_at: string | null;
          self_overall: number | null;
          lead_overall: number | null;
          final_overall: number | null;
          // 0021: HR advanced past a layer that never came in.
          self_skipped: boolean;
          lead_skipped: boolean;
          returned_to: string | null;
          // 0022: this person's OWN deadlines. A rolling cycle gives each
          // person different ones, so the cycle's dates stopped being the answer.
          due_self_on: string | null;
          due_lead_on: string | null;
          // 0009: non-null means HR withdrew this person from the cycle. The row
          // and its frozen snapshot are kept, so every live query filters on it.
          excluded_at: string | null;
          excluded_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          evaluatee_id: string;
          lead_id?: string | null;
          department_id?: string | null;
          track: Database["public"]["Enums"]["track_type"];
          status?: Database["public"]["Enums"]["evaluation_status"];
          self_submitted_at?: string | null;
          lead_submitted_at?: string | null;
          md_finalized_at?: string | null;
          closed_at?: string | null;
          self_overall?: number | null;
          lead_overall?: number | null;
          final_overall?: number | null;
          self_skipped?: boolean;
          lead_skipped?: boolean;
          returned_to?: string | null;
          due_self_on?: string | null;
          due_lead_on?: string | null;
          excluded_at?: string | null;
          excluded_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["evaluations"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "evaluations_cycle_id_fkey";
            columns: ["cycle_id"];
            isOneToOne: false;
            referencedRelation: "evaluation_cycles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "evaluations_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "evaluations_evaluatee_id_fkey";
            columns: ["evaluatee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "evaluations_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      // The frozen snapshot. question_id and depends_on are intentionally
      // unconstrained uuids — see the banner in 0003_cycles.sql.
      evaluation_questions: {
        Row: {
          id: string;
          evaluation_id: string;
          question_id: string;
          text: string;
          help_text: string | null;
          section: Database["public"]["Enums"]["question_section"];
          response_type: Database["public"]["Enums"]["response_type"];
          answered_by: Database["public"]["Enums"]["answered_by"];
          is_required: boolean;
          min_value: number | null;
          max_value: number | null;
          depends_on: string | null;
          depends_value: string | null;
          options: Json | null;
          sort_order: number;
        };
        Insert: {
          id?: string;
          evaluation_id: string;
          question_id: string;
          text: string;
          help_text?: string | null;
          section: Database["public"]["Enums"]["question_section"];
          response_type: Database["public"]["Enums"]["response_type"];
          answered_by: Database["public"]["Enums"]["answered_by"];
          is_required?: boolean;
          min_value?: number | null;
          max_value?: number | null;
          depends_on?: string | null;
          depends_value?: string | null;
          options?: Json | null;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["evaluation_questions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "evaluation_questions_evaluation_id_fkey";
            columns: ["evaluation_id"];
            isOneToOne: false;
            referencedRelation: "evaluations";
            referencedColumns: ["id"];
          },
        ];
      };

      evaluation_responses: {
        Row: {
          id: string;
          evaluation_id: string;
          layer: Database["public"]["Enums"]["rating_layer"];
          answers: Json;
          comments: Json;
          section_scores: Json | null;
          overall_score: number | null;
          submitted_at: string | null;
          submitted_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          evaluation_id: string;
          layer: Database["public"]["Enums"]["rating_layer"];
          answers?: Json;
          comments?: Json;
          section_scores?: Json | null;
          overall_score?: number | null;
          submitted_at?: string | null;
          submitted_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["evaluation_responses"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "evaluation_responses_evaluation_id_fkey";
            columns: ["evaluation_id"];
            isOneToOne: false;
            referencedRelation: "evaluations";
            referencedColumns: ["id"];
          },
        ];
      };

      evaluation_decisions: {
        Row: {
          id: string;
          evaluation_id: string;
          promotion_recommendation: string | null;
          increment_type: string | null;
          old_salary: number | null;
          increment_pct: number | null;
          new_salary: number | null;
          training_required: boolean | null;
          concerns: string | null;
          md_remarks: string | null;
          decided_by: string | null;
          decided_at: string | null;
        };
        Insert: {
          id?: string;
          evaluation_id: string;
          promotion_recommendation?: string | null;
          increment_type?: string | null;
          old_salary?: number | null;
          increment_pct?: number | null;
          new_salary?: number | null;
          training_required?: boolean | null;
          concerns?: string | null;
          md_remarks?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["evaluation_decisions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "evaluation_decisions_evaluation_id_fkey";
            columns: ["evaluation_id"];
            isOneToOne: true;
            referencedRelation: "evaluations";
            referencedColumns: ["id"];
          },
        ];
      };

      user_roles: {
        Row: {
          id: string;
          profile_id: string;
          role: Database["public"]["Enums"]["app_role"];
        };
        Insert: {
          id?: string;
          profile_id: string;
          role: Database["public"]["Enums"]["app_role"];
        };
        Update: {
          id?: string;
          profile_id?: string;
          role?: Database["public"]["Enums"]["app_role"];
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };

    Views: {
      // 0015 / P16. All security_invoker, so a select here is subject to the
      // same RLS as a select on the underlying tables.
      /** 0023: a person's OWN dates. Deliberately carries no salary column. */
      v_my_employment: {
        Row: {
          profile_id: string;
          date_of_joining: string;
          confirmation_date: string | null;
          employment_type: string;
        };
        Relationships: [];
      };
      /* 0040. The caller's OWN current CTC and nothing else — one row, one
         money column. Deliberately separate from v_my_employment, which still
         carries no salary at all (P19-2). */
      v_my_current_salary: {
        Row: {
          profile_id: string;
          current_ctc: number | null;
        };
        Relationships: [];
      };
      v_cycle_progress: {
        Row: {
          cycle_id: string;
          cycle_name: string;
          period_label: string;
          total: number;
          not_started: number;
          self_submitted: number;
          lead_reviewed: number;
          md_finalized: number;
          closed: number;
          percent_complete: number | null;
        };
        Relationships: [];
      };
      v_department_scores: {
        Row: {
          cycle_id: string;
          department_id: string | null;
          department_name: string | null;
          people: number;
          self_count: number;
          avg_self: number | null;
          avg_lead: number | null;
          avg_final: number | null;
          gap: number | null;
        };
        Relationships: [];
      };
      v_section_scores: {
        Row: {
          cycle_id: string;
          department_id: string | null;
          department_name: string | null;
          section: Database["public"]["Enums"]["question_section"];
          /** False for Job Specific Skills — different questions per department. */
          is_comparable: boolean;
          answer_count: number;
          avg_score: number | null;
          layer: Database["public"]["Enums"]["rating_layer"];
        };
        Relationships: [];
      };
      v_variance_by_lead: {
        Row: {
          cycle_id: string;
          lead_id: string | null;
          lead_name: string;
          reports_scored: number;
          mean_delta: number | null;
          mean_abs_delta: number | null;
        };
        Relationships: [];
      };
      v_rating_distribution: {
        Row: { cycle_id: string; bucket: string; people: number };
        Relationships: [];
      };
      v_employee_history: {
        Row: {
          profile_id: string;
          evaluation_id: string;
          cycle_id: string;
          cycle_name: string;
          period_label: string;
          starts_on: string | null;
          status: Database["public"]["Enums"]["evaluation_status"];
          self_overall: number | null;
          lead_overall: number | null;
          final_overall: number | null;
          promotion_recommendation: string | null;
          increment_type: string | null;
          increment_pct: number | null;
          disclosure: Database["public"]["Enums"]["disclosure_policy"];
        };
        Relationships: [];
      };
    };

    Functions: {
      apply_evaluation_transition: {
        Args: {
          p_evaluation_id: string;
          p_from_status: Database["public"]["Enums"]["evaluation_status"];
          p_to_status: Database["public"]["Enums"]["evaluation_status"];
          p_actor_id: string;
          p_action: string;
          p_reason?: string | null;
          p_diff?: Json | null;
          p_evaluation_patch?: Json;
          p_lock_layer?: Database["public"]["Enums"]["rating_layer"] | null;
          p_unlock_layer?: Database["public"]["Enums"]["rating_layer"] | null;
          p_answers?: Json | null;
          p_section_scores?: Json | null;
          p_overall_score?: number | null;
        };
        Returns: string;
      };
      can_see_evaluation: { Args: { evaluation_id: string }; Returns: boolean };
      // 0016 / P17.
      set_outbound_paused: {
        Args: { p_paused: boolean; p_reason?: string };
        Returns: boolean;
      };
      // 0014 / P14. All-or-nothing finalise: MD layer, decisions, transition and
      // one audit row per override, in one transaction.
      finalise_evaluation: {
        Args: {
          p_evaluation_id: string;
          p_resolved_answers: Json;
          p_section_scores: Json;
          p_overall_score: number | null;
          p_decisions: Json;
          p_overrides?: Json;
          p_scored_ids?: string[];
        };
        Returns: Json;
      };
      // 0011 / P12. Merges a patch rather than overwriting, so two in-flight
      // autosaves cannot lose an answer.
      merge_evaluation_answers: {
        Args: {
          p_evaluation_id: string;
          p_layer: Database["public"]["Enums"]["rating_layer"];
          p_answers_patch: Json;
          p_comments_patch?: Json;
          p_remove_keys?: string[];
        };
        Returns: Json;
      };
      // 0010 / P11. The only write path into notifications_log — there is no
      // insert or update policy on that table for anyone.
      apply_salary_to_record: {
        Args: {
          p_profile_id: string;
          p_new_ctc: number;
          p_effective_from: string;
          p_reason: string;
        };
        /** { figure_moved, clock_moved } — see 0066. */
        Returns: Json;
      };
      record_joining_salary: {
        Args: {
          p_profile_id: string;
          p_amount: number;
        };
        /** { seeded_current } — see 0069. */
        Returns: Json;
      };
      /**
       * The MD approves and closes a production appraisal (0070).
       *
       * SECURITY DEFINER because `worker_evaluations` admits only HR for
       * UPDATE — before this the MD's close matched zero rows, which PostgREST
       * reports as a success, and the screen blamed a race that had not
       * happened.
       */
      close_worker_appraisal: {
        Args: {
          p_evaluation_id: string;
          p_remarks: string | null;
        };
        Returns: undefined;
      };
      /** The MD sends a production appraisal back to HR, with a reason (0064). */
      return_worker_to_hr: {
        Args: {
          p_evaluation_id: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      raise_app_notification: {
        Args: {
          p_profile_id: string;
          p_template: string;
          p_title: string;
          p_body: string;
          p_href?: string | null;
          p_evaluation_id?: string | null;
        };
        /** Null when the dedupe index absorbed it — see 0059. */
        Returns: string | null;
      };
      queue_notification: {
        Args: {
          p_channel: string;
          p_recipient: string;
          p_template: string;
          p_evaluation_id?: string;
          p_profile_id?: string;
          p_payload?: Json;
        };
        Returns: string;
      };
      settle_notification: {
        Args: {
          p_id: string;
          p_status: string;
          p_provider_message_id?: string;
          p_error?: string;
        };
        Returns: undefined;
      };
      // 0009 / P10. Questions are assembled in TypeScript and passed in, so the
      // whole launch commits or rolls back as one transaction.
      launch_cycle: {
        Args: { p_cycle_id: string; p_payload: Json };
        Returns: Json;
      };
      reassign_evaluation_lead: {
        Args: { p_evaluation_id: string; p_new_lead_id: string; p_reason: string };
        Returns: Json;
      };
      exclude_evaluation: {
        Args: { p_evaluation_id: string; p_reason: string };
        Returns: Json;
      };
      record_salary_expectation: {
        Args: { p_evaluation_id: string };
        Returns: boolean;
      };
      /* 0054. Hand-authored like the rest of this file — Docker is unavailable
         here so `supabase gen types` cannot be run (P1-6). A cast at the call
         site would compile and leave the next `db:types` run to drop it. */
      complete_worker_appraisal: {
        Args: { p_evaluation_id: string };
        Returns: boolean;
      };
      compute_due_items: {
        Args: { p_on?: string };
        Returns: number;
      };
      ensure_rolling_cycle: {
        Args: { p_on?: string };
        Returns: string;
      };
      create_milestone_evaluation: {
        Args: {
          p_due_item_id: string;
          p_questions: Json;
          p_lead_id: string;
          p_due_self_on: string;
          p_due_lead_on: string;
          p_self_token: string | null;
          p_lead_token: string | null;
        };
        Returns: Json;
      };
      confirm_increment: {
        Args: {
          p_evaluation_id: string;
          p_final_ctc: number;
          p_final_hike_pct: number | null;
          p_effective_from: string;
          p_interview_date: string | null;
          p_interview_attendees: string | null;
          p_interview_notes: string | null;
        };
        Returns: Json;
      };
      import_employment: {
        Args: { p_rows: Json; p_file: string };
        Returns: Json;
      };
      consume_invite_token: {
        Args: { p_invite_id: string };
        Returns: { status: string; evaluation_id: string | null; layer: string | null }[];
      };
      current_profile_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      evaluation_disclosure_of: {
        Args: { evaluation_id: string };
        Returns: Database["public"]["Enums"]["disclosure_policy"];
      };
      evaluation_status_of: {
        Args: { evaluation_id: string };
        Returns: Database["public"]["Enums"]["evaluation_status"];
      };
      in_transition: { Args: { evaluation_id: string }; Returns: boolean };
      invite_pending_email: { Args: { p_invite_id: string }; Returns: string };
      is_evaluatee: { Args: { evaluation_id: string }; Returns: boolean };
      /* 0048: the worker ticks their own side on the supervisor's device.
         SECURITY DEFINER, because 0047's policy admits the SELF layer only to
         the worker's own session and must keep doing so. */
      submit_worker_self_handover: {
        Args: {
          p_evaluation_id: string;
          p_answers: Json;
        };
        Returns: undefined;
      };
      /* 0052: stamps one side's submission. SECURITY DEFINER because
         worker_evaluations is UPDATE-able by HR alone, and each side must be
         able to record its own submission without gaining the power to move
         the status. */
      submit_worker_layer: {
        Args: {
          p_evaluation_id: string;
          p_layer: "SELF" | "SUPERVISOR" | "MD";
        };
        Returns: undefined;
      };
      log_admin_action: {
        Args: {
          p_entity: string;
          p_entity_id: string;
          p_action: string;
          p_diff?: Json | null;
        };
        Returns: string;
      };
      /** 0034. Bulk Job Specific Skills import: HR only, all-or-nothing. */
      import_questions: {
        Args: {
          p_rows: Json;
          p_file: string;
          p_create_departments?: boolean;
        };
        Returns: Json;
      };
      is_lead_of_evaluation: { Args: { evaluation_id: string }; Returns: boolean };
      issue_invite_token: {
        Args: { p_evaluation_id: string; p_channel: string; p_token_hash: string };
        Returns: { id: string; expires_at: string }[];
      };
      verify_invite_token: {
        Args: { p_token_hash: string };
        Returns: {
          status: string;
          invite_id: string | null;
          evaluation_id: string | null;
          profile_id: string | null;
          email: string | null;
        }[];
      };
      has_role: {
        Args: { role: Database["public"]["Enums"]["app_role"] };
        Returns: boolean;
      };
      is_hr: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_lead_of: {
        Args: { target_profile: string };
        Returns: boolean;
      };
      is_md: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };

    Enums: {
      answered_by: "EMPLOYEE_AND_LEAD" | "EMPLOYEE_ONLY" | "LEAD_ONLY" | "MD_ONLY";
      app_role: "HR_ADMIN" | "MD" | "HOD" | "SUPERVISOR" | "EMPLOYEE";
      cycle_status: "DRAFT" | "ACTIVE" | "CLOSED";
      disclosure_policy: "NONE" | "SCORE_ONLY" | "SCORE_AND_DECISION" | "FULL";
      // 0020: the five AMEND-3 statuses. The four pre-blind values stay —
      // historical rows and audit diffs carry them, and 0021's CHECK is what
      // stops a NEW row using one.
      evaluation_status:
        | "DRAFT"
        | "OPEN"
        | "PENDING_HR_REVIEW"
        | "HR_APPROVED"
        | "MD_REVIEWED"
        | "INTERVIEW_DONE"
        | "CLOSED"
        | "CYCLE_ACTIVE"
        | "SELF_SUBMITTED"
        | "LEAD_REVIEWED"
        | "MD_FINALIZED";
      question_category: "CORE" | "DEPARTMENT";
      rating_layer: "SELF" | "LEAD" | "MD";
      question_section:
        | "METADATA"
        | "KPI"
        | "CORE_PERFORMANCE"
        | "BEHAVIOURAL"
        | "LEARNING"
        | "NARRATIVE"
        | "DEPARTMENT_SPECIFIC"
        | "MANAGER_REVIEW";
      response_type:
        | "SCALE_0_5"
        | "TICK_3"
        | "NUMBER"
        | "BOOLEAN"
        | "TEXT_SHORT"
        | "TEXT_LONG"
        | "SINGLE_SELECT"
        | "MULTI_SELECT"
        | "DATE";
      track_type: "STAFF" | "WORKER" | "BOTH";
    };

    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

/* ---------- Convenience aliases ---------- */
// So application code writes `Tables<"profiles">` rather than the full path.

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
/** A view's row type. Views are read-only, so there is no Insert or Update twin. */
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
