import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys } from "herdr";

export default class WorkspaceStatus extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(16).gap(18).items_center().text_size(12).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(list.some(a => a.status === "working") ? t.working : t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(h_flex().ml(4).gap(5).px(8).h(18).items_center().rounded(9).border(1).border_color(t.blocked + "4d").bg(t.blocked + "1f").text_size(11).text_color(t.blocked)
          .child(div().size(5).rounded(3).bg(t.blocked).loop("opacity", { from: 0.3, to: 1, period: 1200 })).child(`${needs} needs you`))))
      .child(div().flex_1())
      .child(div().id("palette").px(7).h(18).flex().items_center().rounded(5).border(1).border_color(t.border).font_family("Geist Mono").text_size(11).text_color(t.dim)
        .hover(s => s.text_color(t.foreground).border_color(t.input)).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
