import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SAMPLE_RATE = 44100;
const ROOT = resolve("public/assets/audio/v1");

const CUES = {
  "encounter-start": { frequencies: [196, 262, 330], duration: 0.11, gap: 0.04, waveform: "sine", gain: 0.32 },
  "incoming-fire": { frequencies: [440, 330], duration: 0.12, gap: 0.03, waveform: "triangle", gain: 0.34 },
  victory: { frequencies: [262, 330, 392, 523], duration: 0.1, gap: 0.04, waveform: "sine", gain: 0.34 },
  defeat: { frequencies: [330, 247, 196], duration: 0.16, gap: 0.06, waveform: "triangle", gain: 0.32 },
  "weapon-fire": { frequencies: [120, 76], duration: 0.08, gap: 0.01, waveform: "sawtooth", gain: 0.2, sweep: -0.45 },
  "weapon-hit": { frequencies: [540], duration: 0.07, gap: 0, waveform: "square", gain: 0.18, sweep: -0.2 },
  "unit-destroyed": { frequencies: [96, 64], duration: 0.2, gap: 0.03, waveform: "sawtooth", gain: 0.28, sweep: -0.5 },
  "ui-select": { frequencies: [480], duration: 0.06, gap: 0, waveform: "sine", gain: 0.14 },
  "ui-target-lock": { frequencies: [620, 780], duration: 0.06, gap: 0.02, waveform: "sine", gain: 0.16 },
  "ui-move-order": { frequencies: [350, 440], duration: 0.05, gap: 0.02, waveform: "triangle", gain: 0.14 },
  "ui-queue-move": { frequencies: [300, 380], duration: 0.05, gap: 0.02, waveform: "triangle", gain: 0.12 },
  "ui-attack-order": { frequencies: [300, 220], duration: 0.07, gap: 0.02, waveform: "square", gain: 0.14 },
  "ui-queue-attack": { frequencies: [280, 200], duration: 0.07, gap: 0.02, waveform: "square", gain: 0.12 },
  "ui-stop-order": { frequencies: [180], duration: 0.08, gap: 0, waveform: "triangle", gain: 0.14 },
  "ui-pause": { frequencies: [220, 160], duration: 0.1, gap: 0.03, waveform: "sine", gain: 0.16 },
  "ui-resume": { frequencies: [330, 440], duration: 0.08, gap: 0.03, waveform: "sine", gain: 0.16 },
  "ui-toggle-effects": { frequencies: [520], duration: 0.06, gap: 0, waveform: "sine", gain: 0.12 },
  "ui-audio-enabled": { frequencies: [440, 660], duration: 0.07, gap: 0.03, waveform: "sine", gain: 0.16 },
  "ui-audio-setting": { frequencies: [420], duration: 0.04, gap: 0, waveform: "sine", gain: 0.08 },
  "ui-error": { frequencies: [140], duration: 0.12, gap: 0, waveform: "square", gain: 0.18 },
};

await mkdir(ROOT, { recursive: true });
const manifest = {
  schemaVersion: 1,
  source: "Deterministic WebAudio candidate cue render",
  rights: "Project-generated candidate assets; replace with final licensed recordings before release.",
  sampleRate: SAMPLE_RATE,
  channels: 1,
  assets: {},
};

for (const [cue, profile] of Object.entries(CUES)) {
  const duration = profile.frequencies.length * (profile.duration + profile.gap);
  const samples = Math.ceil(duration * SAMPLE_RATE);
  const pcm = new Int16Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const time = index / SAMPLE_RATE;
    let sample = 0;
    for (let toneIndex = 0; toneIndex < profile.frequencies.length; toneIndex += 1) {
      const onset = toneIndex * (profile.duration + profile.gap);
      const localTime = time - onset;
      if (localTime < 0 || localTime >= profile.duration) continue;
      const ratio = localTime / profile.duration;
      const frequency = profile.frequencies[toneIndex] * (1 + (profile.sweep ?? 0) * ratio);
      const phase = 2 * Math.PI * frequency * localTime;
      const wave = profile.waveform === "square"
        ? Math.sign(Math.sin(phase))
        : profile.waveform === "sawtooth"
          ? 2 * (frequency * localTime - Math.floor(0.5 + frequency * localTime))
          : profile.waveform === "triangle"
            ? 2 * Math.abs(2 * (frequency * localTime - Math.floor(frequency * localTime + 0.5))) - 1
            : Math.sin(phase);
      const attack = Math.min(1, localTime / 0.008);
      const release = Math.min(1, (profile.duration - localTime) / 0.025);
      sample += wave * profile.gain * attack * release;
    }
    pcm[index] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
  }

  const fileName = cue + ".wav";
  await writeFile(resolve(ROOT, fileName), createWav(pcm, SAMPLE_RATE));
  manifest.assets[cue] = {
    url: "/assets/audio/v1/" + fileName,
    format: "wav",
    channels: 1,
    sampleRate: SAMPLE_RATE,
    duration: Number(duration.toFixed(3)),
    source: "project-generated candidate",
    fallback: "procedural-cue",
  };
}

await writeFile(resolve(ROOT, "asset-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Generated", Object.keys(manifest.assets).length, "audio cues in", ROOT);

function createWav(pcm, sampleRate) {
  const dataSize = pcm.byteLength;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buffer, 44);
  return buffer;
}
