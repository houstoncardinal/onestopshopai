// Web Audio API analysis: BPM, key, energy, waveform peaks, sections
// Lightweight DSP — no external deps.

export interface AudioAnalysis {
  duration: number;
  bpm: number;
  key: string;
  scale: 'major' | 'minor';
  energy: number; // 0..1
  loudness: number; // dB
  peaks: number[]; // ~256 points
  sections: { start: number; end: number; energy: number; label: string }[];
  spectralCentroid: number;
  fileName: string;
}

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl-Schmuckler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function detectKey(buffer: AudioBuffer): { key: string; scale: 'major' | 'minor' } {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const fftSize = 4096;
  const chroma = new Array(12).fill(0);

  // Simple Goertzel-based pitch class profile across the track
  const step = Math.floor(data.length / 50);
  for (let offset = 0; offset < data.length - fftSize; offset += step) {
    for (let pc = 0; pc < 12; pc++) {
      // Reference octave A4=440. Frequencies for each pitch class around C4
      const freq = 261.63 * Math.pow(2, pc / 12);
      const k = (fftSize * freq) / sampleRate;
      const w = (2 * Math.PI * k) / fftSize;
      const cosw = Math.cos(w);
      const coeff = 2 * cosw;
      let s0 = 0, s1 = 0, s2 = 0;
      for (let i = 0; i < fftSize; i++) {
        s0 = data[offset + i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
      chroma[pc] += Math.max(0, power);
    }
  }

  // Correlate with major/minor profiles for each rotation
  let best = { score: -Infinity, idx: 0, scale: 'major' as 'major' | 'minor' };
  for (let i = 0; i < 12; i++) {
    let majorScore = 0, minorScore = 0;
    for (let j = 0; j < 12; j++) {
      majorScore += chroma[(i + j) % 12] * MAJOR_PROFILE[j];
      minorScore += chroma[(i + j) % 12] * MINOR_PROFILE[j];
    }
    if (majorScore > best.score) best = { score: majorScore, idx: i, scale: 'major' };
    if (minorScore > best.score) best = { score: minorScore, idx: i, scale: 'minor' };
  }
  return { key: KEYS[best.idx], scale: best.scale };
}

function detectBPM(buffer: AudioBuffer): number {
  // Energy-based onset autocorrelation
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const hop = Math.floor(sampleRate * 0.01); // 10ms frames
  const frames: number[] = [];
  for (let i = 0; i < data.length - hop; i += hop) {
    let sum = 0;
    for (let j = 0; j < hop; j++) sum += data[i + j] * data[i + j];
    frames.push(Math.sqrt(sum / hop));
  }
  // Onset = positive flux
  const onsets: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    onsets.push(Math.max(0, frames[i] - frames[i - 1]));
  }
  // Autocorrelation in BPM range 60..200
  const fps = 100; // frames per sec
  let bestBPM = 120;
  let bestScore = 0;
  for (let bpm = 60; bpm <= 200; bpm++) {
    const lag = Math.round((60 / bpm) * fps);
    let s = 0;
    for (let i = 0; i < onsets.length - lag; i++) s += onsets[i] * onsets[i + lag];
    if (s > bestScore) { bestScore = s; bestBPM = bpm; }
  }
  return bestBPM;
}

function computePeaks(buffer: AudioBuffer, bins = 256): number[] {
  const data = buffer.getChannelData(0);
  const block = Math.floor(data.length / bins);
  const peaks: number[] = [];
  for (let i = 0; i < bins; i++) {
    let max = 0;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(data[i * block + j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  return peaks;
}

function computeSections(peaks: number[], duration: number) {
  const seg = 8;
  const len = peaks.length / seg;
  const sections = [];
  const labels = ['INTRO', 'VERSE', 'BUILD', 'DROP', 'BREAK', 'VERSE', 'BRIDGE', 'OUTRO'];
  for (let i = 0; i < seg; i++) {
    const slice = peaks.slice(Math.floor(i * len), Math.floor((i + 1) * len));
    const e = slice.reduce((a, b) => a + b, 0) / slice.length;
    sections.push({
      start: (i / seg) * duration,
      end: ((i + 1) / seg) * duration,
      energy: e,
      label: labels[i],
    });
  }
  return sections;
}

function computeSpectralCentroid(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const fftSize = 2048;
  const sampleRate = buffer.sampleRate;
  // Crude: sample the middle of the track
  const offset = Math.floor(data.length / 2);
  let weighted = 0, total = 0;
  for (let k = 1; k < fftSize / 2; k++) {
    const freq = (k * sampleRate) / fftSize;
    let re = 0, im = 0;
    for (let n = 0; n < fftSize; n++) {
      const angle = (2 * Math.PI * k * n) / fftSize;
      re += data[offset + n] * Math.cos(angle);
      im -= data[offset + n] * Math.sin(angle);
    }
    const mag = Math.sqrt(re * re + im * im);
    weighted += freq * mag;
    total += mag;
  }
  return total > 0 ? weighted / total : 0;
}

export async function analyzeAudio(file: File, onProgress?: (p: number, label: string) => void): Promise<AudioAnalysis> {
  onProgress?.(5, 'DECODING WAVEFORM');
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  await ctx.close();

  onProgress?.(25, 'EXTRACTING PEAKS');
  const peaks = computePeaks(buffer);

  onProgress?.(40, 'DETECTING BPM');
  const bpm = detectBPM(buffer);

  onProgress?.(60, 'ANALYZING KEY');
  const { key, scale } = detectKey(buffer);

  onProgress?.(80, 'MAPPING SECTIONS');
  const sections = computeSections(peaks, buffer.duration);
  const spectralCentroid = computeSpectralCentroid(buffer);

  onProgress?.(95, 'CALCULATING ENERGY');
  const energy = peaks.reduce((a, b) => a + b, 0) / peaks.length;
  const loudness = 20 * Math.log10(energy + 1e-6);

  onProgress?.(100, 'COMPLETE');
  return {
    duration: buffer.duration,
    bpm,
    key,
    scale,
    energy,
    loudness,
    peaks,
    sections,
    spectralCentroid,
    fileName: file.name,
  };
}
