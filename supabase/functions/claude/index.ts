// Supabase Edge Function "claude": leitet Anfragen der App an die Anthropic-API weiter.
// Der API-Schlüssel liegt als Secret ANTHROPIC_API_KEY auf dem Server und erreicht nie den Browser.
// Optional: ALLOWED_EMAILS = "du@uni.de,freundin@uni.de" beschränkt die Nutzung auf diese Konten.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ALLOWED_MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"];
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: { message: "Nur POST" } });

  // Wer fragt? Token gegen Supabase Auth prüfen
  const auth = req.headers.get("Authorization") ?? "";
  const userRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  });
  if (!userRes.ok) return json(401, { error: { message: "Nicht angemeldet" } });
  const user = await userRes.json();

  const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(String(user.email ?? "").toLowerCase())) {
    return json(403, { error: { message: "Konto nicht freigeschaltet" } });
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json(500, { error: { message: "ANTHROPIC_API_KEY fehlt auf dem Server" } });

  let body: { model?: string; max_tokens?: number; messages?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: { message: "Ungültige Anfrage" } }); }
  const model = ALLOWED_MODELS.includes(String(body.model)) ? body.model : ALLOWED_MODELS[0];

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(Number(body.max_tokens) || 8000, 16000),
      stream: true,
      messages: body.messages,
    }),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...CORS, "content-type": upstream.headers.get("content-type") ?? "text/event-stream" },
  });
});
