import { useState, useRef, useEffect } from "react";
import { Upload, Music, Loader2, Copy, Check, ArrowRight, RotateCcw, Sparkles, RefreshCw, X } from "lucide-react";
import { analyzeAudio, type AudioAnalysis } from "@/lib/audioAnalysis";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Step = "upload" | "analyzing" | "analyzed" | "brief" | "writing" | "result";

interface SectionAudit {
  section: string;
  syllables_per_line: number[];
  target_range: [number, number];
  out_of_range_lines: number;
  cliche_hits: string[];
  forbidden_rhyme_hits: string[];
  rhyme_density: number;
}
interface RealismScores {
  originality: number;
  cliche_risk: number;
  prosody_fit: number;
  rhyme_craft: number;
  imagery: number;
  overall: number;
  flags: string[];
}
interface SongPackage {
  title: string;
  tagline: string;
  hook_analysis: string;
  structure: { section: string; lyrics: string; performance_note: string }[];
  full_lyrics: string;
  suno: {
    style_prompt: string;
    negative_tags: string;
    weirdness: number;
    style_influence: number;
    audio_influence: number;
    model_recommendation: string;
  };
}
interface GenerationResult {
  song: SongPackage;
  scores: RealismScores;
  audits: SectionAudit[];
  revisions?: number;
  rationale?: string;
}

const GENRES = ["Pop", "Hip-Hop", "R&B", "Trap", "Drill", "Afrobeats", "Country", "Rock", "Indie", "EDM", "House", "Synthwave", "Folk", "Latin", "K-Pop", "Punk"];
const MOODS = ["Euphoric", "Heartbreak", "Defiant", "Dreamy", "Aggressive", "Nostalgic", "Triumphant", "Melancholic", "Sensual", "Anthemic"];
const ARTISTS = [
  "Taylor Swift","Phoebe Bridgers","Kendrick Lamar","Frank Ocean","SZA","Olivia Rodrigo",
  "Jack Antonoff (writer)","Amy Allen (writer)","Tyler, The Creator","Drake","The Weeknd",
  "Billie Eilish","Zach Bryan","Kacey Musgraves","Mitski","Mac Miller","Burna Boy","Tems",
  "Bad Bunny","Tame Impala","Lana Del Rey","Bon Iver","Childish Gambino","Doja Cat",
  "Hozier","Charli XCX",
];

export default function Index() {
  const [step, setStep] = useState<Step>("upload");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [genre, setGenre] = useState("Pop");
  const [mood, setMood] = useState("Euphoric");
  const [theme, setTheme] = useState("");
  const [artists, setArtists] = useState<string[]>([]);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(f: File) {
    if (!f.type.startsWith("audio/")) { toast.error("Upload an audio file"); return; }
    setStep("analyzing");
    try {
      const a = await analyzeAudio(f, (p, l) => { setProgress(p); setProgressLabel(l); });
      setAnalysis(a);
      setStep("analyzed");
    } catch (e) {
      console.error(e);
      toast.error("Could not analyze audio");
      setStep("upload");
    }
  }

  async function generate() {
    if (!analysis) return;
    setStep("writing");
    try {
      const { data, error } = await supabase.functions.invoke("generate-song", {
        body: { analysis, style: genre, theme: theme || "Whatever feels true to the energy", mood, artists },
      });
      if (error) throw error;
      if ((data as any).error) throw new Error((data as any).error);
      setResult(data as GenerationResult);
      setStep("result");
      const r = (data as GenerationResult).revisions || 0;
      if (r > 0) toast.success(`Auto-revised ${r}× to hit ${(data as GenerationResult).scores.overall}/100`);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Generation failed");
      setStep("brief");
    }
  }

  async function regenerateSection(section: string, userNote?: string) {
    if (!result || !analysis) return;
    setRegenerating(section);
    try {
      const { data, error } = await supabase.functions.invoke("generate-song?mode=regenerate_section", {
        body: { analysis, style: genre, theme, mood, artists, section, currentSong: result.song, userNote },
      });
      if (error) throw error;
      if ((data as any).error) throw new Error((data as any).error);
      setResult(prev => prev ? { ...prev, ...(data as any) } : data as GenerationResult);
      toast.success(`${section} rewritten`);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Rewrite failed");
    } finally {
      setRegenerating(null);
    }
  }

  function reset() {
    setStep("upload"); setAnalysis(null); setResult(null); setProgress(0); setTheme(""); setArtists([]);
  }

  return (
    <div className="min-h-screen bg-bone text-ink grid-bg">
      <Header />
      <Stepper step={step} />
      <main className="max-w-7xl mx-auto px-6 pb-24">
        {step === "upload" && <UploadView onFile={onFile} fileInput={fileInput} />}
        {step === "analyzing" && <AnalyzingView progress={progress} label={progressLabel} />}
        {step === "analyzed" && analysis && <AnalysisView analysis={analysis} onContinue={() => setStep("brief")} />}
        {step === "brief" && <BriefView genre={genre} setGenre={setGenre} mood={mood} setMood={setMood} theme={theme} setTheme={setTheme} artists={artists} setArtists={setArtists} onGenerate={generate} onBack={() => setStep("analyzed")} />}
        {step === "writing" && <WritingView />}
        {step === "result" && result && analysis && (
          <ResultView
            result={result}
            analysis={analysis}
            onReset={reset}
            onRegenerate={regenerateSection}
            regenerating={regenerating}
          />
        )}
      </main>
      <Ticker />
    </div>
  );
}

function Header() {
  return (
    <header className="border-b-2 border-ink">
      <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-ink flex items-center justify-center">
            <Music className="w-5 h-5 text-bone" />
          </div>
          <div>
            <div className="display text-2xl">HITLAB</div>
            <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground">Instrumental → Hit Song Engine</div>
          </div>
        </div>
        <div className="hidden md:flex mono text-xs uppercase tracking-widest gap-6">
          <span>v2.0</span>
          <span>EST. 2026</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 bg-acid border border-ink" /> ONLINE</span>
        </div>
      </div>
    </header>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps = [
    { id: "upload", n: "01", label: "UPLOAD" },
    { id: "analyzing", n: "02", label: "ANALYZE" },
    { id: "brief", n: "03", label: "DIRECT" },
    { id: "writing", n: "04", label: "WRITE" },
    { id: "result", n: "05", label: "DELIVER" },
  ];
  const active = steps.findIndex(s => s.id === step || (step === "analyzed" && s.id === "analyzing") || (step === "writing" && s.id === "writing") || (step === "result" && s.id === "result"));
  return (
    <div className="border-b-2 border-ink bg-bone">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4 overflow-x-auto">
        {steps.map((s, i) => (
          <div key={s.id} className={`flex items-center gap-2 mono text-xs uppercase tracking-widest whitespace-nowrap ${i <= active ? "text-ink" : "text-muted-foreground"}`}>
            <span className={`px-2 py-1 border-2 border-ink ${i === active ? "bg-acid" : i < active ? "bg-ink text-bone" : "bg-bone"}`}>{s.n}</span>
            <span className="font-bold">{s.label}</span>
            {i < steps.length - 1 && <span className="ml-2">———</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function UploadView({ onFile, fileInput }: { onFile: (f: File) => void; fileInput: React.RefObject<HTMLInputElement> }) {
  const [drag, setDrag] = useState(false);
  return (
    <section className="pt-16 pb-12">
      <div className="grid lg:grid-cols-12 gap-8 items-end mb-12">
        <div className="lg:col-span-8">
          <div className="mono text-xs uppercase tracking-widest mb-4">/ ISSUE 002 — THE INSTRUMENTAL TO HIT PIPELINE</div>
          <h1 className="display text-[12vw] lg:text-[9rem]">
            FEED IT<br />
            A BEAT.<br />
            <span className="bg-ink text-bone px-2">GET A HIT.</span>
          </h1>
        </div>
        <div className="lg:col-span-4">
          <p className="mono text-sm leading-relaxed border-l-2 border-ink pl-4">
            Upload any instrumental. We measure BPM, key, energy, structure. Then we write a chart-grade song — auto-audited for cliché, prosody, rhyme craft, and originality. Revise any section in one click.
          </p>
        </div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
        onClick={() => fileInput.current?.click()}
        className={`brut-card cursor-pointer p-16 text-center transition-all ${drag ? "bg-acid translate-x-[-4px] translate-y-[-4px]" : ""}`}
      >
        <Upload className="w-16 h-16 mx-auto mb-6" strokeWidth={2.5} />
        <div className="display text-4xl mb-3">DROP YOUR INSTRUMENTAL</div>
        <div className="mono text-xs uppercase tracking-widest text-muted-foreground">MP3 · WAV · M4A · OGG  /  MAX 50MB  /  CLICK OR DRAG</div>
        <input ref={fileInput} type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </div>

      <div className="grid md:grid-cols-4 gap-0 mt-12 border-2 border-ink">
        {[
          ["01", "DECODE", "DSP measures tempo, key, energy, sections."],
          ["02", "STEER", "Pick reference artists to shape the voice."],
          ["03", "AUDIT", "Auto-scored for cliché, prosody, originality."],
          ["04", "REVISE", "Rewrite any section until it feels right."],
        ].map(([n, h, b], i) => (
          <div key={n} className={`p-6 ${i < 3 ? "border-r-2 border-ink" : ""} ${i === 1 ? "bg-ink text-bone" : ""}`}>
            <div className="mono text-xs uppercase tracking-widest mb-2">{n}</div>
            <div className="display text-2xl mb-2">{h}</div>
            <div className="mono text-xs leading-relaxed">{b}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AnalyzingView({ progress, label }: { progress: number; label: string }) {
  return (
    <section className="pt-32 pb-32">
      <div className="mono text-xs uppercase tracking-widest mb-6">/ STEP 02 — DSP IN PROGRESS</div>
      <div className="display text-[10vw] lg:text-[7rem] mb-12">{label}<span className="text-acid">_</span></div>
      <div className="border-2 border-ink h-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-ink transition-all duration-300" style={{ width: `${progress}%` }} />
        <div className="absolute inset-0 flex items-center justify-end px-4 mono text-sm font-bold mix-blend-difference text-bone">{progress}%</div>
      </div>
      <div className="flex gap-1 mt-12 h-32 items-end">
        {Array.from({ length: 64 }).map((_, i) => (
          <div key={i} className="flex-1 bg-ink origin-bottom" style={{ height: `${30 + Math.sin(i * 0.5 + progress * 0.1) * 40 + Math.random() * 30}%`, animation: `pulse-bar ${0.5 + (i % 5) * 0.1}s ease-in-out infinite` }} />
        ))}
      </div>
    </section>
  );
}

function AnalysisView({ analysis, onContinue }: { analysis: AudioAnalysis; onContinue: () => void }) {
  return (
    <section className="pt-12 pb-12">
      <div className="mono text-xs uppercase tracking-widest mb-4">/ STEP 02 — DECODED</div>
      <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
        <h2 className="display text-6xl">DNA REPORT</h2>
        <div className="mono text-xs truncate max-w-md">▸ {analysis.fileName}</div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-0 border-2 border-ink mb-8">
        {[
          ["BPM", analysis.bpm.toString(), "BEATS / MIN"],
          ["KEY", `${analysis.key}${analysis.scale === "minor" ? "m" : ""}`, analysis.scale.toUpperCase()],
          ["LENGTH", `${Math.floor(analysis.duration / 60)}:${String(Math.floor(analysis.duration % 60)).padStart(2, "0")}`, "MM:SS"],
          ["ENERGY", `${(analysis.energy * 100).toFixed(0)}%`, `${analysis.loudness.toFixed(1)} dB`],
        ].map(([label, value, sub], i) => (
          <div key={label} className={`p-6 ${i < 3 ? "border-r-2 border-ink" : ""} ${i === 1 ? "bg-acid" : ""}`}>
            <div className="mono text-xs uppercase tracking-widest mb-2">{label}</div>
            <div className="display text-5xl mb-1">{value}</div>
            <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground">{sub}</div>
          </div>
        ))}
      </div>

      <div className="brut-card p-8 mb-8">
        <div className="mono text-xs uppercase tracking-widest mb-4">/ WAVEFORM</div>
        <div className="flex gap-px h-32 items-center">
          {analysis.peaks.map((p, i) => (
            <div key={i} className="flex-1 bg-ink" style={{ height: `${Math.max(2, p * 100)}%`, opacity: 0.4 + p * 0.6 }} />
          ))}
        </div>
      </div>

      <div className="brut-card p-8 mb-8">
        <div className="mono text-xs uppercase tracking-widest mb-4">/ SECTION MAP</div>
        <div className="grid grid-cols-8 gap-0 border-2 border-ink">
          {analysis.sections.map((s, i) => (
            <div key={i} className={`p-3 text-center ${i < 7 ? "border-r-2 border-ink" : ""}`} style={{ background: `hsl(var(--ink) / ${s.energy})` }}>
              <div className="mono text-[10px] font-bold mb-1" style={{ color: s.energy > 0.5 ? "hsl(var(--bone))" : "hsl(var(--ink))" }}>{s.label}</div>
              <div className="mono text-[10px]" style={{ color: s.energy > 0.5 ? "hsl(var(--bone))" : "hsl(var(--ink))" }}>{(s.energy * 100).toFixed(0)}</div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onContinue} className="brut-btn flex items-center gap-3">
        DIRECT THE WRITER <ArrowRight className="w-4 h-4" />
      </button>
    </section>
  );
}

function BriefView({ genre, setGenre, mood, setMood, theme, setTheme, artists, setArtists, onGenerate, onBack }: any) {
  function toggleArtist(name: string) {
    if (artists.includes(name)) setArtists(artists.filter((a: string) => a !== name));
    else if (artists.length < 5) setArtists([...artists, name]);
    else toast.error("Max 5 reference artists — fewer = sharper voice");
  }
  return (
    <section className="pt-12 pb-12 max-w-6xl">
      <div className="mono text-xs uppercase tracking-widest mb-4">/ STEP 03 — CREATIVE BRIEF</div>
      <h2 className="display text-6xl mb-10">DIRECT THE A&R</h2>

      <div className="mb-10">
        <div className="mono text-xs uppercase tracking-widest mb-3">GENRE</div>
        <div className="flex flex-wrap gap-0 border-2 border-ink">
          {GENRES.map((g, i) => (
            <button key={g} onClick={() => setGenre(g)} className={`px-4 py-3 mono text-xs uppercase font-bold border-ink ${i < GENRES.length - 1 ? "border-r-2" : ""} ${genre === g ? "bg-ink text-bone" : "hover:bg-acid"}`}>{g}</button>
          ))}
        </div>
      </div>

      <div className="mb-10">
        <div className="mono text-xs uppercase tracking-widest mb-3">MOOD</div>
        <div className="flex flex-wrap gap-0 border-2 border-ink">
          {MOODS.map((m, i) => (
            <button key={m} onClick={() => setMood(m)} className={`px-4 py-3 mono text-xs uppercase font-bold border-ink ${i < MOODS.length - 1 ? "border-r-2" : ""} ${mood === m ? "bg-ink text-bone" : "hover:bg-acid"}`}>{m}</button>
          ))}
        </div>
      </div>

      <div className="mb-10">
        <div className="flex items-baseline justify-between mb-3">
          <div className="mono text-xs uppercase tracking-widest">REFERENCE ARTISTS — STEER THE VOICE (PICK 3–5)</div>
          <div className="mono text-xs">{artists.length}/5</div>
        </div>
        <div className="brut-card p-4">
          <div className="flex flex-wrap gap-2">
            {ARTISTS.map(a => {
              const on = artists.includes(a);
              return (
                <button
                  key={a}
                  onClick={() => toggleArtist(a)}
                  className={`px-3 py-2 border-2 border-ink mono text-xs uppercase font-bold transition-all ${on ? "bg-ink text-bone" : "bg-bone hover:bg-acid"}`}
                >
                  {on && <Check className="inline w-3 h-3 mr-1" />}{a}
                </button>
              );
            })}
          </div>
          <div className="mono text-[11px] text-muted-foreground mt-3 leading-relaxed">
            We extract their craft DNA — voice, vocabulary zones, structural habits — and synthesize a NEW voice that shares the lineage without copying any line.
          </div>
        </div>
      </div>

      <div className="mb-10">
        <div className="mono text-xs uppercase tracking-widest mb-3">THEME / STORY (OPTIONAL)</div>
        <textarea
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          placeholder="e.g. Driving home from a city you swore you'd never come back to..."
          className="w-full p-4 border-2 border-ink bg-bone mono text-sm h-32 focus:outline-none focus:bg-acid/20"
        />
      </div>

      <div className="flex gap-4">
        <button onClick={onBack} className="brut-btn bg-bone text-ink">← BACK</button>
        <button onClick={onGenerate} className="brut-btn flex items-center gap-3">WRITE THE HIT <ArrowRight className="w-4 h-4" /></button>
      </div>
    </section>
  );
}

function WritingView() {
  const lines = ["LOADING HIT FORMULA…", "STUDYING THE HOOK ZONE…", "MATCHING SYLLABLES TO TEMPO…", "DRAFTING VERSE 1…", "AUDITING FOR CLICHÉS…", "REVISING FOR PROSODY…", "POLISHING THE CHORUS…", "ENGINEERING SUNO PROMPT…"];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % lines.length), 1400); return () => clearInterval(t); }, [lines.length]);
  return (
    <section className="pt-32 pb-32 text-center">
      <Loader2 className="w-16 h-16 mx-auto mb-8 animate-spin" strokeWidth={2.5} />
      <div className="mono text-xs uppercase tracking-widest mb-4">/ STEP 04 — A&R IS WRITING & SELF-AUDITING</div>
      <div className="display text-[8vw] lg:text-6xl mb-6">{lines[i]}</div>
      <div className="mono text-xs uppercase tracking-widest text-muted-foreground">First-class hit takes ~30 seconds (with auto-revision)</div>
    </section>
  );
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="brut-btn flex items-center gap-2 text-xs px-4 py-2"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "COPIED" : label || "COPY"}
    </button>
  );
}

function ScoreBar({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  const good = invert ? value < 20 : value >= 75;
  const mid = invert ? value < 40 : value >= 60;
  const color = good ? "bg-acid" : mid ? "bg-ink" : "bg-blood";
  return (
    <div>
      <div className="flex justify-between mono text-[11px] uppercase font-bold mb-1">
        <span>{label}</span>
        <span>{value}{invert ? "% RISK" : "/100"}</span>
      </div>
      <div className="h-2 border-2 border-ink relative bg-bone">
        <div className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function ScoresCard({ scores }: { scores: RealismScores }) {
  const grade = scores.overall >= 85 ? "A" : scores.overall >= 75 ? "B" : scores.overall >= 65 ? "C" : "D";
  return (
    <div className="brut-card p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="mono text-xs uppercase tracking-widest mb-1">/ LYRIC REALISM SCORE</div>
          <div className="display text-3xl">CRAFT AUDIT</div>
        </div>
        <div className="text-right">
          <div className="display text-6xl leading-none">{scores.overall}</div>
          <div className="mono text-xs">GRADE {grade}</div>
        </div>
      </div>
      <div className="space-y-3">
        <ScoreBar label="Originality" value={scores.originality} />
        <ScoreBar label="Cliché Risk" value={scores.cliche_risk} invert />
        <ScoreBar label="Prosody Fit" value={scores.prosody_fit} />
        <ScoreBar label="Rhyme Craft" value={scores.rhyme_craft} />
        <ScoreBar label="Imagery" value={scores.imagery} />
      </div>
      {scores.flags.length > 0 && (
        <div className="mt-5 pt-4 border-t-2 border-ink">
          <div className="mono text-[11px] uppercase font-bold mb-2">FLAGS</div>
          <ul className="space-y-1">
            {scores.flags.map((f, i) => (
              <li key={i} className="mono text-[11px] flex gap-2"><span>▸</span><span>{f}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SectionAuditChip({ audit }: { audit?: SectionAudit }) {
  if (!audit) return null;
  const off = audit.out_of_range_lines;
  const issues = (audit.cliche_hits.length || 0) + (audit.forbidden_rhyme_hits.length || 0) + off;
  const cls = issues === 0 ? "bg-acid" : issues <= 2 ? "bg-bone" : "bg-blood text-bone";
  const label = issues === 0 ? "CLEAN" : `${issues} ISSUE${issues>1?"S":""}`;
  return <span className={`mono text-[10px] font-bold px-2 py-1 border-2 border-ink ${cls}`} title={`Syllables ${audit.syllables_per_line.join(",")} • target ${audit.target_range[0]}–${audit.target_range[1]}`}>{label}</span>;
}

function RegenDialog({ section, onClose, onSubmit }: { section: string; onClose: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-50 bg-ink/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="brut-card max-w-lg w-full p-6 bg-bone" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="mono text-xs uppercase tracking-widest mb-1">/ REVISE</div>
            <div className="display text-2xl">REWRITE [{section}]</div>
          </div>
          <button onClick={onClose} className="border-2 border-ink p-1 hover:bg-acid"><X className="w-4 h-4" /></button>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="OPTIONAL DIRECTION — e.g. 'less abstract, add a phone-call image' or 'tighter syllables, more bite'"
          className="w-full p-3 border-2 border-ink bg-bone mono text-sm h-28 focus:outline-none focus:bg-acid/20 mb-4"
        />
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="brut-btn bg-bone text-ink text-xs">CANCEL</button>
          <button onClick={() => { onSubmit(note); onClose(); }} className="brut-btn text-xs flex items-center gap-2">
            <Sparkles className="w-3 h-3" /> REWRITE
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultView({ result, analysis, onReset, onRegenerate, regenerating }: {
  result: GenerationResult;
  analysis: AudioAnalysis;
  onReset: () => void;
  onRegenerate: (section: string, note?: string) => void;
  regenerating: string | null;
}) {
  const { song, scores, audits } = result;
  const [regenSection, setRegenSection] = useState<string | null>(null);
  return (
    <section className="pt-12 pb-12">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div className="mono text-xs uppercase tracking-widest">/ STEP 05 — DELIVERED {result.revisions ? `· AUTO-REVISED ${result.revisions}×` : ""}</div>
        <button onClick={onReset} className="mono text-xs uppercase font-bold flex items-center gap-2 underline"><RotateCcw className="w-3 h-3" /> NEW INSTRUMENTAL</button>
      </div>

      <div className="brut-card-acid p-10 mb-10">
        <div className="mono text-xs uppercase tracking-widest mb-3">/ TITLE</div>
        <h2 className="display text-[10vw] lg:text-8xl mb-6">{song.title}</h2>
        <p className="mono text-sm uppercase tracking-wide max-w-3xl border-l-2 border-ink pl-4">{song.tagline}</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-10">
        <div className="brut-card p-6 lg:col-span-2">
          <div className="mono text-xs uppercase tracking-widest mb-3">/ WHY THIS HOOK WORKS</div>
          <p className="text-lg leading-relaxed">{song.hook_analysis}</p>
        </div>
        <ScoresCard scores={scores} />
      </div>

      <div className="brut-card p-8 mb-10">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <div className="mono text-xs uppercase tracking-widest mb-1">/ SONG STRUCTURE — REVISE ANY SECTION</div>
            <div className="display text-3xl">FULL LYRICS</div>
          </div>
          <CopyBtn text={song.full_lyrics} label="COPY ALL" />
        </div>
        <div className="space-y-6">
          {song.structure.map((s, i) => {
            const audit = audits?.find(a => a.section === s.section);
            const isRegen = regenerating === s.section;
            return (
              <div key={i} className="border-l-4 border-ink pl-6 relative">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <span className="mono text-xs uppercase font-bold bg-ink text-bone px-2 py-1">{s.section}</span>
                  <SectionAuditChip audit={audit} />
                  <span className="mono text-xs italic text-muted-foreground flex-1 min-w-[200px]">{s.performance_note}</span>
                  <button
                    onClick={() => setRegenSection(s.section)}
                    disabled={isRegen}
                    className="mono text-[11px] uppercase font-bold flex items-center gap-1 px-3 py-1 border-2 border-ink hover:bg-acid disabled:opacity-50"
                  >
                    {isRegen ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    {isRegen ? "REWRITING…" : "REWRITE"}
                  </button>
                </div>
                <pre className={`font-sans text-base leading-relaxed whitespace-pre-wrap ${isRegen ? "opacity-40" : ""}`}>{s.lyrics}</pre>
              </div>
            );
          })}
        </div>
      </div>

      {regenSection && (
        <RegenDialog
          section={regenSection}
          onClose={() => setRegenSection(null)}
          onSubmit={(note) => onRegenerate(regenSection, note)}
        />
      )}

      <div className="brut-card-acid p-8 mb-6">
        <div className="display text-4xl mb-2">SUNO PROMPT PACK</div>
        <div className="mono text-xs uppercase tracking-widest">/ STEP 06 (BY YOU) — PASTE INTO SUNO.AI</div>
      </div>

      <div className="space-y-6">
        <div className="brut-card p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="mono text-xs uppercase tracking-widest font-bold">▸ LYRICS (paste into Suno's "Lyrics" field)</div>
            <CopyBtn text={song.full_lyrics} />
          </div>
          <pre className="font-mono text-xs bg-muted p-4 border-2 border-ink whitespace-pre-wrap max-h-64 overflow-auto">{song.full_lyrics}</pre>
        </div>

        <div className="brut-card p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="mono text-xs uppercase tracking-widest font-bold">▸ STYLE PROMPT</div>
            <CopyBtn text={song.suno.style_prompt} />
          </div>
          <div className="font-mono text-sm bg-muted p-4 border-2 border-ink">{song.suno.style_prompt}</div>
        </div>

        <div className="brut-card p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="mono text-xs uppercase tracking-widest font-bold">▸ NEGATIVE TAGS / EXCLUDE</div>
            <CopyBtn text={song.suno.negative_tags} />
          </div>
          <div className="font-mono text-sm bg-muted p-4 border-2 border-ink">{song.suno.negative_tags}</div>
        </div>

        <div className="brut-card p-6">
          <div className="mono text-xs uppercase tracking-widest font-bold mb-4">▸ SLIDER SETTINGS</div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              ["WEIRDNESS", song.suno.weirdness],
              ["STYLE INFLUENCE", song.suno.style_influence],
              ["AUDIO INFLUENCE", song.suno.audio_influence],
            ].map(([label, val]) => (
              <div key={label as string}>
                <div className="flex justify-between mono text-xs mb-2">
                  <span className="font-bold">{label}</span>
                  <span>{val}/100</span>
                </div>
                <div className="h-3 border-2 border-ink relative">
                  <div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${val}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 mono text-xs uppercase tracking-widest">RECOMMENDED MODEL: <span className="bg-ink text-bone px-2 py-1">SUNO {song.suno.model_recommendation}</span></div>
        </div>

        <a href="https://suno.com/create" target="_blank" rel="noopener noreferrer" className="brut-btn inline-flex items-center gap-3 mt-4">
          OPEN SUNO.AI <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    </section>
  );
}

function Ticker() {
  const items = ["HITLAB", "★", "INSTRUMENTAL TO HIT", "★", "SELF-AUDITING LYRIC ENGINE", "★", "POWERED BY DSP + AI", "★"];
  return (
    <div className="border-t-2 border-ink bg-ink text-bone overflow-hidden">
      <div className="ticker flex whitespace-nowrap py-3">
        {[...items, ...items, ...items, ...items].map((t, i) => (
          <span key={i} className="display text-2xl mx-8">{t}</span>
        ))}
      </div>
    </div>
  );
}
