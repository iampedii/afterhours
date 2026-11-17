import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";

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

// The icon rail's hover cards, after BeUI's popover: a small rounded-xl bordered surface that opens
// beside the button the pointer rests on, saying what it is.
function railCard(t, title, sub) {
  return div().pl(10).child(     // the gap to the rail is part of the card, so the pointer can cross it
    v_flex().max_w(280).px(14).py(9).gap(1).rounded(12).border(1).border_color(t.input).bg(t.popover).shadow_lg()
      .child(div().truncate().text_size(13).font_weight(600).text_color(t.foreground).child(title))
      .when(Boolean(sub), (el) => el.child(div().truncate().text_size(11.5).text_color(t.muted).child(sub))));
}
const hoverCard = (id, trigger, card) => HoverCard.new(id).anchor("left_center").open_delay(140).close_delay(160).trigger(trigger).content(card);

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
// animated-sidebar glides between the two: the width eases over a dozen frames.
function toggleSidebar(_e, cx) {
  const from = find(layout(), "sidebar")?.size?.px ?? 268;
  const collapsing = !narrow();
  if (collapsing) setShared("sidebar.width", from);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", collapsing);
  const to = collapsing ? (window()?.platform === "macos" ? 76 : 44) : (shared("sidebar.width") ?? 268);
  if (!cx?.timer) { run("layout.resize", { id: "sidebar", px: to }); return; }
  const steps = 12;
  let i = 0;
  const step = (cx) => {
    i += 1;
    const eased = 1 - Math.pow(1 - i / steps, 3);     // ease-out
    run("layout.resize", { id: "sidebar", px: Math.round(from + (to - from) * eased) });
    if (i < steps) cx.timer.after(16, step);
  };
  step(cx);
}

export default class WorkspaceChrome extends View {
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(14).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(32).px(10).gap(10).items_center().rounded(12)
        .when(collapsed, el => el.relative().w(40).h(40).px(0).justify_center())
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(svg(`mods/afterhours-workspace-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      const ready = div().size(6).rounded_full().bg(t.accent);
      // On the rail each button says what it is in a hover card.
      const tip = (id, title, sub, el) => (collapsed ? hoverCard(id, el, railCard(t, title, sub)) : el);
      return v_flex().size_full().border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
        .when(collapsed, el => el.px(0).items_center())
        .child(tip("settings-card", "Settings", updates().app.ready ? "An update is ready to install" : "Theme, fonts, sounds, machines",
          row("settings", "settings", "Settings", false, () => run("app.settings"))
            .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready))))
        .child(tip("machine-card", "Add machine", "Run spaces on another computer",
          row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" }))));
    }
    return h_flex().size_full().pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).rounded(6)).child(div().font_weight(600).text_color(t.foreground).child("Herdr"))))
      // BeUI's "Search ⌘K" pill.
      .when(!collapsed, el => el.child(h_flex().id("search").h(28).pl(9).pr(6).gap(6).flex_none().items_center().rounded(14)
        .border(1).border_color(t.border).bg(t.hover).text_size(12).text_color(t.muted).cursor_pointer()
        .hover(s => s.border_color(t.input).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(() => run("mod.open", { name: "picker" }))
        .child(svg("mods/afterhours-workspace-chrome/search.svg").size(13))
        .child(div().px(5).h(18).flex().items_center().rounded(5).border(1).border_color(t.border).font_family("Geist Mono").text_size(10.5).child("\u2318P"))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/afterhours-workspace-chrome/sidebar.svg").size(15), toggleSidebar)));
  }
}
