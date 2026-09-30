export interface Opportunity {
  id: number;
  role_slug: string;
  company: string;
  title: string;
  url: string;
  score: number;
  archetype: string;
  sector: string | null;
  status: 'filed' | 'review' | 'weak' | 'declined' | 'applied';
  work_arrangement: string;
  location: string | null;
  compensation: string;
  benefits: string[];
  summary: string;
  fit_strengths: string[];
  gaps: string[];
  raw_text?: string;
  created_at: string;
  updated_at: string;
}

export interface Stats {
  total: number;
  filed: number;
  review: number;
  declined: number;
  applied: number;
  weak: number;
  avg_score: number;
}

export interface DailyCost {
  day: string;
  llm_tokens: number;
  llm_cost: number;
  tavily_credits: number;
  tavily_cost: number;
  total_cost: number;
  event_count: number;
}

export interface CostTelemetry {
  total_usd: number;
  llm_total_usd: number;
  llm_total_tokens: number;
  tavily_total_usd: number;
  tavily_total_credits: number;
  total_events: number;
  daily: DailyCost[];
}

export type Role = 'discovery' | 'qualify' | 'tailor' | 'orient';
export type Provider = 'openrouter' | 'claude-code';
export const ROLES: Role[] = ['discovery', 'qualify', 'tailor', 'orient'];

export interface DbStatus {
  ok: boolean;
  initialized: boolean;
  host: string;
  port: string;
  dbname: string;
  user: string;
  opportunities?: number;
  created?: boolean;
  error?: string;
}

export interface UploadFile {
  name: string;
  size: number;
  kind: string;
  extracted_chars: number | null;
}

export interface SetupStatus {
  complete: boolean;
  llm: { provider: Provider; configured: boolean; openrouter_key_set: boolean; models: Record<Role, string> };
  tavily: { key_set: boolean };
  db: DbStatus;
  profile: { exists: boolean; name: string | null; facts: boolean; voice: boolean; skills: boolean };
  uploads: UploadFile[];
  interview_chars: number;
}

export type ModelOverrides = Partial<Record<Role | 'default', string>>;

export interface Settings {
  provider: Provider;
  openrouter_key_set: boolean;
  openrouter_key_hint: string;
  tavily_key_set: boolean;
  tavily_key_hint: string;
  models: Record<Provider, Record<Role, string>>;
  model_overrides: Record<Provider, ModelOverrides>;
  defaults: Record<Provider, Record<Role, string>>;
  db: { host: string; port: string; dbname: string; user: string; password_set: boolean };
}

export interface SettingsUpdate {
  provider?: Provider;
  openrouter_api_key?: string;
  tavily_api_key?: string;
  models?: Partial<Record<Provider, ModelOverrides>>;
  db?: { host?: string; port?: string; dbname?: string; user?: string; password?: string };
}

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  prompt_per_m: number;
  completion_per_m: number;
  tools: boolean;
  structured: boolean;
  batch: boolean;
}

export interface LlmCheck {
  ok: boolean;
  provider: Provider;
  models: Record<Role, string>;
  model?: string;
  reply?: string;
  problems?: string[];
  error?: string;
  key?: Record<string, unknown>;
}

export interface TavilyCheck {
  ok: boolean;
  results?: number;
  error?: string;
}

export interface Job<T> {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'error';
  log: string[];
  result: T | null;
  error: string | null;
  elapsed_s: number;
  meta: Record<string, unknown>;
}

export interface Metro {
  key: string;
  label: string;
  search: string;
  signal: string;
}

export interface Board {
  company: string;
  ats: 'greenhouse' | 'ashby';
  slug: string;
}

export interface Scope {
  key: string;
  label: string;
  brief: string;
  queries: string[];
  location_gate: boolean;
}

export interface Profile {
  candidate: {
    name: string;
    headline: string;
    location: string;
    email: string;
    phone: string;
    website: string;
    linkedin: string;
    summary: string;
  };
  search: {
    country: string;
    remote_ok: boolean;
    metros: Metro[];
    title_keywords: string[];
    exclude_title_keywords: string[];
    target_companies: string[];
    boards: Board[];
    scopes: Scope[];
    exclude_domains: string[];
  };
  scoring: { bullseye: string[]; strong_fit: string; priority_bonus: string[]; low_fit: string[] };
  resume: { positioning: string; rules: string[]; accent_color: string };
}

export interface ProfileBundle {
  profile: Profile | null;
  facts: string;
  voice: string;
  skills: string;
  recommendations: string;
}

export interface Meta {
  app_name: string;
  candidate_name: string | null;
  provider: Provider;
  models: Record<Role, string>;
  scopes: { key: string; label: string }[];
  metros: { key: string; label: string }[];
  positioning: string;
}
