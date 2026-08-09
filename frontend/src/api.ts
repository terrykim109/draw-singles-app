/**
 * Backend client.
 *
 * Paths are relative so vite's dev proxy forwards /api and /uploads to Flask on
 * :5001 — no CORS, and the same build works when both are served from one origin.
 *
 * Every call can fail (backend down, model still loading, no torch). Callers are
 * expected to fall back to the bundled sample profiles rather than break: losing
 * the backend mid-demo should cost you live data, not the whole screen.
 */

export type ApiVectorProfile = {
  id: string;
  name: string | null;
  gender: string | null;
  interested_in: string[];
  class: string | null;
  confidence: number | null;
  group_id: string | null;
  drawing_url: string | null;
  top_k: { class: string; p: number }[];
  vector: number[];
};

export type ApiCreatedUser = {
  id: string;
  name: string;
  drawing_url: string | null;
  drawing_class: string | null;
  drawing_confidence: number | null;
  classification_status: string;
  classification_reason?: string;
  group_id: string | null;
};

export type ApiMatch = {
  id: string;
  similarity: number;
  class: string | null;
  name?: string;
  drawing_url?: string | null;
  group_id?: string | null;
};

export type ApiModel = {
  available: boolean;
  loaded?: boolean;
  classes?: number;
  temperature?: number;
  device?: string;
  checkpoint_present?: boolean;
  error?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const body = await response.json();
      detail = body.error ?? body.reason ?? detail;
    } catch {
      // non-JSON error body — the status is all we get
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export function getModel(): Promise<ApiModel> {
  return request<ApiModel>('/api/model');
}

export function getVectors(): Promise<{
  count: number;
  vector_dim: number;
  profiles: ApiVectorProfile[];
}> {
  return request('/api/vectors');
}

export function getMatches(id: string, limit = 20): Promise<{ matches: ApiMatch[] }> {
  return request(`/api/users/${id}/matches?limit=${limit}`);
}

/** Multipart, because the drawing is a real file the model has to open. */
export function createUser(input: {
  name: string;
  age?: number | null;
  gender?: string;
  interestedIn?: string[];
  drawing?: File | null;
}): Promise<ApiCreatedUser> {
  const form = new FormData();
  form.append('name', input.name);
  if (input.age != null) form.append('age', String(input.age));
  form.append('gender', input.gender ?? '');
  form.append('interested_in', (input.interestedIn ?? ['male', 'female', 'other']).join(','));
  if (input.drawing) form.append('drawing', input.drawing);

  return request<ApiCreatedUser>('/api/users', { method: 'POST', body: form });
}

export type ApiAccount = { id: string; token: string; error?: string };

/** Sign-up. Backed by /api/auth/register — same contract the rest of the app uses. */
export function createAccount(email: string, password: string): Promise<ApiAccount> {
  return request<ApiAccount>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

export function login(email: string, password: string): Promise<ApiAccount> {
  return request<ApiAccount>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Create the profile and classify the drawing in one call.
 * The photo goes as a base64 data URL, which is what the profile flow already
 * holds from the file preview — no second read of the file needed.
 */
export function completeProfile(
  userId: string,
  profile: { name: string; photo: string | null; answers: Record<string, string> }
): Promise<{
  id: string;
  drawing_class?: string | null;
  drawing_confidence?: number | null;
  classification_status?: string;
  group_id?: string | null;
}> {
  return request('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, ...profile }),
  });
}

/** Never throws — for deciding whether to run live or on sample data. */
export async function backendStatus(): Promise<{ up: boolean; model: ApiModel | null }> {
  try {
    const model = await getModel();
    return { up: true, model };
  } catch {
    try {
      await request('/api/health');
      return { up: true, model: null }; // server up, model not
    } catch {
      return { up: false, model: null };
    }
  }
}

/* ------------------------------------------------------------------ *
 * auth + profile + swipe endpoints
 * ------------------------------------------------------------------ */

const API = "/api";

export const api = {
  register: (email: string, password: string) =>
    fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then((r) => r.json()),

  createProfile: (user_id: string, profile: { name: string; photo: string | null; answers: Record<string, string> }) =>
    fetch(`${API}/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id, ...profile }),
    }).then((r) => r.json()),

  getFeed: (user_id: string) =>
    fetch(`${API}/profiles/feed?user_id=${user_id}`).then((r) => r.json()),

  swipe: (from: string, to: string, direction: "left" | "right") =>
    fetch(`${API}/swipes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, direction }),
    }).then((r) => r.json()),

  getMatches: (user_id: string) =>
    fetch(`${API}/matches?user_id=${user_id}`).then((r) => r.json()),
};
