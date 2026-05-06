// HITLAB Lyric Validator — pure functions. Audit a generated song against
// craft constraints (prosody to BPM, rhyme density, cliché load, originality).

import { ANTI_CORNY_RULES } from "./lyric-engine.ts";

// ── Syllable counter (heuristic, ~92% accuracy on English) ────────────────
const VOWELS = "aeiouy";
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  let cleaned = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  cleaned = cleaned.replace(/^y/, "");
  const groups = cleaned.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  // Suffix corrections
  if (/le$/.test(w) && !VOWELS.includes(w[w.length - 3] || "")) n += 1;
  if (/ion$|ious$|ial$/.test(w)) n += 1;
  return Math.max(1, n);
}

export function lineSyllables(line: string): number {
  return line.split(/\s+/).filter(Boolean).reduce((s, w) => s + countSyllables(w), 0);
}

// Last stressed vowel-cluster of a line — rough rhyme key
export function rhymeKey(line: string): string {
  const words = line.toLowerCase().replace(/[^a-z\s']/g, "").trim().split(/\s+/);
  const last = words[words.length - 1] || "";
  const m = last.match(/([aeiouy]+[^aeiouy]*)$/);
  return m ? m[1] : last.slice(-3);
}

// Slant-rhyme tolerance — share final consonant or vowel cluster
function slantMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.slice(-2) === b.slice(-2)) return true;
  const va = a.match(/[aeiouy]+/g)?.pop() || "";
  const vb = b.match(/[aeiouy]+/g)?.pop() || "";
  return !!va && va === vb;
}

// ── Prosody fit: target syllables per line based on BPM ───────────────────
// Hit songs typically land 4–10 syllables per bar. At higher BPM lines get shorter.
export function targetSyllableRange(bpm: number, section: string): [number, number] {
  const isChorus = /chorus|drop|hook/i.test(section);
  if (bpm < 80) return isChorus ? [6, 12] : [7, 14];
  if (bpm < 110) return isChorus ? [5, 10] : [6, 12];
  if (bpm < 140) return isChorus ? [4, 9] : [5, 11];
  return isChorus ? [3, 8] : [4, 9];
}

// ── Cliché detection ──────────────────────────────────────────────────────
const CLICHE_PHRASES: string[] = [
  "feel alive","on fire","light up the night","dance the night away","shooting star",
  "reach for the sky","set the world on fire","living my best life","in my feelings",
  "main character","hits different","unstoppable","against all odds","stronger than ever",
  "rise up","no looking back","one in a million","made for each other","stars align",
  "destiny calling","rollercoaster of emotions","butterflies in my stomach","love at first sight",
  "soulmate","forever and always","till the end of time","crazy in love","over the moon",
  "walking on sunshine","heart on my sleeve","through thick and thin","ride or die",
  "burning desire","take my breath away","you complete me","meant to be","perfect storm",
  "diamond in the rough","light at the end of the tunnel","it's all or nothing",
  "young and free","wild and free","forever young","feel the music","music in my soul",
];

const FORBIDDEN_RHYME_PAIRS: [string, string][] = [
  ["fire","desire"],["heart","apart"],["night","right"],["night","fight"],
  ["love","above"],["love","dove"],["sky","high"],["sky","fly"],
  ["dance","chance"],["dance","romance"],["soul","whole"],["soul","control"],
  ["true","you"],["true","do"],["mine","time"],["mine","shine"],
];

export function detectCliches(text: string): { phrase: string; index: number }[] {
  const lower = text.toLowerCase();
  const hits: { phrase: string; index: number }[] = [];
  for (const p of CLICHE_PHRASES) {
    let i = 0;
    while ((i = lower.indexOf(p, i)) !== -1) { hits.push({ phrase: p, index: i }); i += p.length; }
  }
  return hits;
}

export function detectForbiddenRhymes(lines: string[]): string[] {
  const keys = lines.map(l => l.toLowerCase().replace(/[^a-z\s]/g,"").trim().split(/\s+/).pop() || "");
  const flags: string[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    for (let j = i + 1; j < Math.min(keys.length, i + 4); j++) {
      const b = keys[j];
      for (const [x, y] of FORBIDDEN_RHYME_PAIRS) {
        if ((a === x && b === y) || (a === y && b === x)) flags.push(`${a}/${b}`);
      }
    }
  }
  return flags;
}

// ── Originality / abstraction ─────────────────────────────────────────────
const ABSTRACT_NOUNS = new Set([
  "love","heart","soul","mind","life","time","fate","destiny","forever","eternity",
  "dream","dreams","hope","faith","truth","pain","joy","passion","fire","desire",
  "freedom","glory","power","strength","beauty","feeling","feelings","emotion",
]);

const CONCRETE_HINTS = /\b(?:phone|car|kitchen|bed|sheet|window|street|cigarette|beer|whiskey|coffee|jeans|sweater|jacket|driver|airport|hotel|motel|bar|porch|sink|mirror|elevator|subway|highway|backseat|passenger|raincoat|gas\s+station|ringtone|notification|inbox|voicemail|tuesday|sunday|january|june|2\s*a\.?m\.?|3\s*a\.?m\.?|midnight|noon|red\s+light|stoplight|parking\s+lot|gravel|hallway|doorway|zipper|collarbone|knuckle|tattoo|polaroid|spotify|playlist|uber)\b/i;

export function abstractDensity(text: string): number {
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  if (!words.length) return 0;
  let n = 0;
  for (const w of words) if (ABSTRACT_NOUNS.has(w)) n++;
  return n / words.length;
}

export function concreteImageDensity(text: string): number {
  const matches = text.match(CONCRETE_HINTS) || [];
  const lines = text.split("\n").filter(l => l.trim()).length || 1;
  return matches.length / lines;
}

// Lexical diversity — type/token ratio
export function lexicalDiversity(text: string): number {
  const words = (text.toLowerCase().match(/[a-z']+/g) || []);
  if (!words.length) return 0;
  return new Set(words).size / words.length;
}

// ── Rhyme density (internal + end) ────────────────────────────────────────
export function rhymeDensity(text: string): number {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return 0;
  const keys = lines.map(rhymeKey);
  let pairs = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < Math.min(keys.length, i + 5); j++) {
      if (slantMatch(keys[i], keys[j])) pairs++;
    }
  }
  return pairs / lines.length;
}

// ── Stress placement — heuristic                                           
// We can't measure prosody perfectly without a melody, but we can flag
// lines that begin on a weak filler word ("and", "the", "but", "so")
// when the section is a chorus (downbeat needs strong word).
const WEAK_OPENERS = new Set(["and","the","but","so","or","of","a","an","to","with","in","on","at"]);
export function weakOpenerRate(text: string, section: string): number {
  if (!/chorus|drop|hook/i.test(section)) return 0;
  const lines = text.split("\n").filter(l => l.trim());
  if (!lines.length) return 0;
  const weak = lines.filter(l => WEAK_OPENERS.has((l.toLowerCase().match(/[a-z']+/) || [""])[0])).length;
  return weak / lines.length;
}

// ── Section-level audit ───────────────────────────────────────────────────
export interface SectionAudit {
  section: string;
  syllables_per_line: number[];
  target_range: [number, number];
  out_of_range_lines: number;
  weak_opener_rate: number;
  cliche_hits: string[];
  forbidden_rhyme_hits: string[];
  rhyme_density: number;
  abstract_density: number;
  concrete_density: number;
  lexical_diversity: number;
}

export function auditSection(section: string, lyrics: string, bpm: number): SectionAudit {
  const lines = lyrics.split("\n").map(l => l.trim()).filter(Boolean);
  const sylls = lines.map(lineSyllables);
  const range = targetSyllableRange(bpm, section);
  const outOf = sylls.filter(s => s < range[0] || s > range[1]).length;
  return {
    section,
    syllables_per_line: sylls,
    target_range: range,
    out_of_range_lines: outOf,
    weak_opener_rate: weakOpenerRate(lyrics, section),
    cliche_hits: detectCliches(lyrics).map(c => c.phrase),
    forbidden_rhyme_hits: detectForbiddenRhymes(lines),
    rhyme_density: rhymeDensity(lyrics),
    abstract_density: abstractDensity(lyrics),
    concrete_density: concreteImageDensity(lyrics),
    lexical_diversity: lexicalDiversity(lyrics),
  };
}

// ── Realism scoring (0–100, higher is better) ─────────────────────────────
export interface RealismScores {
  originality: number;        // anti-cliché + lexical diversity + concrete imagery
  cliche_risk: number;        // INVERTED — high = bad. We expose risk %.
  prosody_fit: number;        // syllable-to-BPM compliance + strong openers
  rhyme_craft: number;        // density inside healthy band, no banned pairs
  imagery: number;            // concrete vs abstract
  overall: number;            // weighted composite
  flags: string[];            // human-readable issues
}

export function scoreSong(fullLyrics: string, sections: { section: string; lyrics: string }[], bpm: number): RealismScores {
  const audits = sections.map(s => auditSection(s.section, s.lyrics, bpm));
  const flags: string[] = [];

  // Cliché risk: 0 hits = 0% risk; 5+ = 100%
  const totalCliches = audits.reduce((n, a) => n + a.cliche_hits.length, 0);
  const totalForbidden = audits.reduce((n, a) => n + a.forbidden_rhyme_hits.length, 0);
  const clicheRisk = Math.min(100, totalCliches * 18 + totalForbidden * 22);
  if (totalCliches) flags.push(`${totalCliches} clichéd phrase${totalCliches>1?"s":""} detected`);
  if (totalForbidden) flags.push(`${totalForbidden} banned rhyme pair${totalForbidden>1?"s":""}`);

  // Prosody: % lines inside target range across sections
  const totalLines = audits.reduce((n, a) => n + a.syllables_per_line.length, 0) || 1;
  const offLines = audits.reduce((n, a) => n + a.out_of_range_lines, 0);
  const onRate = 1 - offLines / totalLines;
  const weakChorusOpeners = audits.filter(a => /chorus|drop|hook/i.test(a.section)).reduce((n, a) => n + a.weak_opener_rate, 0);
  const prosodyFit = Math.round(Math.max(0, onRate * 100 - weakChorusOpeners * 25));
  if (offLines / totalLines > 0.3) flags.push(`${offLines} line${offLines>1?"s":""} off-tempo for ${bpm} BPM`);

  // Rhyme craft: density 0.3–0.9 = healthy; outside that loses points; banned pairs slash it
  const rd = rhymeDensity(fullLyrics);
  let rhymeCraft = 100;
  if (rd < 0.25) { rhymeCraft -= (0.25 - rd) * 200; flags.push("Rhyme too sparse — feels prose-like"); }
  if (rd > 1.0) { rhymeCraft -= (rd - 1.0) * 80; flags.push("Rhyme too dense — feels nursery-rhyme"); }
  rhymeCraft -= totalForbidden * 15;
  rhymeCraft = Math.max(0, Math.round(rhymeCraft));

  // Imagery: concrete - abstract
  const concrete = concreteImageDensity(fullLyrics);
  const abstract = abstractDensity(fullLyrics);
  const imagery = Math.round(Math.max(0, Math.min(100, 50 + concrete * 60 - abstract * 400)));
  if (abstract > 0.04) flags.push("Too many abstract nouns — show, don't tell");
  if (concrete < 0.3) flags.push("Few concrete images — add specific objects/places");

  // Originality: lexical diversity + low cliché + concrete
  const div = lexicalDiversity(fullLyrics);
  const originality = Math.round(Math.max(0, Math.min(100,
    div * 100 * 0.6 + (100 - clicheRisk) * 0.25 + imagery * 0.15
  )));

  const overall = Math.round(
    originality * 0.30 +
    (100 - clicheRisk) * 0.25 +
    prosodyFit * 0.20 +
    rhymeCraft * 0.15 +
    imagery * 0.10
  );

  return { originality, cliche_risk: clicheRisk, prosody_fit: prosodyFit, rhyme_craft: rhymeCraft, imagery, overall, flags };
}

// ── Build a critique that the LLM can act on ──────────────────────────────
export function buildCritique(scores: RealismScores, audits: SectionAudit[]): string {
  const lines: string[] = [];
  lines.push(`SELF-AUDIT — overall craft score ${scores.overall}/100. Targets: originality≥75, cliche_risk≤15, prosody_fit≥80, rhyme_craft≥70, imagery≥65.`);
  lines.push(`Current: originality=${scores.originality}, cliche_risk=${scores.cliche_risk}, prosody_fit=${scores.prosody_fit}, rhyme_craft=${scores.rhyme_craft}, imagery=${scores.imagery}.`);
  if (scores.flags.length) lines.push("Issues: " + scores.flags.join("; ") + ".");
  for (const a of audits) {
    const issues: string[] = [];
    if (a.cliche_hits.length) issues.push(`clichés: ${a.cliche_hits.join(", ")}`);
    if (a.forbidden_rhyme_hits.length) issues.push(`banned rhymes: ${a.forbidden_rhyme_hits.join(", ")}`);
    if (a.out_of_range_lines > 0) issues.push(`${a.out_of_range_lines} line(s) outside ${a.target_range[0]}–${a.target_range[1]} syllables`);
    if (a.weak_opener_rate > 0.3) issues.push("chorus opens on weak filler word");
    if (issues.length) lines.push(`• ${a.section}: ${issues.join("; ")}.`);
  }
  lines.push("REWRITE every flagged section. Keep the title and central image. Replace clichés with specific images. Fix syllable count by removing filler words or splitting/joining lines. Replace banned rhymes with slant rhymes.");
  return lines.join("\n");
}

// Decide whether a song needs a revision pass
export function needsRevision(scores: RealismScores): boolean {
  return scores.overall < 78
      || scores.cliche_risk > 15
      || scores.prosody_fit < 70
      || scores.originality < 70;
}

// Re-export so engine can list bans in prompts
export { ANTI_CORNY_RULES };
