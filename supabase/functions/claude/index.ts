// Supabase Edge Function "claude": leitet Anfragen der App an die Anthropic-API weiter.
// Der API-Schlüssel liegt als Secret ANTHROPIC_API_KEY auf dem Server und erreicht nie den Browser.
//
// Zugang (Secrets in Supabase):
//   ALLOWED_EMAILS  = "du@uni.de,freundin@uni.de"  -> nur diese Konten dürfen Claude nutzen (empfohlen)
//   ALLOW_ALL_USERS = "true"                        -> stattdessen jedes angemeldete Konto (bewusst einschalten)
//   Ohne eins von beiden lehnt die Funktion alle Anfragen ab, damit Fremde nicht auf deine Kosten Claude nutzen.
//   DAILY_LIMIT     = "150"                         -> Anfragen pro Konto und Tag (Standard 150, "0" = kein Limit)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ALLOWED_MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"];
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Zählt die Anfrage in public.usage hoch und meldet, ob das Tageslimit noch nicht überschritten ist.
async function withinQuota(userId: string, limit: number): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/use_quota`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ p_user: userId, p_limit: limit }),
  });
  if (!res.ok) throw new Error("Zähler nicht erreichbar: " + (await res.text()));
  return (await res.json()) === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: { message: "Nur POST" } });

  // Wer fragt? Token gegen Supabase Auth prüfen
  const auth = req.headers.get("Authorization") ?? "";
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  });
  if (!userRes.ok) return json(401, { error: { message: "Nicht angemeldet" } });
  const user = await userRes.json();

  // Freigabe: Liste oder bewusst für alle geöffnet – sonst niemand
  const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const openForAll = (Deno.env.get("ALLOW_ALL_USERS") ?? "").toLowerCase() === "true";
  if (allowed.length ? !allowed.includes(String(user.email ?? "").toLowerCase()) : !openForAll) {
    return json(403, { error: { message: "Konto nicht freigeschaltet" } });
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json(500, { error: { message: "ANTHROPIC_API_KEY fehlt auf dem Server" } });

  // Tageslimit pro Konto
  const limit = Number(Deno.env.get("DAILY_LIMIT") ?? "150");
  if (limit > 0) {
    try {
      if (!(await withinQuota(String(user.id), limit))) {
        return json(429, { error: { message: `Tageslimit erreicht (${limit} Anfragen). Morgen geht es weiter.` } });
      }
    } catch (e) {
      return json(500, { error: { message: "Tageslimit konnte nicht geprüft werden. Wurde supabase/schema.sql ausgeführt? " + String(e) } });
    }
  }

  let body: { model?: string; max_tokens?: number; messages?: unknown; system?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: { message: "Ungültige Anfrage" } }); }
  const model = ALLOWED_MODELS.includes(String(body.model)) ? body.model : ALLOWED_MODELS[0];
  // system: Text oder Liste von Textblöcken (für Prompt-Caching mit cache_control)
  const system = typeof body.system === "string" || Array.isArray(body.system) ? body.system : undefined;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(Number(body.max_tokens) || 8000, 16000),
      stream: true,
      ...(system ? { system } : {}),
      messages: body.messages,
    }),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...CORS, "content-type": upstream.headers.get("content-type") ?? "text/event-stream" },
  });
});
