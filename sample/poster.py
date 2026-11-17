"""Builds preview.png: the poster the gallery shows.

usage: poster.py sample/frames/dancing.png sample/frames/resting.png preview.png

Both frames are full-window `herdr-app shot`s at 2632x1650 of the sample scene (sample/make.sh):
one taken while music plays, one taken during the break. Needs ImageMagick 7 (`magick`), macOS fonts.
"""
import subprocess, sys, tempfile, os

dance, rest, out = sys.argv[1:4]
tmp = tempfile.mkdtemp()
p = lambda name: os.path.join(tmp, name)
run = lambda *a: subprocess.run(["magick", *map(str, a)], check=True)

HN = "/System/Library/Fonts/HelveticaNeue.ttc"
BOLD, REG, MED = HN, HN, HN
MONO = "/System/Library/Fonts/Menlo.ttc"
W, H = 2400, 1500
BG, CARD, LINE = "#0a0a0a", "#161616", "#ffffff1f"
INK, MUTED, EMBER, HOT = "#f5f5f5", "#868686", "#d2704a", "#e2875f"

# The pieces: the bar with music on, the figure on its break, the figure as a mark, the window.
run(dance, "-crop", "960x100+1160+13", "+repage", p("on.png"))
run(rest, "-crop", "300x100+1870+13", "+repage", p("off.png"))
run(dance, "-crop", "104x64+2000+42", "+repage", "-fuzz", "5%", "-transparent", "#161616", "-filter", "point", "-resize", "200%", p("mark.png"))
SW = 1800
run(dance, "-resize", f"{SW}x", p("shot0.png"))
sh = int(subprocess.check_output(["magick", "identify", "-format", "%h", p("shot0.png")]))
run(p("shot0.png"), "(", "-size", f"{SW}x{sh}", "xc:black", "-fill", "white",
    "-draw", f"roundrectangle 0,0 {SW - 1},{sh - 1} 24,24", ")",
    "-alpha", "off", "-compose", "CopyOpacity", "-composite", p("shot.png"))

a = ["-size", f"{W}x{H}", f"xc:{BG}"]
# Two soft terracotta glows: bottom left, and behind the window.
a += ["(", "-size", "1800x1800", "radial-gradient:#d2704a66-#d2704a00", ")", "-geometry", "-900+600", "-compose", "over", "-composite"]
a += ["(", "-size", "1600x1600", "radial-gradient:#d2704a2e-#d2704a00", ")", "-geometry", "+1300-500", "-composite"]

def text(font, color, size, x, y, s, kerning=0):
    return ["-font", font, "-fill", color, "-pointsize", size, "-kerning", kerning, "-annotate", f"+{x}+{y}", s, "-kerning", 0]

# Left column.
a += [p("mark.png"), "-geometry", "+96+104", "-composite"]
a += text(BOLD, INK, 172, 102, 436, "Afterhours")
a += text(MED, HOT, 62, 112, 536, "Moves with your music.")
a += ["-fill", LINE, "-draw", "rectangle 112,604 800,605"]
rows = [("A live equaliser in the tab bar", "bass in the centre, treble at the ends"),
        ("Particles on the beat", "their arcs trace the tune"),
        ("A dancer with 21 moves", "friends join when the song builds"),
        ("A smoke break", "when you pause the music"),
        ("Agents at a glance", "needs you, working, done, idle")]
for i, (title, sub) in enumerate(rows):
    y = 712 + i * 148
    a += ["-fill", EMBER, "-draw", f"circle 124,{y - 15} 134,{y - 15}"]
    a += text(MED, INK, 43, 166, y, title)
    a += text(REG, MUTED, 31, 166, y + 48, sub)

# Right column: two cards with the bar close up, then the window running off the edge.
def card(x, y, w, h, label, strip, sw):
    c = ["-fill", CARD, "-stroke", LINE, "-strokewidth", 2, "-draw", f"roundrectangle {x},{y} {x + w},{y + h} 22,22", "-stroke", "none"]
    c += text(MONO, HOT, 22, x + 28, y + 46, label, 4)
    c += [strip, "-geometry", f"+{x + (w - sw) // 2}+{y + 64}", "-composite"]
    return c
X = 940
a += card(X, 118, 1010, 200, "MUSIC ON", p("on.png"), 960)
a += card(X + 1034, 118, 366, 200, "PAUSED", p("off.png"), 300)
a += ["(", p("shot.png"), "(", "+clone", "-background", "black", "-shadow", "70x40+0+24", ")", "+swap",
      "-background", "none", "-layers", "merge", "+repage", ")", "-geometry", f"+{X - 80}+{372 - 56}", "-composite"]
a += ["-fill", "none", "-stroke", "#ffffff2e", "-strokewidth", 2, "-draw", f"roundrectangle {X},{372} {X + SW},{372 + sh} 24,24"]
a += ["-depth", 8, out]
run(*a)
print(out)
