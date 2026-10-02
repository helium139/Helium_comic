"""Compose one public 1200x630 OG image per comic, shared by its chapters."""

import json
import hashlib
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import PIL
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://heliumtg.com"
SIZE = (1200, 630)
TEAM_WIDTH = 456  # 38%; the cover gets the remaining 62%.


def compose(logo, cover):
    image = Image.new("RGB", SIZE)
    draw = ImageDraw.Draw(image)
    # A filled lavender gradient supports the transparent team logo.
    for y in range(SIZE[1]):
        mix = y / (SIZE[1] - 1)
        color = tuple(round(top + (bottom - top) * mix) for top, bottom in zip((239, 219, 249), (176, 139, 205)))
        draw.line((0, y, TEAM_WIDTH - 1, y), fill=color)
    team = ImageOps.contain(logo.convert("RGBA"), (TEAM_WIDTH - 48, SIZE[1] - 80), Image.Resampling.LANCZOS)
    image.paste(team, ((TEAM_WIDTH - team.width) // 2, (SIZE[1] - team.height) // 2), team)
    # Fit preserves aspect ratio. Slightly favor the top of portrait covers.
    panel = ImageOps.fit(cover.convert("RGBA"), (SIZE[0] - TEAM_WIDTH, SIZE[1]), Image.Resampling.LANCZOS, centering=(0.5, 0.3))
    image.paste((38, 26, 51), (TEAM_WIDTH, 0, SIZE[0], SIZE[1]))
    image.paste(panel, (TEAM_WIDTH, 0), panel)
    return image


def load_cover(value, cached=None):
    url = urljoin(BASE_URL + "/", value)
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.hostname in ("localhost", "127.0.0.1", "::1"):
        raise ValueError(f"Cover must be a public HTTPS URL: {url!r}")
    request = Request(url, headers={"User-Agent": "HeliumTG-OG-Generator/1.0"})
    if cached and cached.get("url") == url:
        if cached.get("etag"):
            request.add_header("If-None-Match", cached["etag"])
        elif cached.get("last_modified"):
            request.add_header("If-Modified-Since", cached["last_modified"])
    try:
        with urlopen(request, timeout=30) as response:
            content = response.read()
            metadata = {
                "url": url,
                "etag": response.headers.get("ETag"),
                "last_modified": response.headers.get("Last-Modified"),
                "cover_sha256": hashlib.sha256(content).hexdigest(),
            }
    except HTTPError as error:
        if error.code == 304 and cached and any(key.lower().startswith("if-") for key in request.headers):
            error.close()
            return None, cached
        raise
    if cached and metadata["cover_sha256"] == cached.get("cover_sha256"):
        return None, metadata
    with Image.open(BytesIO(content)) as source:
        return ImageOps.exif_transpose(source).convert("RGBA"), metadata


def build():
    data = json.loads((ROOT / "assets/data/data.json").read_text(encoding="utf-8"))
    # Validate every filename before writing any output.
    for slug in data:
        if not slug or slug in (".", "..") or "/" in slug or "\\" in slug:
            raise ValueError(f"Unsafe manga slug: {slug!r}")
    with Image.open(ROOT / "assets/images/helium_logo.webp") as source:
        logo = ImageOps.exif_transpose(source).convert("RGBA")
    output = ROOT / "assets/og"
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / ".sources.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        manifest = {}
    # Any logo, layout, or encoder change must regenerate the composites.
    renderer = hashlib.sha256(
        Path(__file__).read_bytes()
        + (ROOT / "assets/images/helium_logo.webp").read_bytes()
        + PIL.__version__.encode()
    ).hexdigest()
    previous = manifest.get("images", {}) if manifest.get("renderer") == renderer else {}
    entries = {}
    generated = 0
    for slug, manga in data.items():
        target = output / f"{slug}.jpg"
        cached = previous.get(slug)
        if not target.is_file() or not cached or hashlib.sha256(target.read_bytes()).hexdigest() != cached.get("image_sha256"):
            cached = None
        cover, metadata = load_cover(manga["cover"], cached)
        if cover is not None:
            compose(logo, cover).save(target, "JPEG", quality=90, optimize=True)
            generated += 1
            print(f"Generated assets/og/{slug}.jpg")
        else:
            print(f"Reused assets/og/{slug}.jpg")
        metadata["image_sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
        entries[slug] = metadata
    manifest_path.write_text(json.dumps({"renderer": renderer, "images": entries}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {generated}, reused {len(data) - generated} OG images ({SIZE[0]}x{SIZE[1]}).")


if __name__ == "__main__":
    build()
