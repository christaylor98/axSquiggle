// Voice-over for the demo recorders: Gemini TTS (voice Aoede), one clip per line.
//
// Clips are made before the browser starts and cached in .cache/vo, so a line is only paid for once and re-recording
// is free until the words change. While recording, say() starts a line once the previous one has finished, so the
// video stretches to fit the voice instead of the voice being squeezed into the video.
//
//   GEMINI_API_KEY=...   required unless NO_VO=1 (records silent, as before)
//   DEMO_VOICE=Aoede     any Gemini prebuilt voice
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MODEL = process.env.DEMO_TTS_MODEL ?? 'gemini-3.1-flash-tts-preview';
const VOICE = process.env.DEMO_VOICE ?? 'Aoede';
// an audio tag, not an instruction: this model reads instructions like "Say this warmly:" out loud, but not tags
const STYLE = '[relaxed, warm, conversational]';
const RATE = 24000; // Gemini returns 24 kHz mono 16-bit

const wavSeconds = (b) => {
  for (let i = 12; i + 8 <= b.length; ) {
    const id = b.toString('ascii', i, i + 4), n = b.readUInt32LE(i + 4);
    if (id === 'data') return Math.min(n, b.length - i - 8) / (RATE * 2);
    i += 8 + n + (n & 1);
  }
  throw new Error('no data chunk in wav');
};

async function tts(text, key) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${STYLE} ${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
      }),
    });
    const j = await r.json().catch(() => ({}));
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (r.ok && part) {
      const b = Buffer.from(part.inlineData.data, 'base64');
      // raw PCM comes back from some models: wrap it so every clip on disk is a real wav
      if (b.toString('ascii', 0, 4) === 'RIFF') return b;
      const h = Buffer.alloc(44);
      h.write('RIFF', 0); h.writeUInt32LE(36 + b.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
      h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(b.length, 40);
      return Buffer.concat([h, b]);
    }
    // the safety filter sometimes blocks a harmless line: retrying won't help, rewording will
    if (j.promptFeedback?.blockReason) return { blocked: j.promptFeedback.blockReason };
    const msg = j.error?.message ?? `HTTP ${r.status}, no audio`;
    // 429, 5xx, and a 200 with no audio (the model sometimes answers in text) are worth another go
    // a daily cap won't lift by retrying: say so now, with Google's own wait time
    if (/per_day/.test(msg)) throw new Error(`tts: daily quota for ${MODEL} used up. ${/Please retry in [^.]+/.exec(msg)?.[0] ?? ''} (made clips are cached; rerun then, or set DEMO_TTS_MODEL)`);
    if (attempt >= 6 || !(r.status === 429 || r.status >= 500 || r.ok)) throw new Error(`tts "${text.slice(0, 40)}…": ${msg}`);
    const wait = Number(/retry in ([\d.]+)s/i.exec(msg)?.[1] ?? 0) * 1000 || 5000 * attempt;
    console.log(`tts: ${msg.split('\n')[0].slice(0, 100)}; retrying in ${Math.round(wait / 1000)}s`);
    await new Promise((res) => setTimeout(res, wait));
  }
}

// lines: { key: 'words to say' }; now(): seconds into the video. Returns { say(key), done(), clips } where clips are [{ t, file }] in video seconds.
export async function makeVoice({ root, lines, now, sleep, off = false }) {
  const clips = [];
  if (off) return { say: async () => {}, done: async () => {}, clips };
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('voice-over needs GEMINI_API_KEY (or NO_VO=1 to record silent)');
  const dir = join(root, '.cache/vo'); mkdirSync(dir, { recursive: true });
  const made = {};
  let fresh = 0;
  const blocked = [];
  for (const [k, text] of Object.entries(lines)) {
    const file = join(dir, `${createHash('sha1').update([MODEL, VOICE, STYLE, text].join('\n')).digest('hex').slice(0, 16)}.wav`);
    if (!existsSync(file)) {
      const wav = await tts(text, key);
      if (wav.blocked) { blocked.push(`  ${k}: "${text}" (${wav.blocked})`); continue; }
      writeFileSync(file, wav); fresh++;
    }
    made[k] = { file, dur: wavSeconds(readFileSync(file)) };
  }
  if (blocked.length) throw new Error(`Google's filter blocked ${blocked.length} line(s); reword them (the rest are cached):\n${blocked.join('\n')}`);
  const total = Object.values(made).reduce((s, c) => s + c.dur, 0);
  console.log(`voice: ${Object.keys(made).length} lines (${fresh} new), ${Math.round(total)}s of speech, ${VOICE}`);
  let until = 0;
  const done = async () => { const d = until - Date.now(); if (d > 0) await sleep(d); };
  const say = async (k) => {
    const c = made[k]; if (!c) throw new Error(`no voice line "${k}"`);
    await done();
    clips.push({ t: now(), file: c.file });
    until = Date.now() + c.dur * 1000 + 300;
  };
  return { say, done, clips };
}

// ffmpeg args that lay the clips over the video at their times. Inputs go first; `extra` inputs (a chapters file, say)
// slot in after them as input number `next`.
export function mixArgs(video, clips) {
  const next = clips.length + 1;
  if (!clips.length) return { inputs: ['-i', video], out: ['-map', '0:v', '-an'], next };
  const legs = clips.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.t * 1000)}:all=1[a${i}]`);
  const mix = `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5[aout]`;
  return {
    inputs: ['-i', video, ...clips.flatMap((c) => ['-i', c.file])],
    out: ['-filter_complex', [...legs, mix].join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000'],
    next,
  };
}
