import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildSystemPrompt, buildUserPrompt, LYRIC_ENGINE_VERSION } from "./lyric-engine.ts";
import { buildArtistDirective } from "./artist-profiles.ts";
import { scoreSong, auditSection, buildCritique, needsRevision, type RealismScores, type SectionAudit } from "./lyric-validator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SONG_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    tagline: { type: "string" },
    hook_analysis: { type: "string" },
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
    full_lyrics: { type: "string" },
    suno: {
      type: "object",
      properties: {
        style_prompt: { type: "string" },
        negative_tags: { type: "string" },
        weirdness: { type: "number" },
        style_influence: { type: "number" },
        audio_influence: { type: "number" },
        model_recommendation: { type: "string", enum: ["v3.5","v4","v4.5"] }
      },
      required: ["style_prompt","negative_tags","weirdness","style_influence","audio_influence","model_recommendation"]
    }
  },
  required: ["title","tagline","hook_analysis","structure","full_lyrics","suno"]
};

const SECTION_SCHEMA = {
  type: "object",
  properties: {
    section: { type: "string" },
    lyrics: { type: "string" },
    performance_note: { type: "string" },
    rationale: { type: "string", description: "1-2 sentences on the craft change vs the previous draft" }
  },
  required: ["section","lyrics","performance_note"]
};

async function callGateway(messages: any[], tool: any, model = "google/gemini-2.5-pro") {
  const resp = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, messages, tools: [tool],
      tool_choice: { type: "function", function: { name: tool.function.name } },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    if (resp.status === 429) throw Object.assign(new Error("Rate limited. Try again shortly."), { status: 429 });
    if (resp.status === 402) throw Object.assign(new Error("AI credits exhausted. Add credits in Lovable workspace settings."), { status: 402 });
    console.error("AI gateway error", resp.status, t);
    throw new Error("AI gateway failed");
  }
  const data = await resp.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("No tool call returned");
  return JSON.parse(args);
}

function rebuildFullLyrics(structure: { section: string; lyrics: string }[]): string {
  return structure.map(s => `[${s.section}]\n${s.lyrics}`).join("\n\n");
}

function auditAll(song: any, bpm: number) {
  const audits: SectionAudit[] = song.structure.map((s: any) => auditSection(s.section, s.lyrics, bpm));
  const scores = scoreSong(song.full_lyrics, song.structure, bpm);
  return { audits, scores };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const body = await req.json();
    const mode = body.mode || "generate"; // generate | regenerate_section
    const { analysis, style, theme, mood, artists = [] } = body;

    const sys = buildSystemPrompt();
    const artistDirective = buildArtistDirective(artists);

    // ─── REGENERATE SECTION MODE ────────────────────────────────────────
    if (mode === "regenerate_section") {
      const { section, currentSong, userNote } = body;
      const target = currentSong.structure.find((s: any) => s.section === section);
      if (!target) throw new Error("Section not found");
      const existingAudit = auditSection(section, target.lyrics, analysis.bpm);
      const range = existingAudit.target_range;

      const user = `Rewrite ONLY the [${section}] section of this song. Keep the song's title, central image, and overall arc intact.

═══ INSTRUMENTAL ═══
BPM ${analysis.bpm} · Key ${analysis.key} ${analysis.scale}

═══ SONG CONTEXT ═══
Title: ${currentSong.title}
Tagline: ${currentSong.tagline}
Hook craft: ${currentSong.hook_analysis}

OTHER SECTIONS (do not change these — write a section that flows with them):
${currentSong.structure.filter((s: any) => s.section !== section).map((s: any) => `[${s.section}]\n${s.lyrics}`).join("\n\n")}

═══ CURRENT [${section}] (the one you are replacing) ═══
${target.lyrics}

═══ AUDIT OF CURRENT DRAFT ═══
• Syllables per line: ${existingAudit.syllables_per_line.join(", ")} (target ${range[0]}–${range[1]})
• Cliché hits: ${existingAudit.cliche_hits.join(", ") || "none"}
• Banned rhyme pairs: ${existingAudit.forbidden_rhyme_hits.join(", ") || "none"}
• Lines off-tempo: ${existingAudit.out_of_range_lines}

${userNote ? `═══ USER DIRECTION ═══\n${userNote}\n` : ""}
${artistDirective}

Return a NEW [${section}] that fixes every issue above, hits the syllable target, contains zero clichés, uses slant rhymes, and contains at least one specific concrete image. Use the rewrite_section tool.`;

      const tool = {
        type: "function",
        function: { name: "rewrite_section", description: "Return the rewritten section.", parameters: SECTION_SCHEMA }
      };
      const newSection = await callGateway([{ role: "system", content: sys }, { role: "user", content: user }], tool);

      // Splice into the song and re-score
      const newStructure = currentSong.structure.map((s: any) =>
        s.section === section ? { section: newSection.section, lyrics: newSection.lyrics, performance_note: newSection.performance_note } : s
      );
      const newSong = { ...currentSong, structure: newStructure, full_lyrics: rebuildFullLyrics(newStructure) };
      const { scores, audits } = auditAll(newSong, analysis.bpm);
      return new Response(JSON.stringify({ song: newSong, scores, audits, rationale: newSection.rationale }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ─── GENERATE MODE (with revise-til-right) ──────────────────────────
    const baseUser = buildUserPrompt(analysis, style, theme, mood, artistDirective);
    const tool = {
      type: "function",
      function: { name: "deliver_song", description: "Deliver the complete song package", parameters: SONG_SCHEMA }
    };

    console.log(`HITLAB v${LYRIC_ENGINE_VERSION} — generating ${style}/${mood} with ${artists.length} artist refs`);
    let song = await callGateway([{ role: "system", content: sys }, { role: "user", content: baseUser }], tool);
    let { scores, audits } = auditAll(song, analysis.bpm);
    let revisions = 0;
    const MAX_REVISIONS = 2;

    while (needsRevision(scores) && revisions < MAX_REVISIONS) {
      revisions++;
      const critique = buildCritique(scores, audits);
      console.log(`Revision ${revisions} — overall ${scores.overall}/100`);
      const reviseUser = `${baseUser}

═══ PREVIOUS DRAFT (failed self-audit — rewrite) ═══
${song.full_lyrics}

═══ AUTOMATED CRAFT AUDIT ═══
${critique}

Deliver a fully rewritten song that resolves every issue above. Keep the title and central image; rebuild the lyric craft.`;
      song = await callGateway([{ role: "system", content: sys }, { role: "user", content: reviseUser }], tool);
      ({ scores, audits } = auditAll(song, analysis.bpm));
    }

    return new Response(JSON.stringify({ song, scores, audits, revisions, engine_version: LYRIC_ENGINE_VERSION }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e: any) {
    console.error(e);
    const status = e.status || 500;
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
