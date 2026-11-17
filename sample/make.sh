#!/bin/sh
# Builds the sample projects the preview was recorded in: nightshift-api (a tiny playlist service
# with uncommitted changes), record-store and synth-lab (one file each).
# Run from anywhere; it writes beside itself and replaces what is there.
set -e
cd "$(dirname "$0")"
here=$(pwd)
rm -rf nightshift-api record-store synth-lab
g() { git -c user.name="Sample" -c user.email="sample@example.com" "$@"; }

mkdir -p nightshift-api/src/routes nightshift-api/src/lib nightshift-api/test
cd nightshift-api
g init -q -b main
cat > README.md <<'E'
# nightshift-api

A tiny playlist service: queue tracks, vote them up, see what plays next.

    npm start        # listens on :4000
    npm test
E
cat > package.json <<'E'
{ "name": "nightshift-api", "version": "0.3.0", "type": "module",
  "scripts": { "start": "node src/server.js", "test": "node --test" } }
E
cat > src/server.js <<'E'
import { createServer } from "node:http";
import { queue } from "./lib/queue.js";
import { tracks } from "./routes/tracks.js";

const routes = { "/tracks": tracks(queue) };

createServer((req, res) => {
  const handler = routes[new URL(req.url, "http://x").pathname];
  if (!handler) return res.writeHead(404).end();
  handler(req, res);
}).listen(4000, () => console.log("nightshift on :4000"));
E
cat > src/lib/queue.js <<'E'
// Tracks waiting to play, most-voted first; ties keep the order they arrived in.
const items = [];

export const queue = {
  add(track) { items.push({ ...track, votes: 0, at: items.length }); return track; },
  vote(id) { const t = items.find((t) => t.id === id); if (t) t.votes += 1; return t; },
  next() { return [...items].sort((a, b) => b.votes - a.votes || a.at - b.at)[0] ?? null; },
  all() { return items; },
};
E
cat > src/routes/tracks.js <<'E'
export const tracks = (queue) => (req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ next: queue.next(), queue: queue.all() }));
};
E
cat > test/queue.test.js <<'E'
import test from "node:test";
import assert from "node:assert/strict";
import { queue } from "../src/lib/queue.js";

test("the most-voted track plays next", () => {
  queue.add({ id: "a", title: "Midnight City" });
  queue.add({ id: "b", title: "Nightcall" });
  queue.vote("b");
  assert.equal(queue.next().id, "b");
});
E
g add -A && g commit -qm "Queue tracks and pick the next one by votes"
printf '\nexport const skip = (queue) => queue.all().shift();\n' >> src/lib/queue.js
echo "- [ ] skip the current track" >> README.md

mkdir "$here/record-store" && cd "$here/record-store" && g init -q -b main
echo "# record-store" > README.md; echo 'print("crates")' > crates.py
g add -A && g commit -qm "Crates"

mkdir "$here/synth-lab" && cd "$here/synth-lab" && g init -q -b main
echo "# synth-lab" > README.md; echo 'fn main() { println!("saw"); }' > main.rs
g add -A && g commit -qm "Saw wave"
