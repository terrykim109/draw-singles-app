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