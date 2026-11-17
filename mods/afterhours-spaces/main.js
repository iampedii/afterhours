// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, HoverCard } from "gpui-base";
import { spaces, machines, panes, agents, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";

const ASCII_LINE = ["|", "/", "-", "\\"];   // BeUI loader "ascii-line", as in the pane title

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 30 : 36);   // BeUI rows: min-h-9
const RAIL_CELL = 40;   // animated-sidebar's rail buttons are size-10
// The chats under a space (animated-sidebar's sub menu): heights the shared highlight is placed by.
const CHAT_H = 32, SUB_MT = 2, SUB_MB = 6, SUB_GAP = 2, SUB_X = 32, LIST_GAP = 2;
// A space's name and its git tail never shrink below this, so a short one ("api")
// stays readable instead of turning into an ellipsis next to a long branch.
const SIDE_MIN = 48;
const railCell = (el) => h_flex().flex_none().justify_center().mb(4).child(el);

// The icon rail's hover cards, after BeUI's popover: a rounded-xl bordered surface that opens beside
// the button the pointer rests on. `rows` (optional) make it a menu: [{ id, icon, label, on, right, click }].
const CARD_ANCHOR = "left_center";   // the card's left edge meets the button's right, centred on it
function railCard(t, title, sub, rows = []) {
  const accent = t.accent.slice(0, 7);
  return div().pl(10).child(     // the gap to the rail is part of the card, so the pointer can cross it
    v_flex().min_w(rows.length ? 232 : 0).max_w(280).p(6).gap(2).rounded(12).border(1).border_color(t.input).bg(t.popover).shadow_lg()
      .child(v_flex().px(8).py(5).gap(1)
        .child(div().truncate().text_size(13).font_weight(600).text_color(t.foreground).child(title))
        .when(Boolean(sub), (el) => el.child(div().truncate().text_size(11.5).text_color(t.muted).child(sub))))
      .when(rows.length > 0, (el) => el.child(div().mx(2).my(2).h(1).bg(t.border))
        .children(rows.map((r) => h_flex().id(r.id).h(30).px(8).gap(9).items_center().rounded(8).text_size(12.5)
          .text_color(r.on ? t.foreground : t.muted).cursor_pointer()
          .when(r.on, (row) => row.bg(`${accent}12`))
          .when(!r.on, (row) => row.hover((x) => x.bg("#ffffff0d").text_color(t.foreground)))
          .on_click((_e, cx) => { cx.stop_propagation(); r.click(); })
          .child(h_flex().size(18).flex_none().items_center().justify_center().child(r.icon))
          .child(div().flex_1().min_w(0).truncate().font_weight(r.on ? 500 : 400).child(r.label))
          .when(Boolean(r.right), (row) => row.child(r.right))))));
}
const hoverCard = (id, trigger, card) => HoverCard.new(id).anchor(CARD_ANCHOR).open_delay(140).close_delay(160).trigger(trigger).content(card);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Places looked at together (two git runs each). All at once, a few hundred spaces
// run out of the app's open files (256 when started from the Dock on macOS) or
// past a machine core's 16 running execs, and those spaces wait for FALLBACK.
const AT_ONCE = 6;

// Both runs, finished: a place isn't done while one of its runs still holds a slot.
async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map((d) => d.value);
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Map(); // local repos' pending folder watches
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.scroll = ScrollHandle.new(); // the list's position: the active space is brought into view through it
    this.activeAt = -1; // the active space's place among the list's children (headers and rows), -1 when not drawn
    this.machines = [];
    try {
      this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
      if (!this.reconnecting || typeof this.reconnecting !== "object" || Array.isArray(this.reconnecting)) this.reconnecting = {};
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch { this.reconnecting = {}; }
    try { this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]")); } catch { this.folded = new Set(); }
    try { this.chatsFolded = new Set(JSON.parse(localStorage.getItem("chats.folded") ?? "[]")); } catch { this.chatsFolded = new Set(); }
    this.hoverRow = null;
    // animated-sidebar's hover (shared-layout-bg): one soft pill that glides to whichever row
    // the pointer is on and fades out when it leaves.
    this.pos = new Map();    // row key ("s:<space>" or "c:<tab>") -> { top, left, h }, in the plain list
    this.hoverKey = null;
    this.hoverAt = null;     // where the pill last was: it fades out in place
    this.hoverEnd = 0;
    this.hoverJump = false;  // appear at the row (after a pause) instead of gliding from the old spot
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
    }
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
      }
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    this.highlight = null;   // only the plain list (one machine) places the gliding highlight
    this.pos = new Map();
    const rows = this.ordered();
    // On the rail a space and its worktrees stack into one button; its hover card lists them.
    const kidsOf = new Map();
    if (collapsed) {
      let head = null;
      for (const r of rows) {
        if (r.tree && head && (r.w.machine ?? null) === head.machine) kidsOf.get(head.id).push(r);
        else { head = { id: r.w.id, machine: r.w.machine ?? null }; kidsOf.set(head.id, []); }
      }
    }
    const draw = (r) => !collapsed ? this.row(r, t)
      : kidsOf.has(r.w.id) ? this.compact(r, t, kidsOf.get(r.w.id)) : div().id(`space-${r.w.id}`);
    // Where the active space's row lands among the children this returns: the list scrolls by its direct
    // children, and machine headers, login notes and loading rows count too.
    this.activeAt = -1;
    let before = 0;
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) {
      if (loading(null) && !rows.length) return [loadingRow(null)];
      this.activeAt = rows.findIndex(r => r.w.active);
      // animated-sidebar's one active surface: it rests on the active chat (or on the space, when
      // its chats are folded) and springs between them. Rows have fixed heights, so add them up.
      this.highlight = null;
      if (!collapsed) {
        let y = 0;
        for (const r of rows) {
          const tabs = r.w.tabs ?? [];
          const open = tabs.length > 0 && !this.chatsFolded.has(r.w.id);
          const headH = rowHeight({ tree: r.tree });
          this.pos.set(`s:${r.w.id}`, { top: y, left: 0, h: headH });
          if (open) tabs.forEach((tab, k) => this.pos.set(`c:${tab.id}`, { top: y + headH + SUB_MT + k * (CHAT_H + SUB_GAP), left: SUB_X, h: CHAT_H }));
          if (r.w.active) {
            const k = tabs.findIndex(tab => tab.active);
            this.highlight = open && k >= 0
              ? { top: y + headH + SUB_MT + k * (CHAT_H + SUB_GAP), left: SUB_X, h: CHAT_H }
              : { top: y, left: 0, h: headH };
          }
          y += headH + (open ? SUB_MT + tabs.length * CHAT_H + (tabs.length - 1) * SUB_GAP + SUB_MB : 0) + LIST_GAP;
        }
      }
      return rows.map(draw);
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(machine?.keeps_running_after_logout === false, el => el.child(div().id(`machine-logout-${m}`)
          .flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); }).child("⚠")))
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) { before += 1; return [head]; }
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const items = [cell(head), ...guidance, ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : cell(empty)])];
      const first = folded ? -1 : mine.findIndex(r => r.w.active);
      if (first >= 0) this.activeAt = before + 1 + guidance.length + first;
      before += items.length;
      return items;
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one. When the row is full, it
  // and the name both start from their text's width and give way in proportion.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_auto()
      .min_w(where ? SIDE_MIN : 0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  // The agents running in a space (or worktree), one logo per program, as BeUI's avatar-group:
  // overlapping round tiles; a working agent's tile gets a ring in the working color.
  agentLogos(w, t) {
    const byProgram = new Map();
    for (const a of agents()) {
      if (a.space !== w.id || !a.program?.icon) continue;
      const seen = byProgram.get(a.program.key);
      const rank = { blocked: 3, working: 2, done: 1 };
      if (!seen || (rank[a.status] ?? 0) > (rank[seen.status] ?? 0)) byProgram.set(a.program.key, a);
    }
    const list = [...byProgram.values()].slice(0, 3);
    if (!list.length) return null;
    return h_flex().flex_none().items_center().children(list.map((a, k) => {
      const ring = a.status === "blocked" ? t.blocked : a.status === "working" ? t.working : t.chrome;
      const logo = a.program.tint ? svg(a.program.icon).size(12).text_color(t.foreground) : image(a.program.icon).size(12);
      return div().id(`space-agent-${w.id}-${a.program.key}`).size(20).rounded(10).flex().items_center().justify_center()
        .when(k > 0, el => el.ml(-6)).bg(a.program.tile ?? t.raised).border(1.5).border_color(ring)
        .tooltip(`${a.program.name} \u00b7 ${a.status}`).child(logo);
    }));
  }

  // A tab's chat name: an agent's live title (as the tab bar shows it), else the tab's name.
  chatName(tab, lead) {
    const clean = (x) => (x ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();
    const prog = lead?.program?.name;
    const base = tab.named ? tab.name : prog ?? "Terminal";
    if (!lead?.program?.agent) return base;
    const live = clean(lead.title);
    const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
    const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
    return (tab.name === prog || !tab.named) && telling ? live : base;
  }

  setHover(key, on, cx) {
    if (on) { this.hoverJump = !this.hoverKey && Date.now() - this.hoverEnd > 200; this.hoverKey = key; }
    else if (this.hoverKey === key) { this.hoverKey = null; this.hoverEnd = Date.now(); }
    cx.notify();
  }

  // BeUI ai-sidebar's nested items: a guide line on the left, 32 px rounded rows, the agent's logo,
  // the chat's name and its state on the right. Click opens that tab.
  chats(w, t) {
    const all = panes();
    const rows = (w.tabs ?? []).map((tab) => {
      const lead = all.find(p => p.tab === tab.id && p.program?.agent) ?? all.find(p => p.tab === tab.id);
      const program = lead?.program;
      const on = w.active && tab.active;
      const st = tab.status;
      const logo = program?.icon
        ? (program.tint ? svg(program.icon).size(14).flex_none().text_color(on ? t.foreground : t.muted) : image(program.icon).size(14).flex_none())
        : div().size(14).flex_none().flex().items_center().justify_center().child(div().size(4).rounded(2).bg(t.dim));
      const state = st === "working"
        ? div().flex_none().w(9).font_family("Geist Mono").font_weight(600).text_size(10).text_color(t.working).frames(ASCII_LINE, 110).child("|")
        : st === "blocked" ? div().size(6).rounded(3).flex_none().bg(t.blocked).loop("opacity", { from: 0.3, to: 1, period: 1200 })
        : st === "done" ? div().size(6).rounded(3).flex_none().bg(t.done)
        : null;
      // animated-sidebar sub button: min-h-8 rounded-lg px-2 text-xs; active gets the shared highlight.
      return h_flex().id(`chat-${tab.id}`).h(CHAT_H).px(8).gap(9).flex_none().items_center().rounded(10)
        .text_size(12.5).text_color(on ? t.foreground : t.muted)
        .when(!on, el => el.hover(s => s.text_color(t.foreground)))
        .on_hover((h, cx) => this.setHover(`c:${tab.id}`, h, cx))
        .cursor_pointer()
        .on_click(() => { if (!w.active) run("space.select", { id: w.id }); run("tab.select", { id: tab.id }); })
        .child(logo)
        .child(div().flex_1().min_w(0).truncate().font_weight(on ? 500 : 400).child(this.chatName(tab, lead)))
        .when(Boolean(state), el => el.child(state));
    });
    return v_flex().ml(21).pl(10).mt(SUB_MT).mb(SUB_MB).gap(SUB_GAP).border_l(1).border_color(t.border).children(rows);
  }

  row({ w, i, g, tree }, t) {
    const on = w.active;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    const tabs = w.tabs ?? [];
    const open = tabs.length > 0 && !this.chatsFolded.has(w.id);
    const hovered = this.hoverRow === w.id;
    const stopPress = (_e, cx) => cx.stop_propagation();
    const head = v_flex()
      .relative()
      .id(`space-${w.id}`)
      .on_hover((h, cx) => { if (h) this.hoverRow = w.id; else if (this.hoverRow === w.id) this.hoverRow = null; this.setHover(`s:${w.id}`, h, cx); })
      .px(10)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(12)
      // Where the pill can't be placed (machine groups), a plain hover tint stands in.
      .when(!this.pos.size, (el) => el.hover((s) => s.bg("#ffffff0a")))
      .when(!on, (el) => el.hover((s) => s.text_color(t.foreground)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(10)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim)))
          // BeUI tile: the space's color as a soft tint, its letter in the color.
          .when(!tree, el => el.child(h_flex().size(22).flex_none().rounded(7).bg(`${fill.slice(0, 7)}29`).border(1).border_color(`${fill.slice(0, 7)}33`)
            .items_center().justify_center().text_size(11).font_weight(600).text_color(fill).child([...w.name][0]?.toUpperCase() ?? "?")))
          .when(Boolean(this.agentLogos(w, t)), el => el.child(this.agentLogos(w, t)))
          .child(div().flex_initial().min_w(SIDE_MIN).truncate().font_weight(on ? 500 : 400).text_color(on ? t.foreground : t.muted).child(w.name))
          .child(g && !hovered ? this.gitTail(g, tree, w.name, t) : div().flex_1())
          // ai-sidebar's row actions: "…" appears on hover; the chevron folds the chats.
          .when(hovered, el => el.child(div().id(`space-more-${w.id}`).size(24).flex_none().rounded(8).flex().items_center().justify_center()
            .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_mouse_down("left", stopPress).on_click((_e, cx) => { cx.stop_propagation(); this.menu(w); })
            .child(svg("mods/afterhours-spaces/more.svg").size(14))))
          .when(tabs.length > 1 && !hovered, el => el.child(div().flex_none().font_family("Geist Mono").text_size(11).text_color(t.dim).child(String(tabs.length))))
          .when(tabs.length > 0, el => el.child(div().id(`space-fold-${w.id}`).size(20).flex_none().rounded(6).flex().items_center().justify_center()
            .text_color(t.dim).hover(s => s.text_color(t.foreground))
            .on_mouse_down("left", stopPress)
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.chatsFolded.has(w.id) ? this.chatsFolded.delete(w.id) : this.chatsFolded.add(w.id);
              localStorage.setItem("chats.folded", JSON.stringify([...this.chatsFolded]));
              cx.notify();
            })
            // The chevron turns: the two directions cross-fade (Herdr can't rotate natively).
            .child(div().relative().size(12)
              .child(svg("mods/workspace-chrome/chevron-right.svg").absolute().top(0).left(0).size(12).opacity(open ? 0 : 1).transition("opacity", { duration: 180, easing: "ease-out" }))
              .child(svg("mods/workspace-chrome/chevron-down.svg").absolute().top(0).left(0).size(12).opacity(open ? 1 : 0).transition("opacity", { duration: 180, easing: "ease-out" }))))),
      );
    // animated-sidebar's sub menu: the chats fold open and shut with a spring and fade as they go.
    const full = SUB_MT + tabs.length * CHAT_H + Math.max(0, tabs.length - 1) * SUB_GAP + SUB_MB;
    return v_flex().flex_none().child(head).when(tabs.length > 0, el => el.child(
      div().id(`chats-${w.id}`).flex_none().overflow_hidden().h(open ? full : 0).opacity(open ? 1 : 0)
        .spring("height", { response: 300, damping: 0.86 })
        .transition("opacity", { duration: open ? 220 : 120, easing: "ease-out" })
        .child(this.chats(w, t))));
  }

  // The icon rail (animated-sidebar's collapsed state): each space is a 40 px rounded button holding
  // its tinted letter tile, with a status dot on the tile's corner. A space with worktrees is one
  // button for the whole stack, with a count. Resting the pointer on a button opens its card: the
  // stack's spaces to pick from, or else the space's chats.
  tile(w, size, t, tree = false) {
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return tree
      ? h_flex().size(size).items_center().justify_center().child(svg("mods/workspace-chrome/branch.svg").size(Math.round(size * 0.55)).text_color(t.muted))
      : h_flex().size(size).rounded(Math.round(size * 0.3)).bg(`${fill.slice(0, 7)}29`).border(1).border_color(`${fill.slice(0, 7)}33`)
          .items_center().justify_center().text_size(Math.round(size * 0.46)).font_weight(600).text_color(fill).child([...w.name][0]?.toUpperCase() ?? "?");
  }

  statusDot(status, t) {
    const c = status === "working" ? t.working : status === "blocked" ? t.blocked : status === "done" ? t.done : null;
    return c ? div().size(6).rounded(3).flex_none().bg(c).when(status !== "done", (d) => d.loop("opacity", { from: 0.35, to: 1, period: 1200 })) : null;
  }

  compact(r, t, kids = []) {
    const { w } = r;
    const stack = [r, ...kids];
    const on = stack.some((x) => x.w.active);
    const rank = { blocked: 3, working: 2, done: 1 };
    const status = stack.reduce((best, x) => ((rank[x.w.status] ?? 0) > (rank[best] ?? 0) ? x.w.status : best), null);
    const dot = this.statusDot(status, t);
    const all = panes();
    const rows = kids.length
      ? stack.map((x) => ({ id: `card-space-${x.w.id}`, icon: this.tile(x.w, 18, t, Boolean(x.tree)), label: x.w.name, on: x.w.active,
          right: this.statusDot(x.w.status, t), click: () => run("space.select", { id: x.w.id }) }))
      : (w.tabs ?? []).map((tab) => {
          const lead = all.find((p) => p.tab === tab.id && p.program?.agent) ?? all.find((p) => p.tab === tab.id);
          const program = lead?.program;
          return { id: `card-chat-${tab.id}`, label: this.chatName(tab, lead), on: w.active && tab.active, right: this.statusDot(tab.status, t),
            icon: program?.icon ? (program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)) : div().size(4).rounded(2).bg(t.dim),
            click: () => { if (!w.active) run("space.select", { id: w.id }); run("tab.select", { id: tab.id }); } };
        });
    const chats = (w.tabs ?? []).length;
    const sub = kids.length ? `${kids.length} worktree${kids.length > 1 ? "s" : ""}` : [r.g?.branch, `${chats} chat${chats === 1 ? "" : "s"}`].filter(Boolean).join(" \u00b7 ");
    const button = h_flex()
      .id(`space-${w.id}`)
      .relative()
      .size(RAIL_CELL)
      .rounded(12)
      .justify_center()
      .items_center()
      .border(1)
      .border_color(on ? `${t.accent.slice(0, 7)}2b` : "#00000000")
      .when(on, (el) => el.bg(`${t.accent.slice(0, 7)}12`))
      .when(!on, (el) => el.hover((s) => s.bg("#ffffff0d")))
      .cursor_pointer()
      .on_click(() => run("space.select", { id: w.id }))
      .child(this.tile(w, 26, t, Boolean(r.tree)))
      .when(Boolean(dot), (el) => el.child(div().absolute().right(3).bottom(3).size(10).rounded(5).bg(t.chrome).flex().items_center().justify_center().child(dot)))
      .when(kids.length > 0, (el) => el.child(h_flex().absolute().right(1).top(1).h(13).px(3.5).rounded(7).bg(t.raised).border(1).border_color(t.input)
        .items_center().font_family("Geist Mono").text_size(8.5).text_color(t.muted).child(String(stack.length))));
    return railCell(hoverCard(`space-card-${w.id}`, button, railCard(t, w.name, sub, rows)));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    const list = this.grouped(t, collapsed);
    // Bring the active space into view when it, or its place in the list, changes; a row already in view stays put.
    const active = sp.find(p => p.active)?.id;
    if (active !== this.revealed || this.activeAt !== this.revealedAt) {
      this.revealed = active;
      this.revealedAt = this.activeAt;
      if (this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
    // The hover pill: under the rows, not shown on the row the active highlight already marks.
    const over = this.hoverKey ? this.pos.get(this.hoverKey) : null;
    if (over) this.hoverAt = over;
    const at = this.hoverAt, hl = this.highlight;
    const show = Boolean(over) && !(hl && hl.top === over.top && hl.left === over.left);
    let pill = null;
    if (at && this.pos.size) {
      pill = div().id("hover-pill").absolute().top(at.top).left(8 + at.left).right(8).h(at.h).rounded(at.left ? 10 : 12).bg("#ffffff0d")
        .opacity(show ? 1 : 0).transition("opacity", { duration: show ? 140 : 200, easing: "ease-out" });
      if (!this.hoverJump) pill = pill.spring("top", { response: 260, damping: 0.85 }).spring("left", { response: 260, damping: 0.85 }).spring("height", { response: 260, damping: 0.85 });
    }
    return v_flex().size_full().min_h(0).text_size(13)
      .child(h_flex().h(36).pl(18).pr(10).items_center().justify_between().text_size(10.5).font_weight(500).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("SPACES"))
        .child(((plus) => collapsed ? hoverCard("space-new-card", plus, railCard(t, "New space", "Start a space on this computer")) : plus)(
          div().id("space-new").size(28).flex_none().flex().items_center().justify_center().rounded(14).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14)))))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).gap(collapsed ? 0 : LIST_GAP).relative().overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        // A block above (another mod's) growing, or the window resizing, shrinks this list and can push the active space out.
        .on_size_change((_size, cx) => { if (this.activeAt >= 0) { this.scroll.scroll_to_item(this.activeAt); cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .when(Boolean(pill), el => el.child(pill))
        .when(Boolean(this.highlight), el => el.child(div().absolute().top(this.highlight.top).left(8 + this.highlight.left).right(8).h(this.highlight.h)
          .rounded(this.highlight.left ? 10 : 12).bg(`${t.accent.slice(0, 7)}12`).border(1).border_color(`${t.accent.slice(0, 7)}2b`)
          .spring("top", { response: 340, damping: 0.8 }).spring("left", { response: 340, damping: 0.8 }).spring("height", { response: 340, damping: 0.8 })))
        .children(list));
  }
}
