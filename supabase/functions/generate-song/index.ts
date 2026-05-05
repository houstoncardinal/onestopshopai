import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildSystemPrompt, buildUserPrompt, LYRIC_ENGINE_VERSION } from "./lyric-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { analysis, style, theme, mood } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const sys = buildSystemPrompt();
    const user = buildUserPrompt(analysis, style, theme, mood);
    console.log(`HITLAB lyric engine v${LYRIC_ENGINE_VERSION} — generating ${style}/${mood}`);

    const tools = [{
      type: "function",
      function: {
        name: "deliver_song",
        description: "Deliver the complete song package",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            tagline: { type: "string", description: "One-line elevator pitch for the song" },
            hook_analysis: { type: "string", description: "Why this hook works (2-3 sentences)" },
            structure: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  section: { type: "string", enum: ["Intro","Verse 1","Pre-Chorus","Chorus","Verse 2","Bridge","Outro","Post-Chorus","Drop"] },
                  lyrics: { type: "string" },
                  performance_note: { type: "string" }
                },
                required: ["section","lyrics","performance_note"]
              }
            },
            full_lyrics: { type: "string", description: "Complete lyrics formatted with [Section] tags, ready for Suno" },
            suno: {
              type: "object",
              properties: {
                style_prompt: { type: "string", description: "Suno style prompt — instruments, era, vocal style, production. Comma-separated descriptors." },
                negative_tags: { type: "string", description: "Comma-separated things to avoid" },
                weirdness: { type: "number", description: "0-100 — Suno weirdness slider" },
                style_influence: { type: "number", description: "0-100" },
                audio_influence: { type: "number", description: "0-100" },
                model_recommendation: { type: "string", enum: ["v3.5","v4","v4.5"] }
              },
              required: ["style_prompt","negative_tags","weirdness","style_influence","audio_influence","model_recommendation"]
            }
          },
          required: ["title","tagline","hook_analysis","structure","full_lyrics","suno"]
        }
      }
    }];

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        tools,
        tool_choice: { type: "function", function: { name: "deliver_song" } },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error", resp.status, t);
      if (resp.status === 429) return new Response(JSON.stringify({ error: "Rate limited. Try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" }});
      if (resp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Lovable workspace settings." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" }});
      throw new Error("AI gateway failed");
    }

    const data = await resp.json();
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("No tool call returned");
    const song = JSON.parse(args);

    return new Response(JSON.stringify(song), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }});
  }
});
