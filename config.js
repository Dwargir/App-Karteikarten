/* Server-Verbindung für alle Nutzer der App.
   Trag hier die Werte aus deinem Supabase-Projekt ein (Project Settings → API).
   Beide Werte sind öffentlich und dürfen ins Repository; geschützt wird alles über Row Level Security. */
window.SK_CONFIG = {
  supabaseUrl: "",        // z. B. "https://abcdxyz.supabase.co"
  supabaseAnonKey: "",    // "anon public" Key
  useProxyByDefault: true // Claude über die Edge Function "claude" nutzen, sobald man angemeldet ist
};
