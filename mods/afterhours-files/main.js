// The Files panel as BeUI's file tree (beui.dev/components/motion/file-tree): 36 px rounded rows,
// 18 px of indent per level, a chevron and a 16 px icon before each name, muted names that
// brighten under the pointer, and one soft pill that glides between the rows the pointer crosses.
// A folder opens with a spring: its rows fade in one after another, and a guide line draws down
// its left side as it grows. The file last opened keeps a filled row.
// Still Herdr's lazy file browser underneath: the focused pane's folder, git marks, and bounded
// read-only previews.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window } from "herdr";

const ROW = 36, INDENT = 18, PAD = 6;
const GROW = { response: 300, damping: 0.86 };      // a folder opening and closing
const GLIDE = { response: 260, damping: 0.85 };     // the hover pill
// File icons take a tone by family, as the component's demo does: code sky, markup violet, data amber.
const SKY = "#0ea5e9", VIOLET = "#8b5cf6", AMBER = "#f59e0b";
const TONES = {};
for (const e of "ts tsx js jsx mjs cjs go py rs swift java kt c cc cpp h hpp rb php sh zsh lua sql".split(" ")) TONES[e] = SKY;
for (const e of "css scss less html htm vue svelte astro xml svg".split(" ")) TONES[e] = VIOLET;
for (const e of "json jsonc yaml yml toml lock env ini".split(" ")) TONES[e] = AMBER;
const tone = (name) => TONES[name.includes(".") ? name.split(".").pop().toLowerCase() : ""];

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.closing = new Set();     // folders springing shut: their rows stay until they are gone
    this.reveal = new Map();      // path -> when a new row fades in
    this.picked = null;           // the file last opened
    this.hoverKey = null; this.hoverAt = 0; this.hoverEnd = 0; this.hoverJump = false;
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.closing = new Set(); this.reveal = new Map(); this.picked = saved?.file ?? null; this.hoverKey = null;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    const first = !this.entries.has("");
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        if (first && this.current(context)) this.stagger("", cx);
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  // New rows start unseen and come in one after another, 25 ms apart (the fifth and later together).
  stagger(path, cx) {
    const now = Date.now(), rows = this.entries.get(path) ?? [];
    try {
      rows.forEach((e, i) => this.reveal.set(path ? `${path}/${e.name}` : e.name, now + 40 + Math.min(i, 4) * 25));
      for (let k = 0; k < 5; k += 1) cx.timer.after(50 + k * 25, cx => cx.notify());
      cx.timer.after(700, () => { const t = Date.now(); for (const [p, at] of this.reveal) if (at < t) this.reveal.delete(p); });
    } catch { this.reveal.clear(); }
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      const shut = [...this.folders].filter(f => f === path || f.startsWith(path + "/"));
      for (const folder of shut) { this.folders.delete(folder); this.closing.add(folder); }
      cx.timer.after(340, cx => {
        for (const folder of shut) if (!this.folders.has(folder)) { this.entries.delete(folder); this.closing.delete(folder); }
        cx.notify();
      });
    } else {
      this.folders.add(path);
      this.closing.delete(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); if (this.current(context)) this.stagger(path, cx); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  setHover(path, on, cx) {
    if (on) { this.hoverJump = !this.hoverKey && Date.now() - this.hoverEnd > 200; this.hoverKey = path; }
    else if (this.hoverKey === path) { this.hoverKey = null; this.hoverEnd = Date.now(); }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (path) this.picked = path;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  // Rows showing under a folder: what its box grows to.
  count(prefix, depth = 0) {
    let n = 0;
    if (depth > 40) return n;
    for (const entry of this.entries.get(prefix) ?? []) {
      n += 1;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.dir && this.folders.has(path)) n += this.count(path, depth + 1);
    }
    return n;
  }

  // `seen`: { n, at } counts the rows on screen and notes where each is, for the pill. Rows of a
  // folder that is closing are drawn but not counted.
  rows(prefix, depth, t, seen, live = true) {
    const out = [];
    if (depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (seen.n >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      if (live) { seen.at.set(path, seen.n); seen.n += 1; }
      const picked = !entry.dir && this.picked === path, lit = picked || this.hoverKey === path;
      const waiting = (this.reveal.get(path) ?? 0) > Date.now();
      const fade = { duration: 220, easing: "ease-out" };
      const chevron = (name, show) => div().id(`fc-${name}-${path}`).absolute().top(0).left(0).opacity(show ? 1 : 0).transition("opacity", 150)
        .child(svg(`mods/afterhours-files/chevron-${name}.svg`).size(14).text_color(t.dim));
      const icon = (name, show, color) => div().id(`fi-${name}-${path}`).absolute().top(0).left(0).opacity(show ? 1 : 0).transition("opacity", 150)
        .child(svg(`mods/afterhours-files/${name}.svg`).size(16).text_color(color));
      out.push(h_flex().id(`file-${path}`).h(ROW).flex_none().relative().top(waiting ? -6 : 0).pl(8 + depth * INDENT).pr(10).gap(8).items_center().rounded(8).cursor_pointer()
        .opacity(waiting ? 0 : 1).transition("opacity", fade).transition("top", fade)
        .text_color(lit ? t.foreground : t.muted)
        .when(picked, el => el.bg(t.selected).font_weight(500))
        .on_hover((h, cx) => this.setHover(path, h, cx))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? div().relative().size(14).flex_none().child(chevron("right", !open)).child(chevron("down", open)) : div().w(14).flex_none())
        .child(entry.dir
          ? div().relative().size(16).flex_none().child(icon("folder", !open, t.muted)).child(icon("folder-open", open, t.foreground))
          : svg("mods/afterhours-files/file.svg").size(16).flex_none().text_color(tone(entry.name) ?? t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().flex_none().font_family("Geist Mono").text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir) {
        const shown = open || this.closing.has(path);
        // Always there, 0 high while shut, so opening is a change the spring can follow.
        out.push(v_flex().id(`kids-${path}`).relative().flex_none().overflow_hidden().h(open && live ? this.count(path, depth + 1) * ROW : 0).spring("height", GROW)
          .when(shown, el => el
            .child(div().absolute().top(0).bottom(0).left(8 + depth * INDENT + 7).w(1).bg(t.border))
            .children(this.rows(path, depth + 1, t, seen, live && open))));
      }
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme();
    const seen = { n: 0, at: new Map() }, list = this.file ? [] : this.rows("", 0, t, seen);
    // The hover pill: one soft surface under the rows that glides to the row the pointer is on and
    // fades out in place when it leaves. Not shown on the picked row, which is already filled.
    const over = this.hoverKey !== null && seen.at.has(this.hoverKey) ? seen.at.get(this.hoverKey) : null;
    if (over !== null) this.hoverAt = over;
    const show = over !== null && this.hoverKey !== this.picked;
    let pill = div().id("files-pill").absolute().top(PAD + this.hoverAt * ROW).left(PAD).right(PAD).h(ROW).rounded(8).bg(t.selected.slice(0, 7) + "cc")
      .opacity(show ? 1 : 0).transition("opacity", { duration: show ? 140 : 200, easing: "ease-out" });
    if (!this.hoverJump) pill = pill.spring("top", GLIDE);
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13.5)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).relative().overflow_y_scrollbar().p(PAD).child(pill).children(list)
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
