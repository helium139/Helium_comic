"""Export app icons from the existing lossless logo; preserve its aspect ratio."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets/icons"
BACKGROUND = "#ffe1f7"


def build():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    logo = Image.open(ROOT / "assets/favicon-32x32.png").convert("RGBA")
    for filename, size in [("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)]:
        # Transparent padding in the source is retained; never crop or stretch.
        fitted = ImageOps.contain(logo, (size, size), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (size, size), BACKGROUND)
        canvas.alpha_composite(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
        canvas.convert("RGB").save(OUTPUT / filename, optimize=True)

    # An orbital silhouette echoes the logo without tiny script lettering.
    # White on transparency is suitable for Android's monochrome status-bar mask.
    scale = 4
    badge = Image.new("RGBA", (96 * scale, 96 * scale))
    draw = ImageDraw.Draw(badge)
    def box(coords):
        return tuple(value * scale for value in coords)
    draw.ellipse(box((16, 12, 66, 76)), fill="white")
    draw.arc(box((12, 8, 82, 86)), 30, 275, fill="white", width=4 * scale)
    draw.ellipse(box((66, 68, 82, 84)), fill="white")
    draw.ellipse(box((78, 43, 86, 51)), fill="white")
    badge.resize((96, 96), Image.Resampling.LANCZOS).save(OUTPUT / "notification-badge.png", optimize=True)


if __name__ == "__main__":
    build()
