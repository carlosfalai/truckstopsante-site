// Assistant vocal du site (Grok Voice, xAI) : remet au navigateur un jeton éphémère de courte durée.
// La clé XAI_API_KEY reste dans la Lambda ; le navigateur ne reçoit qu'un jeton valide quelques minutes.
const XAI_CLIENT_SECRETS = "https://api.x.ai/v1/realtime/client_secrets";
const ALLOWED_ORIGINS = ["https://truckstopsante.com", "https://www.truckstopsante.com"];

// Après un refus d'xAI (ex. crédit épuisé), on répond « désactivé » 10 minutes sans rappeler xAI.
const PAUSE_MS = 10 * 60 * 1000;
let pausedUntil = 0;

export async function createVoiceToken({ apiKey, origin, fetchImpl = fetch, now = Date.now }) {
  if (!apiKey || process.env.VOICE_ENABLED === "0") return { status: 503, body: { error: "voice_disabled" } };
  if (!ALLOWED_ORIGINS.includes(String(origin || ""))) return { status: 403, body: { error: "bad_origin" } };
  if (now() < pausedUntil) return { status: 503, body: { error: "voice_paused" } };
  const res = await fetchImpl(XAI_CLIENT_SECRETS, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expires_after: { seconds: 120 } }),
  });
  if (!res.ok) { console.error("tss_voice_token_failed", res.status); if (res.status !== 429) pausedUntil = now() + PAUSE_MS; return { status: 502, body: { error: "voice_unavailable" } }; }
  const data = await res.json();
  // Le format de réponse n'est pas documenté publiquement : on accepte les formes connues.
  const token = data.value || data.client_secret?.value || data.client_secret || data.token || "";
  if (!token || typeof token !== "string") { console.error("tss_voice_token_shape", Object.keys(data || {}).join(",")); return { status: 502, body: { error: "voice_unavailable" } }; }
  return { status: 200, body: { token, expires_at: data.expires_at || data.client_secret?.expires_at || null } };
}
