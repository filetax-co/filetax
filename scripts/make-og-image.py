"""Generates public/og-default.png, the 1200x630 fallback social share card.

Run manually when the wording or brand colours change:
    python scripts/make-og-image.py

Not part of the build — the output is committed so builds stay dependency-free.
"""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (11, 18, 26)
TEXT = (255, 255, 255)
MUTED = (148, 168, 186)
BLUE = (2, 132, 199)
RED = (179, 29, 29)

FONT_DIR = r"C:\Windows\Fonts"


def font(name, size):
    for candidate in (name, "segoeuib.ttf", "arialbd.ttf", "arial.ttf"):
        path = os.path.join(FONT_DIR, candidate)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# Top accent rule, echoing the site's red IRS warning bar.
d.rectangle([0, 0, W, 10], fill=RED)

d.text((72, 96), "FileTax.co", font=font("segoeuib.ttf", 40), fill=BLUE)

d.text((72, 190), "Missed Form 5472?", font=font("segoeuib.ttf", 82), fill=TEXT)
d.text((72, 288), "Fix it before the IRS notices.", font=font("segoeuib.ttf", 82), fill=TEXT)

d.text(
    (72, 416),
    "Form 5472 + Pro Forma 1120 for foreign-owned U.S. LLCs.",
    font=font("segoeui.ttf", 34),
    fill=MUTED,
)
d.text(
    (72, 466),
    "Past-year catch-up filing with a reasonable cause letter.",
    font=font("segoeui.ttf", 34),
    fill=MUTED,
)

# Penalty pill, bottom left.
pill = "$25,000 penalty per missed form, per year"
f = font("segoeuib.ttf", 27)
tw = d.textlength(pill, font=f)
d.rounded_rectangle([72, 536, 72 + tw + 56, 596], radius=30, fill=(40, 16, 16), outline=RED, width=2)
d.text((100, 552), pill, font=f, fill=(240, 140, 140))

out = os.path.join(os.path.dirname(__file__), "..", "public", "og-default.png")
img.save(os.path.abspath(out), optimize=True)
print("wrote", os.path.abspath(out), os.path.getsize(os.path.abspath(out)), "bytes")
