import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wlomgcmwctpdpqoytbrc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indsb21nY213Y3RwZHBxb3l0YnJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MzM4NjgsImV4cCI6MjA5MjAwOTg2OH0.i-4JvM1Gvr10KvId4QjAbhG_TNLYhw4DFMmpE3YiU8k';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type IntakeSubmission = {
  id?: string;
  created_at?: string;
  user_id?: string | null;
  full_name: string;
  email: string;
  llc_name?: string;
  ein?: string;
  tax_year?: string;
  years_param?: string;
  sections_param?: string;
  parties_param?: number;
  rcl_param?: boolean;
  status?: 'pending' | 'in_progress' | 'completed';
};

export type Filing = {
  id?: string;
  created_at?: string;
  user_id: string;
  tax_year: string;
  form_type: string;
  status: 'pending' | 'in_progress' | 'completed';
  notes?: string;
  file_path?: string;
};
