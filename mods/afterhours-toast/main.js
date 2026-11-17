// Notifications as BeUI's animated toast (beui.dev/components/animated-toast-stack):
// a rounded-2xl card with a tinted icon circle, title, two-line description and a
// round close button; it springs up from below and fades, and drops away on close.
//
// Herdr frames its toast overlay, so as the layout's toast this mod reopens itself as a
// frameless window in the bottom-right (placed from window.json's saved size) and closes
// the framed one. A new notification replaces the live one.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, run, theme, appHome, readTextFile, shared, setShared } from "herdr";

const W = 384;      // max-w-sm
const PAD = 16;
const DROP = 18;    // how far it rises as it enters

export default class AfterhoursToast extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (!p.card) {
      const height = (p.body ? 78 : 60) + PAD + DROP;
      readTextFile(`${appHome()}/window.json`).then((json) => {
        let w = 1440, h = 900;
        try { [, , w, h] = JSON.parse(json).bounds; } catch {}
        const live = shared("afterhours-toast.live");
        if (typeof live === "string") closeOverlay(live);
        const id = openOverlay({
          mod: "afterhours-toast", kind: "window", frame: "none",
          width: W + PAD + 12, height,
          at: { x: Math.max(0, w - W - PAD - 12), y: Math.max(0, h - height) },
          props: { card: true, title: p.title, body: p.body, level: p.level, icon: p.icon, action: p.action, timeout: p.timeout },
        });
        setShared("afterhours-toast.live", id);
        if (p.overlay) closeOverlay(p.overlay);
      });
      return;
    }
    this.open = false;
    cx.timer.after(30, (cx) => { this.open = true; cx.notify(); });
    const hold = p.timeout ?? (p.level === "error" ? 12000 : 6000);
    if (hold > 0) cx.timer.after(hold, (cx) => this.leave(cx));
  }

  leave(cx) {
    if (this.leaving) return;
    this.leaving = true;
    this.open = false;
    cx.notify();
    cx.timer.after(220, () => closeOverlay(props()?.overlay));
  }

  render() {
    const p = props() ?? {};
    if (!p.card) return div();
    const t = theme();
    const tone = { success: t.done, error: t.blocked, warning: "#f9a300", info: t.accent }[p.level] ?? t.foreground;
    const stop = (_e, cx) => cx.stop_propagation();
    const icon = p.icon
      ? image(p.icon).size(28).rounded(14).flex_none()
      : div().size(28).rounded(14).flex_none().flex().items_center().justify_center().bg(`${tone.slice(0, 7)}24`)
          .child(svg(`mods/afterhours-toast/icons/${["success", "error", "warning", "info"].includes(p.level) ? p.level : "bell"}.svg`).size(15).text_color(tone));

    return v_flex()
      .size_full()
      .justify_end()
      .items_end()
      .pr(PAD)
      .pb(PAD)
      .child(
        h_flex()
          .id("card")
          .relative()
          .w(W)
          .top(this.open ? 0 : DROP)
          .spring("top", { response: 360, damping: 0.74 })
          .opacity(this.open ? 1 : 0)
          .transition("opacity", { duration: this.open ? 200 : 160, easing: "ease-out" })
          .items_start()
          .gap(12)
          .p(12)
          .rounded(16)
          .border(1)
          .border_color(t.input)
          .bg(t.popover)
          .shadow_lg()
          .cursor_pointer()
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => {
            if (p.action?.name) run(p.action.name, p.action.args ?? {});
            this.leave(cx);
          })
          .child(icon)
          .child(
            v_flex().flex_1().min_w(0).pt(1)
              .child(div().truncate().text_size(14).font_weight(500).text_color(t.foreground).child(p.title ?? ""))
              .when(Boolean(p.body), (el) => el.child(div().mt(2).text_size(12).text_color(t.muted).max_h(32).overflow_hidden().child(p.body))),
          )
          .child(
            div().id("close").size(28).rounded(14).flex_none().flex().items_center().justify_center()
              .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_mouse_down("left", stop)
              .on_click((_e, cx) => { cx.stop_propagation(); this.leave(cx); })
              .child(svg("mods/afterhours-toast/icons/x.svg").size(14)),
          ),
      );
  }
}
