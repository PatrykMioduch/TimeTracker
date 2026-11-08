export type Bindings = Env;

export type User = {
  id: number;
  login: string;
  is_admin: number;
  active: number;
};

export type Project = {
  id: number;
  name: string;
  description: string;
  active: number;
  color?: string;
};

export type TimeEntry = {
  id: number;
  project_id: number;
  user_id: number;
  entry_date: string;
  started_at: string | null;
  ended_at: string | null;
  duration_sec: number;
  note: string;
  project_name?: string;
  project_color?: string;
  user_login?: string;
};

export type Variables = {
  user: User;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
