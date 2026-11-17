// Small figures in the shape of the Claude Code icon who dance at the right end of the top bar
// while music plays. One is always there, just past the end of the skyline. As the music's drive rises (higher pitch, stronger bass, faster tempo: eq.js), up to
// three smaller friends rise out of the bar to its left, one per beat, and sink away again as the
// music settles.
//
// The dancing comes from the equaliser. Every beat is one step of a move, and a move is a short
// list of poses that repeats. The troupe keeps a move for eight beats, then picks another that
// suits how hard the music is driving: gentle ones when it is calm (swaying, nodding, waving
// hello), livelier ones in the middle (shuffling, stomping, kicking, twisting) and big ones at
// full drive (hopping, spinning, jumping jacks, moonwalking, crouching then leaping). Friends dance
// the same move as a canon: each is one step behind the figure to its right, and every other one
// mirrors it. On top of the move a figure bounces on each beat, bigger the harder the music
// drives, jumps on a sudden moment (a fill, a drop), and blinks now and then.
//
// When the music stops the friends sink away and the first figure takes a break: after a couple of
// seconds of silence (so a gap between songs doesn't count) it sits down and smokes a cigarette,
// lifting it for a drag every few seconds and breathing out puffs that drift up and fade. After
// about 45 seconds the cigarette is done and it dozes, sitting still with its eyes shut, until
// the music comes back. It only appears once music has played.
//
// Motion is carried by springs, not redrawn frame by frame. A part is given a new place only when
// something happens (a beat, the bounce letting go, a jump), and springs there over about half a
// beat with a little overshoot. Every part uses the same spring, so a figure moves as one.
//
// A figure is drawn on a 16 x 10 grid of cells, the icon's own proportions: a 12 x 8 body, two
// arms, four legs and two eyes.

import { div } from "gpui-kit";

const CELL = 2.5;      // px per grid cell for the first figure: 40 px wide and 25 px tall
export const DANCER_WIDTH = 16 * CELL + 20;      // its space, with room either side to lean and shuffle
// The friends, nearest first: smaller, and each its own shade of the icon's color.
const FRIENDS = [{ cell: 2, color: "#e39373" }, { cell: 2, color: "#c5633f" }, { cell: 2, color: "#eaab8f" }];
const FRIEND_GAP = 42;      // px from one friend's centre to the next
const DOT_SMOKE = 2.5;      // px: a puff of smoke
// The drive at which each friend joins. One leaves when drive falls a tenth below its mark.
const JOINS = [0.35, 0.5, 0.65];

// A pose. Everything is optional and in steps of the dancer's own size (bigger when the music
// drives): x leans right, y sinks (negative rises), armL / armR lower that arm (negative raises),
// legs lifts each of the four feet, spread moves the outer feet apart, eyes shifts the gaze
// sideways, and turn shows the figure "front", "left", "right" or "back" on (side on it is
// narrow, with one eye; from behind, none).
const L = [1, 1, 0, 0], R = [0, 0, 1, 1], ALL = [1, 1, 1, 1], ODD = [1, 0, 1, 0], EVEN = [0, 1, 0, 1];
const MOVES = {
  sway: { steps: [{ x: -1, armL: -1, armR: 1, legs: L }, {}, { x: 1, armL: 1, armR: -1, legs: R }, {}] },
  look: { steps: [{ eyes: -1, x: -0.4 }, {}, { eyes: 1, x: 0.4 }, {}] },
  nod: { steps: [{ y: 0.7 }, {}] },
  wobble: { steps: [{ x: -0.6, y: 0.4, legs: R }, { x: 0.6, y: 0.4, legs: L }] },
  hello: { steps: [{ armR: -1.8, x: 0.4, eyes: 1 }, { armR: -1.3, x: -0.2, eyes: 1 }] },
  wave: { steps: [{ armL: -1.4, armR: 0.6 }, { armL: 0.6, armR: -1.4 }, { armL: -1.4, armR: 0.6 }, { armL: -1.4, armR: -1.4 }] },
  roof: { steps: [{ armL: -1.6, armR: -1.6, y: -0.5 }, { armL: 0.3, armR: 0.3 }] },
  shuffle: { steps: [
    { x: -1, legs: ODD, eyes: -1 }, { x: -2, legs: EVEN, eyes: -1 }, { x: -2.6, legs: ODD, eyes: -1 }, { x: -1.5, legs: EVEN, eyes: -1 },
    { x: 1, legs: ODD, eyes: 1 }, { x: 2, legs: EVEN, eyes: 1 }, { x: 2.6, legs: ODD, eyes: 1 }, { x: 1.5, legs: EVEN, eyes: 1 }] },
  stomp: { steps: [{ legs: [2, 2, 0, 0], x: 0.6, armL: -0.6 }, {}, { legs: [0, 0, 2, 2], x: -0.6, armR: -0.6 }, {}] },
  pump: { steps: [{ armR: -1.7, x: -0.7 }, { armR: -0.5, x: -0.7 }, { armL: -1.7, x: 0.7 }, { armL: -0.5, x: 0.7 }] },
  // One arm up and the other down, leaning into it, then the other way.
  disco: { steps: [{ armR: -1.8, armL: 1.2, x: 0.8, eyes: 1 }, { armR: 1.2, armL: -1.8, x: -0.8, eyes: -1 }] },
  twist: { steps: [{ turn: "left", legs: ODD }, { legs: EVEN }, { turn: "right", legs: ODD }, { legs: EVEN }] },
  kick: { steps: [{ legs: [3, 0, 0, 0], armR: -1.2, x: 0.5 }, {}, { legs: [0, 0, 0, 3], armL: -1.2, x: -0.5 }, {}] },
  run: { steps: [{ legs: [2, 0, 2, 0], armL: -1, armR: 1 }, { legs: [0, 2, 0, 2], armL: 1, armR: -1 }] },
  bang: { steps: [{ y: 1.5 }, {}, { y: 1.5 }, { armL: -1.2, armR: -1.2 }] },
  // hops: the beat throws the figure up instead of dipping it.
  hop: { hops: true, steps: [{ armL: -1.3, armR: -1.3, legs: ALL }, { armL: 0.4, armR: 0.4 }] },
  jack: { hops: true, steps: [{ spread: 1.5, armL: -1.7, armR: -1.7 }, { armL: 0.7, armR: 0.7 }] },
  spin: { steps: [{ armL: -1, armR: -1 }, { turn: "right" }, { turn: "back", armL: -1, armR: -1 }, { turn: "left" }] },
  // Sliding one way while facing the other, there and back.
  moonwalk: { steps: [
    { x: 2.4, turn: "right", legs: ODD }, { x: 0.8, turn: "right", legs: EVEN }, { x: -0.8, turn: "right", legs: ODD }, { x: -2.4, turn: "right", legs: EVEN },
    { x: -2.4, turn: "left", legs: ODD }, { x: -0.8, turn: "left", legs: EVEN }, { x: 0.8, turn: "left", legs: ODD }, { x: 2.4, turn: "left", legs: EVEN }] },
  peek: { steps: [{ y: 2, eyes: -1 }, { y: 2, eyes: 1 }, { y: 2 }, { y: -1.5, armL: -1.6, armR: -1.6 }] },
  leap: { steps: [{ y: 1 }, { y: 1.5 }, { y: 2 }, { y: -2.6, armL: -1.7, armR: -1.7, legs: ALL }] },
};
// Which moves suit which drive: calm (under 0.3), middling (under 0.55) and driving.
const SETS = [
  ["sway", "look", "nod", "wobble", "hello", "wave"],
  ["sway", "wave", "shuffle", "stomp", "pump", "roof", "disco", "twist", "kick", "run", "bang"],
  ["hop", "jack", "spin", "leap", "moonwalk", "peek", "pump", "shuffle", "roof", "disco", "run", "twist"],
];
const HOLD = 8;      // beats a move lasts

let now = { name: "sway", since: 0, set: 0 };      // the move being danced, and the beat it started on
let friends = 0, counted = -1;                     // how many friends are out, and the beat that was last decided on
let heard = false, quiet = null;                   // whether music has played at all, and when it last stopped

// The break, in ms since the music stopped.
const SETTLE = 2500, SMOKE = 45000;      // standing still before sitting down; how long the cigarette lasts
const CYCLE = 6000;                      // one drag: hold, lift, lower and breathe out
const DRAG = [1200, 2400];               // when in the cycle the cigarette is at the mouth
const PUFFS = [2600, 3100, 3600];        // when each puff leaves, and it rises for 2 s: seen for 0.7 s, then fading

// What the first figure is doing while there is no music: null while it plays (or before any
// has), else the stage ("stand", "smoke" or "doze") and, while smoking, where in the drag it is.
function rest(eq) {
  const time = Date.now();
  if (eq.live) { heard = true; quiet = null; return null; }
  if (!heard) return null;
  quiet ??= time;
  const t = time - quiet;
  if (t < SETTLE) return { stage: "stand" };
  if (t > SETTLE + SMOKE) return { stage: "doze" };
  const at = (t - SETTLE) % CYCLE;
  return { stage: "smoke", drag: at >= DRAG[0] && at < DRAG[1], puffs: PUFFS.map((from) => (at < from || at >= from + 2000 ? "wait" : at < from + 700 ? "out" : "fade")) };
}

// Changes whenever the break needs a redraw (a new stage, the cigarette lifting or lowering, a puff
// leaving or fading), and not otherwise: the bar's timer redraws on a change. "" while music plays.
export function restKey(eq) {
  const r = rest(eq);
  return r ? `${r.stage}${r.drag ? "+" : ""}${(r.puffs ?? []).map((p) => p[0]).join("")}` : "";
}


// Chooses the next move when this one has run its beats, or sooner (after four) when the music
// has moved to a different set.
function move(eq) {
  const set = eq.drive < 0.3 ? 0 : eq.drive < 0.55 ? 1 : 2, danced = eq.steps - now.since;
  if (danced >= HOLD || (set !== now.set && danced >= 4)) {
    const others = SETS[set].filter((name) => name !== now.name);
    now = { name: others[Math.floor(Math.random() * others.length)], since: eq.steps, set };
  }
  return MOVES[now.name];
}

// One friend may join or leave per beat, so they arrive and go one after another.
function gather(eq) {
  if (eq.steps === counted) return;
  counted = eq.steps;
  if (!eq.live) friends = 0;
  else if (friends < JOINS.length && eq.drive > JOINS[friends]) friends += 1;
  else if (friends > 0 && eq.drive < JOINS[friends - 1] - 0.1) friends -= 1;
}

// The same pose facing the other way.
const FLIP = { left: "right", right: "left" };
const mirrored = (p) => ({ ...p, x: -(p.x ?? 0), eyes: -(p.eyes ?? 0), armL: p.armR, armR: p.armL, legs: p.legs && [...p.legs].reverse(), turn: FLIP[p.turn] ?? p.turn });

// One part: a box in px from the figure's centre line and top.
function part(id, x, y, w, h, color, origin, opacity) {
  return div().id(`dancer-${id}`).absolute().left(origin.x + x).top(origin.y + y).w(w).h(Math.max(1, h)).bg(color).opacity(opacity)
    .spring("left", origin.spring).spring("top", origin.spring).spring("width", origin.spring).spring("height", origin.spring)
    .transition("opacity", { duration: 260, easing: "ease-out" });
}

// One figure. `who`: its id, centre line x, cell size, color, and whether it is out (a figure
// that is not waits below the bar, unseen).
function figure(eq, who, pose, hops, barH, canvas) {
  const u = who.cell, size = (pose.still ? 0.7 : Math.round((0.4 + 0.6 * eq.drive) * 10) / 10) * (u / CELL);      // how big the moves are, in steps so it doesn't creep on every frame
  const turn = pose.turn ?? "front", wide = turn === "left" || turn === "right" ? 0.5 : 1;
  const lean = (pose.x ?? 0) * 3 * size;
  // Down for the first third of the beat and back up after it (or up and back down, for a hopping
  // move); a sudden moment jumps. Each is a fixed place the springs travel to, not a fading value.
  const beat = Math.min(800, Math.max(320, eq.beatMs)), landed = Date.now() - eq.lastStep < beat * 0.3;
  const bounce = landed && !pose.still ? (hops ? -5 : 3) * size : 0, jump = eq.burst > 0.4 && !pose.still ? 7 * (u / CELL) : 0;
  // Sitting: the body comes down until only the feet show under it.
  const dy = pose.sit ? 2 * u - 1.5 : (pose.y ?? 0) * 2.5 * size + bounce - jump;
  const sink = Math.max(0, dy);      // sinking shortens the legs; rising takes them off the ground
  const blink = pose.asleep || (Date.now() + who.x * 97) % 3700 < 140;      // each figure blinks at its own moment
  const tall = 10 * u, shown = who.out ? 1 : 0;
  const origin = { x: who.x + lean, y: barH - 2 - tall + dy + (who.out ? 0 : tall), spring: { response: beat * 0.45, damping: 0.72 } };
  const c = (cells) => cells * u * wide;      // cells out from the centre line, narrowed side on
  const id = (name) => `${who.id}-${name}`;
  const arm = (name, side, lower) => part(id(name), side < 0 ? c(-6) - 2 * u : c(6), 3 * u + (lower ?? 0) * 3 * size, 2 * u, 2 * u, who.color, origin, wide < 1 ? 0 : shown);
  const apart = (pose.spread ?? 0) * size;
  const leg = (name, x, lifted, out) => part(id(name), c(x + out * apart), 8 * u, u, 2 * u - sink - (lifted ?? 0) * (2 * size + 0.5), who.color, origin, shown);
  // Eyes: both from the front, one near the leading edge side on, none from behind.
  const gaze = (pose.eyes ?? 0) * u * 0.6;
  const eye = (name, x, on) => part(id(name), x + gaze, 2 * u + (blink ? u : 0), u, blink ? 1 : 2 * u, canvas, origin, on ? shown : 0);
  const legs = pose.legs ?? [];
  // The cigarette sits in the right hand and goes where the arm goes: paper, then a glowing tip,
  // brighter on a drag. Puffs leave from beside the mouth, drift up and to the right, and fade.
  const smoke = [];
  if (who.smokes) {
    const lit = pose.cigarette ? 1 : 0, handY = 3 * u + (pose.armR ?? 0) * 3 * size + 0.6 * u, handX = c(6) + 2 * u;
    smoke.push(part(id("paper"), handX, handY, 3 * u, 0.6 * u, "#f1e9e0", origin, lit));
    smoke.push(part(id("tip"), handX + 3 * u, handY, 0.6 * u, 0.6 * u, pose.drag ? "#ffb26b" : "#e2571e", origin, lit));
    (pose.puffs ?? ["wait", "wait", "wait"]).forEach((state, k) => {
      const gone = state === "wait", x = origin.x + c(6) + 1.5 * u, y = origin.y + 2.5 * u;
      smoke.push(div().id(`dancer-${id(`puff-${k}`)}`).absolute().size(DOT_SMOKE).bg("#b9b2ac")
        .left(gone ? x : x + 5 + 3 * k).top(gone ? y : y - 20).opacity(state === "out" ? 0.6 : 0)
        // Leaving takes 2 s; going back to the mouth, unseen, takes none.
        .transition("left", { duration: gone ? 1 : 2000, easing: "ease-out" }).transition("top", { duration: gone ? 1 : 2000, easing: "ease-out" })
        .transition("opacity", { duration: state === "out" ? 150 : gone ? 1 : 1300, easing: "ease-out" }));
    });
  }
  return [
    ...smoke,
    part(id("body"), c(-6), 0, 12 * u * wide, 8 * u, who.color, origin, shown),
    arm("arm-left", -1, pose.armL), arm("arm-right", 1, pose.armR),
    leg("leg-1", -5, legs[0], -1), leg("leg-2", -3, legs[1], 0), leg("leg-3", 2, legs[2], 0), leg("leg-4", 4, legs[3], 1),
    eye("eye-left", turn === "right" ? c(3) : c(-4), turn === "front" || turn === "left"),
    eye("eye-right", turn === "left" ? c(-4) : c(3), turn === "front" || turn === "right"),
  ];
}

// `right` is the x the first figure's space ends at, `left` the x nothing may be drawn before
// (the tabs' edge), and `canvas` the bar's own color (the eyes).
export function dancers(eq, right, left, barH, canvas) {
  gather(eq);
  const { steps, hops } = move(eq), danced = eq.steps - now.since;
  // A friend is one step behind the figure to its right, and every other one mirrors the move.
  const poseFor = (k) => { const p = steps[(((danced - k) % steps.length) + steps.length) % steps.length]; return k % 2 ? mirrored(p) : p; };
  // On a break the first figure stays: standing still, then sitting with a cigarette (the right arm
  // lifts it for a drag), then dozing.
  const r = rest(eq);
  const resting = r && { still: true, sit: r.stage !== "stand", asleep: r.stage === "doze", cigarette: r.stage === "smoke",
    drag: r.drag, armR: r.stage === "smoke" ? (r.drag ? -1.5 : 0.4) : 0, puffs: r.puffs };
  const all = [{ id: "lead", x: right - DANCER_WIDTH / 2, cell: CELL, color: "#d97757", smokes: true, out: (eq.live || Boolean(r)) && right - DANCER_WIDTH > left }];
  FRIENDS.forEach((f, k) => {
    const x = right - DANCER_WIDTH - 22 - k * FRIEND_GAP;
    all.push({ id: `friend-${k}`, x, ...f, out: eq.live && k < friends && x - 8 * f.cell - 6 > left });
  });
  return all.flatMap((who, k) => figure(eq, who, k === 0 && resting ? resting : poseFor(k), hops, barH, canvas));
}
