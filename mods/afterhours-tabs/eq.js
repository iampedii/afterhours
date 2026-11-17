// The top bar's backdrop: a dot-matrix skyline that moves with whatever the Mac is playing.
// Bass sits in the centre and treble falls away to both sides, in deep, medium
// and pale terracotta; the left half shows the left channel and the right half the right. Each column is one bar whose height springs natively; a grille of
// bar-colored lines cuts the bars into pixels, and a cap rests on each column's recent peak and
// sinks slowly. A strong bass hit throws particles off the centre columns, and a bright treble hit
// throws them off the outer ones; a particle hops along the skyline a few times before it fades.
// Everything keeps time with the music: the tempo is measured from the bass hits, each hop
// lasts one beat so particles land on the beat, and the skyline swells a little on every beat.
// With no sound it settles into a dim dotted baseline.
//
// Bass, mid-range and treble hits throw deep, medium and pale terracotta particles respectively;
// their color follows the triggering sound even when they scatter across the skyline.
// Melodic particles follow the prominent midrange contour: higher notes rise and spread,
// lower notes drop and gather; note changes set their cadence. Bass keeps the beat.
//
// The particles' tops trace the tune: every hop peaks on the row the current note's pitch maps to
// (a low note just above the skyline, a high one near the top of the bar), so the arcs rise and
// fall with the melody. Each particle keeps a small interval of its own, a row or two off that
// line, so a group peaks as a chord, not a flat line. A hop lasts a whole number of half beats: a
// hard note picks a short one, a soft note a long one, so speed follows the note's attack and the
// tempo, and every landing still falls on the beat.
//
// What is on screen follows what is playing now, not what played a moment ago. A new note bends
// the particles already rising onto its row. A new hit retires the same voice's older particles:
// they finish the hop they are on and fade, instead of hopping on through the next event. A sudden
// drop in level retires them all the same way.
//
// How much the particles project follows the music's drive (0..1): a higher pitch, a stronger bass
// and a faster tempo each raise it. Pitch and bass are judged against the song's own range over the
// last minute, so every song runs from calm to full, and a sudden moment (a fill, a drop) adds a
// burst on top that fades in under a second. More drive throws more particles, further and faster.
// Bass has weight, melody moves in phrases, and treble makes brief fine accents. Sharp attacks
// project further and faster; dense mixes emit fewer particles so each gesture has room.
//
// The look. The skyline's color blends from deep terracotta at the centre through medium to pale at
// the ends, and the whole of it runs a little hotter as the music's drive rises. A particle leaves
// bright (the harder the note, the nearer white) and cools at each stage of its flight, so the
// newest event is the brightest thing on screen. Where one lands, the column's top dot flashes.
// Launches, peaks and landings sit on the dot grid; particles fade out towards the ends of the
// skyline and under the tabs. A calm passage throws a handful and a driven one a crowd.
//
// The levels come from tools/afterhours-eq (a small helper that analyses system audio and writes 32
// band levels per channel plus the overall loudness to /tmp/afterhours-eq.levels about 20 times a
// second); this mod starts it if needed.

import { div } from "gpui-kit";
import { exec, readTextFile, appHome } from "herdr";

const LEVELS = "/tmp/afterhours-eq.levels";
const DOT = 3, PITCH_X = 6, PITCH_Y = 5, ROWS = 6;     // 3 px pixels, 6 high: leaves headroom for flying dots
const HEIGHT = ROWS * PITCH_Y;
const SPARKS = 180;     // bounded room for overlapping beats and note changes
const MINUTE = 1200;     // readings in a minute, at about 20 a second
const FIRST = 3;         // the lowest bands (under ~80 Hz) are nearly always empty: the centre starts above them
// Rows a particle may peak off the note's line: mostly on it, sometimes a step or two away.
const INTERVALS = [0, 0, 0, 1, -1, 2];
// Hop lengths in beats, by how hard the note is: the choice is random, the values keep time.
const LENGTHS = { hard: [0.5, 0.5, 1], medium: [1, 1, 0.5], soft: [1, 1, 2] };
const choose = (list) => list[Math.floor(Math.random() * list.length)];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const css = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const blend = (a, b, t) => a.map((v, j) => v + (b[j] - v) * t);
function voiceAt(k) {
  return RANGES.bass.zone(k) ? RANGES.bass : RANGES.treble.zone(k) ? RANGES.treble : RANGES.mid;
}

// Which columns a hit throws particles from, how many, and how they travel.
const RANGES = {
  // bands: which of the 32 bands the range covers (bass ~55-190 Hz, mid ~400 Hz-1.7 kHz, treble ~2-8.6 kHz).
  // floor: the level under which the range is too quiet to count as a hit.
  bass: { kind: "bass", color: "#d2704a", bands: [1, 8], floor: 20, count: 19, zone: (k) => k < 0.28, hops: 2, reach: 40 },
  mid: { kind: "mid", color: "#e3a68f", bands: [12, 20], floor: 12, count: 13, zone: (k) => k > 0.38 && k < 0.8, hops: 2, reach: 30 },
  treble: { kind: "treble", color: "#f5e0d7", bands: [21, 29], floor: 5, count: 15, zone: (k) => k > 0.8, hops: 1, reach: 15 },
  // Not a range of its own: the whole skyline, for particles scattered by a sudden moment.
  any: { zone: () => true },
};

const unit = (v) => Math.min(1, Math.max(0, v));
// A value that remembers the lowest and highest it has been over about the last minute, and says
// where it stands between them. `span` is the least range it will stretch over, so a value that
// barely moves reads as the middle, not as swinging from 0 to 1.
class Ranged {
  constructor(span) { this.span = span; this.v = null; }
  at(x, ease) {
    if (this.v === null) { this.v = this.lo = this.hi = x; }
    this.v += (x - this.v) * ease;
    const drift = Math.max(this.span, this.hi - this.lo) / MINUTE;
    this.lo = Math.min(this.v, this.lo + drift);
    this.hi = Math.max(this.v, this.hi - drift);
    const room = Math.max(this.span, this.hi - this.lo), mid = (this.hi + this.lo) / 2;
    return unit(0.5 + (this.v - mid) / room);
  }
}

// A small lift keeps tips and peak caps bright without washing out their hue.
const WHITE = hex("#ffffff");
const lighten = (c) => css(blend(c, WHITE, 0.18));

// The skyline's color across its width (0 = centre, 1 = either end), calm and at full drive. The
// stops sit at the middle of each voice's columns, so the voices' own colors (RANGES) fall between.
const CALM = [[0.1, hex("#b9674a")], [0.55, hex("#cfa08f")], [0.92, hex("#e3d3cc")]];
const DRIVEN = [[0.1, hex("#ee7a48")], [0.55, hex("#f2b596")], [0.92, hex("#fff1ea")]];
function along(stops, k) {
  if (k <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (k <= stops[i][0]) return blend(stops[i - 1][1], stops[i][1], (k - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  }
  return stops.at(-1)[1];
}

// A particle's color at each stage of its flight: bright as it leaves (nearer white the harder
// the note), its voice's own color on the way down, then deeper on each later hop.
const WARM = hex("#fff4ea"), DEEP = hex("#7d3a22");
function shade(s, falling) {
  const voice = hex(s.color), stage = (s.first - s.hops) * 2 + (falling ? 1 : 0);
  if (stage === 0) return css(blend(voice, WARM, 0.3 + 0.5 * s.hardness));
  return css(blend(voice, DEEP, Math.min(0.6, 0.22 * (stage - 1))));
}

export class Equaliser {
  constructor() {
    this.bands = new Array(64).fill(0);    // left channel's 32 bands, then the right's
    this.loud = 0;           // overall loudness over the last couple of seconds, 0..100
    this.loudest = 0;        // the loudest it has been lately (falls slowly): a chorus sets it, a verse sits under it
    this.gain = 1;           // how tall this section stands, 0.65..1
    this.caps = [];
    this.tops = [];          // each column's top edge and x, from the last render: where sparks start
    this.text = "";
    this.live = false;       // any sound right now
    this.busy = false;
    this.moving = false;
    this.usual = { bass: 0, mid: 0, treble: 0 };      // recent typical levels, to tell a hit from steady sound
    this.lastHit = { bass: 0, mid: 0, treble: 0 };
    this.barH = 0;
    this.beatMs = 500;       // the music's beat, measured from bass hits (500 ms = 120 bpm)
    this.gaps = [];          // recent gaps between bass hits, folded into one beat
    this.lastBass = 0;
    this.nextBeat = 0;       // when the next beat is due, so the rhythm carries through quiet beats
    this.pulse = 0;          // 1 on a beat, fading: the skyline's swell
    this.steps = 0;          // beats counted so far: the dancer's step
    this.lastStep = 0;
    this.drive = 0;          // how hard the music pushes right now, 0..1: pitch, bass and tempo, plus bursts
    this.hardness = 0;       // 0..1: how suddenly the spectrum attacks, with a softer release
    this.pitch = new Ranged(4);      // where the sound's weight sits, in bands
    this.melody = { band: null, candidate: null, frames: 0, direction: 0, jump: 0, at: 0, noteMs: 500, strength: 0, hard: 0, last: null };
    this.level0 = 0;         // the usual overall level, to notice a sudden drop
    this.height = 0.5;       // where the sound's weight sits in the song's own range, 0..1: the note line when no tune stands out
    this.centreX = 0;
    this.low = new Ranged(25);       // how strong the bass is
    this.burst = 0;          // 1 on a sudden moment, fading
    this.lastBurst = 0;
    this.flux = 0;           // how much the spectrum usually jumps between readings
    this.before = null;      // the last reading, to measure the jump
    this.crowd = 0;          // the share of bands that are busy
    this.spread = { bass: 0, mid: 0, treble: 0 };     // how much each range usually strays from its usual level
    this.awake = false;      // sound on the last reading
    this.warmth = 0;         // drive, followed slowly: how hot the skyline's color runs
    this.flash = [];         // per column: 1 where a particle just landed, fading
    this.x0 = 0;
    this.span = [0, 0];      // the stretch of the bar particles show in, in px
    this.sparks = Array.from({ length: SPARKS }, (_, k) => ({ k, state: "idle", x: 0, y: 0 }));
  }

  start(cx) {
    const launch = () => exec("sh", ["-c", `pgrep -x afterhours-eq >/dev/null || (nohup "${appHome()}/tools/afterhours-eq/afterhours-eq" >/dev/null 2>&1 &)`]).catch(() => {});
    launch();
    cx.timer.every(30000, launch);
    cx.timer.every(30, (cx) => {
      if (this.clock() | this.stepSparks()) cx.notify();
      if (this.busy) return;
      this.busy = true;
      readTextFile(LEVELS).then((text) => {
        this.busy = false;
        if (!text) return;
        // Same reading again: keep easing until the bars have settled, then stop redrawing.
        if (text === this.text && !this.moving) return;
        const fresh = text !== this.text;
        this.text = text;
        const all = text.trim().split(/\s+/).map(Number);
        if (all.length < 32 || all.some(Number.isNaN)) return;
        // 65 numbers: left bands, right bands, loudness. (An older helper sends 32: mono, no loudness.)
        const stereo = all.length >= 64;
        const v = stereo ? all.slice(0, 64) : [...all.slice(0, 32), ...all.slice(0, 32)];
        const mono = Array.from({ length: 32 }, (_, i) => (v[i] + v[32 + i]) / 2);
        if (fresh && all.length >= 65) {
          // Quiet and loud sections: loudness is averaged over a couple of seconds, so a gap
          // between beats doesn't count. The skyline stands at full height at the loudest the song
          // has been lately and eases down to about two thirds for a section 8 dB quieter.
          this.loud += (all[64] - this.loud) * 0.04;
          this.loudest = Math.max(this.loud, this.loudest - 0.02);          // falls ~1 point every 3 s
          const want = Math.min(1, Math.max(0.65, 1 - (this.loudest - this.loud) / 48));
          this.gain += (want - this.gain) * 0.05;
        }
        // Quick up, softer down, and a light blend with neighbours so the skyline holds together.
        const eased = v.map((x, i) => { const old = this.bands[i] ?? 0; return old + (x - old) * (x > old ? 0.55 : 0.3); });
        const near = (i, d) => (Math.floor((i + d) / 32) === Math.floor(i / 32) ? eased[i + d] : eased[i]);   // not across the left/right seam
        this.bands = eased.map((x, i) => 0.2 * near(i, -1) + 0.6 * x + 0.2 * near(i, 1));
        this.live = v.some((x) => x > 0);
        this.moving = eased.some((x, i) => Math.abs(x - v[i]) > 1);
        if (fresh) {
          // The first reading after silence is a jump from nothing: learn from it, don't react to it.
          if (this.awake) { this.feel(mono); this.beat(mono); }
          else this.settle(mono);
          this.followMelody(mono);
          if (!this.live) for (const s of this.sparks) if (s.state !== "idle") s.hops = Math.min(s.hops, 1);
          this.stepSparks();
          this.awake = this.live;
        }
        cx.notify();
      }, () => { this.busy = false; });
    });
  }

  level(v, r) { return v.slice(r.bands[0], r.bands[1] + 1).reduce((x, y) => x + y, 0) / (r.bands[1] - r.bands[0] + 1); }

  // After silence: take the reading as the usual, so the sound coming back isn't a hit.
  settle(v) {
    this.before = v;
    for (const name of ["bass", "mid", "treble"]) this.usual[name] = this.level(v, RANGES[name]);
  }

  // shortcut: follows the strongest midrange band; use a pitch-tracking audio feed for exact notes.
  followMelody(v) {
    const m = this.melody, now = Date.now(), last = m.last ?? v;
    m.last = v;
    let band = 8, peak = 0, mean = 0;
    for (let i = 8; i <= 23; i++) {
      const level = 0.2 * v[i - 1] + 0.6 * v[i] + 0.2 * v[i + 1];
      mean += level / 16;
      if (level > peak) { peak = level; band = i; }
    }
    if (peak < 18 || peak - mean < 6) {
      Object.assign(m, { band: null, candidate: null, frames: 0, direction: 0, jump: 0, at: 0, strength: 0 });
      for (const s of this.sparks) if (s.melodic) s.state = "idle";
      return;
    }
    m.strength = unit((peak - mean) / 50);
    m.frames = band === m.candidate ? m.frames + 1 : 1;
    m.candidate = band;
    if (m.frames < 2 || (m.band !== null && Math.abs(band - m.band) < 2) || now - m.at < 90) return;
    const previous = m.band;
    if (previous !== null) m.noteMs += (Math.min(800, Math.max(120, now - m.at)) - m.noteMs) * 0.5;
    m.direction = previous === null ? 0 : Math.sign(band - previous);
    m.jump = previous === null ? 0 : unit(Math.abs(band - previous) / 12);
    m.band = band;
    m.at = now;
    // How hard the note is: how sharply its band rose since the last reading.
    m.hard = unit((v[band] - last[band]) / 25);
    this.retarget(now);
    const k = unit((band - FIRST) / (31 * 0.8 - FIRST));
    this.launch({ ...RANGES.mid, color: voiceAt(k).color, zone: (p) => Math.abs(p - k) < 0.08 }, Math.round((11 + m.strength * 15) * this.crowding()), m.hard);
  }

  // Energy, attack and density, from one reading.
  feel(v) {
    const now = Date.now(), total = v.reduce((x, y) => x + y, 0);
    // Pitch: the band the sound's weight centres on. Bass: the low bands' level. Each is half its
    // place in the song's own range and half an absolute reading, so a quiet song can't max out.
    const centre = total > 0 ? v.reduce((x, y, i) => x + y * i, 0) / total : 0, bass = this.level(v, RANGES.bass);
    this.height = this.pitch.at(centre, 0.2);
    const pitch = 0.6 * this.height + 0.4 * unit((this.pitch.v - 8) / 8);
    const low = 0.6 * this.low.at(bass, 0.15) + 0.4 * unit((this.low.v - 25) / 50);
    // Tempo: 85 bpm and under adds nothing, 170 is full. It only counts while the beat is being heard.
    const tempo = now - this.lastBass < this.beatMs * 6 ? unit((60000 / this.beatMs - 85) / 85) : 0;
    // A moment: the spectrum jumps far more than it has been. It scatters particles from anywhere.
    const jump = v.reduce((x, y, i) => x + Math.max(0, y - this.before[i]), 0) / v.length;
    this.before = v;
    const attack = unit(3 * jump / (total / v.length + 8));
    this.hardness += (attack - this.hardness) * (attack > this.hardness ? 0.6 : 0.15);
    if (jump > this.flux * 2.2 + 4 && now - this.lastBurst > 400) {
      this.burst = 1;
      this.lastBurst = now;
      this.launch(RANGES.any, Math.round(13 + this.drive * 19), attack);
    }
    this.flux += (jump - this.flux) * 0.06;
    this.burst *= 0.88;
    // The curve keeps an ordinary passage (each part near its middle) around a third, and saves the top for peaks.
    const section = Math.pow(unit(0.4 * pitch + 0.4 * low + 0.3 * tempo), 1.5);
    this.drive += (unit(section + 0.5 * this.burst) - this.drive) * 0.35;
    // The music drops away (a break, a stop): what is in the air finishes its hop and fades.
    if (total < this.level0 * 0.55) this.retire(() => true);
    this.level0 += (total - this.level0) * 0.1;
    this.warmth += (this.drive - this.warmth) * 0.06;
    this.crowd += (v.filter((x) => x > 35).length / v.length - this.crowd) * 0.05;
  }

  // A hit: a range rises above its recent usual by more than it usually strays, so a range that
  // is always busy and one that is nearly silent each throw about as often. Bass throws particles
  // off the centre columns and sets the tempo; treble throws them off the outer pale ones.
  beat(v) {
    const now = Date.now();
    for (const name of ["bass", "mid", "treble"]) {
      const r = RANGES[name], level = this.level(v, r), over = level - this.usual[name];
      const quick = 240 * (1 - 0.5 * this.drive);      // harder music may throw again sooner
      const gap = name === "bass" ? Math.max(quick, this.beatMs * 0.55) : quick;
      if (level > r.floor && over > Math.max(3, 1.6 * this.spread[name]) && now - this.lastHit[name] > gap) {
        this.lastHit[name] = now;
        if (name === "bass") this.tempo(now);
        const attack = unit(over / (this.usual[name] + 12));
        this.launch(r, Math.round(r.count * this.crowding()), attack);
      }
      this.usual[name] += over * 0.08;
      this.spread[name] += (Math.abs(over) - this.spread[name]) * 0.08;
    }
  }

  // Learns the beat from the gaps between bass hits. A gap of two beats, or half a beat, is
  // folded into one (75..187 bpm); the middle of the recent gaps wins, so a stray hit doesn't.
  tempo(now) {
    let gap = now - this.lastBass;
    this.lastBass = now;
    if (gap < 2500) {
      while (gap > 800) gap /= 2;
      while (gap < 320) gap *= 2;
      this.gaps.push(gap);
      if (this.gaps.length > 9) this.gaps.shift();
      const mid = [...this.gaps].sort((a, b) => a - b)[Math.floor(this.gaps.length / 2)];
      this.beatMs += (mid - this.beatMs) * 0.35;
    }
    this.nextBeat = now + this.beatMs;
    this.pulse = 1;
    this.step(now);
  }

  // Counts a beat, once: a bass hit and the clock can both mark the same one.
  step(now) {
    if (now - this.lastStep < this.beatMs * 0.5) return;
    this.lastStep = now;
    this.steps += 1;
  }

  // Keeps the beat between hits: when one is due and no bass hit marked it, a smaller throw
  // does. Also fades the swell. True when a redraw is due.
  clock() {
    const now = Date.now();
    let changed = false;
    if (this.live && this.nextBeat && now >= this.nextBeat) {
      this.nextBeat += (Math.floor((now - this.nextBeat) / this.beatMs) + 1) * this.beatMs;
      this.step(now);
      changed = true;
      if (now - this.lastHit.bass > this.beatMs * 0.6 && now - this.lastBass < this.beatMs * 6) {
        this.launch(RANGES.bass, Math.round(8 * this.crowding()));
        this.pulse = Math.max(this.pulse, 0.6);
        changed = true;
      }
    }
    if (this.pulse > 0.02) { this.pulse *= 0.72; changed = true; }
    for (let c = 0; c < this.flash.length; c++) {
      if (this.flash[c] > 0.05) { this.flash[c] *= 0.72; changed = true; } else this.flash[c] = 0;
    }
    return changed;
  }

  // How many particles an event throws, as a share of its usual: a few in a calm passage (about a
  // quarter at the calmest), the usual around the middle, and more than twice that at full drive.
  crowding() { return 0.15 + 2.6 * Math.pow(this.drive, 1.6); }

  // Particles matching `which` finish the hop they are on and fade.
  retire(which) {
    for (const s of this.sparks) if (s.state !== "idle" && which(s)) s.hops = Math.min(s.hops, 1);
  }

  // The peak a hop may have for the note sounding now: on the note's row, moved by the particle's
  // own interval. It must still clear where the hop starts and lands, so a low note over a tall
  // column makes a small hop.
  peakFor(s) { return Math.max(3, Math.min(this.noteY() - s.interval * PITCH_Y, Math.min(s.y, s.landY) - PITCH_Y)); }

  // A new note: particles still rising bend to its row over the rest of their rise.
  retarget(now) {
    for (const s of this.sparks) {
      if (s.state !== "up" || s.end - now < 50) continue;
      s.peakY = this.peakFor(s);
      s.dur = s.end - now;
    }
  }

  launch(r, count, attack = 0) {
    const zone = this.tops.filter((c) => r.zone(c.k)), tall = zone.filter((c) => c.rows >= 2);
    const from = (tall.length ? tall : zone).filter((c) => c.energy > 0.03);
    if (!from.length) return;
    const left = from.filter((c) => c.x < this.centreX);
    const right = from.filter((c) => c.x >= this.centreX);
    const share = left.reduce((sum, c) => sum + c.energy, 0) / from.reduce((sum, c) => sum + c.energy, 0);
    const hardness = unit(Math.max(attack, this.hardness * 0.6));
    count = Math.round(count * (1 - 0.25 * this.crowd));
    const used = this.sparks.filter((s) => s.state === "lit").map((s) => s.x);
    // This event takes over from the voice's earlier ones (a moment takes over from everything).
    this.retire((s) => r === RANGES.any || s.kind === r.kind);
    for (let n = 0; n < count; n++) {
      const s = this.sparks.find((p) => p.state === "idle");
      if (!s) break;
      const onLeft = left.length && (!right.length || (n + 0.5) / count < share);
      const pool = (onLeft ? left : right).filter((c) => !used.some((x) => Math.abs(x - c.x) < PITCH_X * 2));
      if (!pool.length) continue;
      let pick = Math.random() * pool.reduce((sum, c) => sum + c.energy, 0);
      let c = pool[pool.length - 1];
      for (const candidate of pool) {
        pick -= candidate.energy;
        if (pick <= 0) { c = candidate; break; }
      }
      used.push(c.x);
      const voice = r === RANGES.any ? voiceAt(c.k) : r;
      // Sample once per particle so variation feels organic without jittering during a hop.
      Object.assign(s, { state: "lit", x: c.x, y: c.y - PITCH_Y, hops: voice.hops, first: voice.hops,
        reach: voice.reach * (0.45 + 0.8 * this.drive + 0.6 * hardness) * (0.5 + Math.random()),
        // Its own interval off the note line, and its own hop length: treble's are half as long.
        interval: choose(INTERVALS), rise: 0.4 + 0.2 * Math.random(),
        beats: choose(hardness > 0.66 ? LENGTHS.hard : hardness > 0.33 ? LENGTHS.medium : LENGTHS.soft) * (voice.kind === "treble" ? 0.5 : 1),
        drift: Math.random() < 0.18 ? -1 : 1, hardness, placed: false, kind: voice.kind,
        opacity: 0.65 + 0.25 * c.energy + 0.1 * hardness,
        melodic: voice.kind === "mid" && this.melody.band !== null, color: voice.color });
    }
  }

  // Half a hop, in ms: a hop lasts one beat (two beats when the music is fast), so it lands on the beat.
  half() { return (this.beatMs < 420 ? this.beatMs * 2 : this.beatMs) / 2; }

  // The y a hop peaks at for the note sounding now: the top of the bar for the highest note, just
  // above the middle of the skyline for the lowest, on the dot grid. With no tune standing out, the
  // sound's overall pitch stands in.
  noteY() {
    const m = this.melody, k = m.band !== null ? unit((m.band - 8) / 15) : this.height;
    // Counted in rows up from the bar's bottom edge, like the column tops, so peaks sit on the grid.
    const lowest = ROWS / 2 + 1, rows = Math.round(k * (Math.floor((this.barH - 3) / PITCH_Y) - lowest));
    return this.barH - (lowest + rows) * PITCH_Y;
  }

  // One hop: up to a peak (slowing), then down onto the skyline a little way along (speeding up).
  hop(s, now) {
    const melody = s.melodic && this.melody.band !== null ? this.melody : null;
    const direction = (s.x < this.centreX ? -1 : 1) * (melody?.direction || 1) * s.drift;
    const dx = direction * (8 + (melody ? 0.3 + 0.7 * melody.strength + 0.4 * melody.jump : 1) * s.reach);
    // Land on a column, at least one along.
    s.endX = s.x + (Math.round(dx / PITCH_X) || direction) * PITCH_X;
    // Past the end of the skyline there is nothing to land on: this hop is the last.
    if (s.endX < this.span[0] || s.endX > this.span[1]) s.hops = 1;
    const under = this.tops.find((c) => Math.abs(c.x - s.endX) < PITCH_X / 2);
    s.landY = (under ? under.y : this.barH - 2 - DOT) - PITCH_Y;
    s.peakY = this.peakFor(s);
    s.state = "up";
    // Land on the musical grid: the nearest half beat (or half note), then the particle's length on.
    const tick = Math.max(120, (melody ? melody.noteMs : this.half() * 2) / 2);
    const anchor = melody ? melody.at : this.lastBass || now;
    s.landAt = anchor + (Math.round((now - anchor) / tick) + Math.max(1, Math.round(s.beats * 2))) * tick;
    const total = Math.max(120, s.landAt - now);
    s.dur = Math.max(60, Math.min(total - 60, total * s.rise));
    s.end = now + s.dur;
    // Sideways speed stays the same through the peak, so the arc has no kink there.
    s.midX = s.x + dx * (s.dur / total);
  }

  // lit on a column's top for one step -> hops (up, down, land, again) -> fades on its last fall.
  // True when a redraw is due.
  stepSparks() {
    const now = Date.now();
    let changed = false;
    for (const s of this.sparks) {
      // A particle waits to be drawn once at its start. Hopping before that would send it gliding
      // in from wherever it last faded out, right across the bar.
      if (s.state === "lit") { if (s.placed) this.hop(s, now); changed = true; }
      else if (s.state === "up" && now >= s.end) {
        // Land on whatever column is under the end point now, else on the baseline.
        const under = this.tops.find((c) => Math.abs(c.x - s.endX) < PITCH_X / 2);
        s.landY = (under ? under.y : this.barH - 2 - DOT) - PITCH_Y;
        // A rising column can overtake the arc: fade instead of sliding along or under it.
        s.state = s.landY > s.peakY + PITCH_Y && s.landAt > now ? "down" : "idle";
        s.dur = Math.max(1, s.landAt - now);
        s.end = s.landAt;
        changed = true;
      } else if (s.state === "down" && now >= s.end) {
        const column = Math.round((s.endX - this.x0) / PITCH_X);
        if (column >= 0 && column < this.flash.length) this.flash[column] = 1;
        s.hops -= 1;
        if (s.hops > 0) { s.x = s.endX; s.y = s.landY; this.hop(s, now); }
        else s.state = "idle";
        changed = true;
      }
    }
    return changed;
  }

  // Draws across the bar from `x0` to `x1`, rising from its bottom edge, behind the tabs; its
  // width never depends on how many are open. Columns left of `dimUntil` (under the tabs) are
  // faint and capless so titles stay readable.
  render(x0, x1, barH, canvas, dimUntil = 0) {
    const n = Math.floor((x1 - x0) / PITCH_X);
    if (n < 8 || barH < HEIGHT) return [];
    if (this.caps.length !== n) { this.caps = new Array(n).fill(0); this.flash = new Array(n).fill(0); }
    this.x0 = x0;
    this.span = [Math.max(x0, dimUntil), x0 + (n - 1) * PITCH_X];
    const warmth = Math.round(this.warmth * 20) / 20;      // in steps, so colors don't change on every frame
    const last = 31 * 0.8;      // the top fifth of the spectrum is nearly always empty
    const centre = (n - 1) / 2;
    this.centreX = x0 + centre * PITCH_X;
    const out = [];
    this.tops = [];
    this.barH = barH;
    for (let c = 0; c < n; c++) {
      const k = Math.abs(c - centre) / centre, p = FIRST + k * (last - FIRST), i = Math.floor(p), f = p - i;   // 0 = bass, at the centre
      const side = c < centre ? 0 : 32;                 // left channel on the left half, right on the right
      const raw = (this.bands[side + i] * (1 - f) + (this.bands[side + Math.min(31, i + 1)] ?? 0) * f) / 100;
      // A steep curve keeps steady sound low (2-3 dots) and saves the top rows for peaks; it swells on the beat.
      const level = Math.min(1, Math.pow(raw, 1.9) * 1.1 * (1 + 0.3 * this.pulse) * this.gain);        // lift mid levels so the skyline uses its full height
      const rows = Math.max(1, Math.round(level * ROWS));
      const h = rows * PITCH_Y - (PITCH_Y - DOT);
      this.caps[c] = Math.max(h, this.caps[c] - 0.6);
      const tone = blend(along(CALM, k), along(DRIVEN, k), warmth), color = css(tone), x = x0 + c * PITCH_X, dim = x < dimUntil;
      const flash = dim ? 0 : this.flash[c];
      if (!dim) this.tops.push({ x, y: barH - 2 - h, rows, color, k, energy: raw });
      // Polish: the skyline dissolves toward both ends; each column's body is soft and its top
      // dot is a lighter, brighter tip, so the outline reads as a glowing edge; the centre
      // flashes a little on the beat; at rest the baseline breathes slowly.
      const edge = (1 - 0.75 * Math.pow(k, 2.5)) * (dim ? 0.35 : 1);
      const body = div().id(`eq-${c}`).absolute().left(x).bottom(2).w(DOT).h(h).bg(color)
        .spring("height", { response: 360, damping: 1 });
      out.push(this.live
        ? body.opacity(Math.min(1, (rows > 1 ? 0.55 : 0.7) * edge + 0.25 * this.pulse * (1 - k) * (dim ? 0 : 1) + (rows > 1 ? 0 : 0.3 * flash))).transition("opacity", { duration: 300, easing: "ease-out" })
        : body.loop("opacity", { from: 0.14 * edge, to: 0.34 * edge, period: 3600 }));
      const light = lighten(tone);
      if (this.live && rows > 1) {
        out.push(div().id(`eq-tip-${c}`).absolute().left(x).top(barH - 2 - h).w(DOT).h(DOT).bg(flash > 0.05 ? css(blend(tone, WARM, 0.18 + 0.6 * flash)) : light).opacity(0.95 * edge)
          .spring("top", { response: 360, damping: 1 }));
      }
      if (this.live && !dim && this.caps[c] > h + 2) {
        out.push(div().id(`eq-cap-${c}`).absolute().left(x).top(barH - 2 - this.caps[c] - PITCH_Y).w(DOT).h(DOT).bg(light).opacity(0.7 * edge)
          .spring("top", { response: 480, damping: 1 }));
      }
    }
    // The grille: bar-colored lines between pixel rows turn each bar into a stack of dots.
    for (let r = 1; r <= ROWS + 1; r++) {
      out.push(div().absolute().left(x0).w(n * PITCH_X).bottom(2 + r * PITCH_Y - (PITCH_Y - DOT)).h(PITCH_Y - DOT).bg(canvas));
    }
    // Particles. Transitions stay attached; a reset to a new start point uses 1 ms. Sideways
    // motion is even while the rise slows and the fall speeds up, which draws an arc.
    for (const s of this.sparks) {
      const up = s.state === "up", down = s.state === "down", d = up || down ? s.dur : 1;
      const x = up ? s.midX : down ? s.endX : s.x, y = up ? s.peakY : down ? s.landY : s.y;
      const last = down && s.hops <= 1;
      if (s.state === "lit") s.placed = true;
      // Fades over the last 40 px before either end of the skyline (the tabs' edge on the left),
      // and a little on each later hop.
      const inside = unit(Math.min(x - this.span[0], this.span[1] - x) / 40);
      const visible = s.state === "idle" || s.state === "lit" || last ? 0 : s.opacity * inside * (s.hops < s.first ? 0.75 : 1);
      out.push(div().id(`eq-spark-${s.k}`).absolute().size(DOT).left(x).top(y).bg(s.color ? shade(s, down) : RANGES.treble.color)
        .opacity(visible)
        // Rising slows to the peak and falling speeds up from it: one unbroken arc. A particle
        // fades in as it leaves the skyline and out on its last fall.
        .transition("left", { duration: d, easing: "linear" }).transition("top", { duration: d, easing: up ? "ease-out" : "ease-in" })
        .transition("opacity", { duration: up ? Math.min(d, 140) : d, easing: up ? "ease-out" : "ease-in" }));
    }
    return out;
  }
}
