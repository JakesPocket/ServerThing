#!/usr/bin/env python3
"""Generate ClientThing boot splash for Car Thing display."""

import os
from PIL import Image, ImageDraw, ImageFont

# Generate directly in landscape.
WIDTH = 800
HEIGHT = 480
BG_COLOR = (10, 10, 10)          # #0a0a0a
PRIMARY_COLOR = (74, 158, 255)   # #4a9eff
SECONDARY_COLOR = (107, 182, 255)  # #6bb6ff
TEXT_COLOR = (255, 255, 255)
SUBTLE_COLOR = (102, 102, 102)


def load_font(size, bold=False):
    """Try common system fonts, then fall back to PIL default."""
    bold_candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    regular_candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    candidates = bold_candidates if bold else regular_candidates
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def centered_text(draw, text, y, font, color):
    bbox = draw.textbbox((0, 0), text, font=font)
    width = bbox[2] - bbox[0]
    draw.text(((WIDTH - width) // 2, y), text, fill=color, font=font)


def centered_split_text(draw, left_text, left_font, right_text, right_font, y, color, right_y_offset=0):
    """Draw two text runs as one horizontally centered line."""
    left_bbox = draw.textbbox((0, 0), left_text, font=left_font)
    right_bbox = draw.textbbox((0, 0), right_text, font=right_font)
    left_w = left_bbox[2] - left_bbox[0]
    right_w = right_bbox[2] - right_bbox[0]
    total_w = left_w + right_w
    start_x = (WIDTH - total_w) // 2
    draw.text((start_x, y), left_text, fill=color, font=left_font)
    draw.text((start_x + left_w, y + right_y_offset), right_text, fill=color, font=right_font)


def draw_client_devices(draw, cx, cy):
    """Draw a static client-devices icon (monitor + tablet + phone)."""
    stroke_w = 4
    body_fill = (20, 27, 38)
    screen_line = (64, 112, 168)
    accent_green = (83, 211, 126)

    # Main monitor
    mon_left = cx - 120
    mon_top = cy - 72
    mon_right = cx + 62
    mon_bottom = cy + 28
    draw.rounded_rectangle(
        (mon_left, mon_top, mon_right, mon_bottom),
        radius=14,
        fill=body_fill,
        outline=PRIMARY_COLOR,
        width=stroke_w,
    )
    draw.line(
        (mon_left + 24, cy - 22, mon_right - 36, cy - 22),
        fill=screen_line,
        width=5,
    )
    # Monitor stand
    draw.line((cx - 40, mon_bottom + 10, cx - 10, mon_bottom + 10), fill=PRIMARY_COLOR, width=4)
    draw.line((cx - 25, mon_bottom + 10, cx - 25, mon_bottom + 26), fill=PRIMARY_COLOR, width=4)

    # Tablet (back/right)
    tab_left = cx + 5
    tab_top = cy - 48
    tab_right = cx + 104
    tab_bottom = cy + 86
    draw.rounded_rectangle(
        (tab_left, tab_top, tab_right, tab_bottom),
        radius=12,
        fill=body_fill,
        outline=SECONDARY_COLOR,
        width=stroke_w,
    )
    draw.line((tab_left + 14, cy + 8, tab_right - 16, cy + 8), fill=screen_line, width=4)

    # Phone (front/right)
    phone_left = cx + 58
    phone_top = cy - 66
    phone_right = cx + 126
    phone_bottom = cy + 78
    draw.rounded_rectangle(
        (phone_left, phone_top, phone_right, phone_bottom),
        radius=10,
        fill=body_fill,
        outline=PRIMARY_COLOR,
        width=stroke_w,
    )
    draw.line((phone_left + 11, cy - 6, phone_right - 12, cy - 6), fill=screen_line, width=4)

    # Shared status LEDs
    for i, color in enumerate([PRIMARY_COLOR, SECONDARY_COLOR, accent_green]):
        lx = cx + 34 + i * 16
        ly = cy + 56
        draw.ellipse((lx - 4, ly - 4, lx + 4, ly + 4), fill=color)


def main():
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    title_bold_font = load_font(60, bold=True)
    title_regular_font = load_font(60, bold=False)
    version_font = load_font(14)

    # Title only (no icon), centered both horizontally and vertically.
    title_bbox = draw.textbbox((0, 0), "ClientThing", font=title_bold_font)
    title_h = title_bbox[3] - title_bbox[1]
    title_y = (HEIGHT - title_h) // 2
    centered_split_text(
        draw,
        "Client",
        title_bold_font,
        "Thing",
        title_regular_font,
        title_y,
        TEXT_COLOR,
        right_y_offset=-2.5,
    )
    centered_text(draw, "v1.0-bootSplash", HEIGHT - 35, version_font, SUBTLE_COLOR)

    output_paths = [
        "appstart.png",
        os.path.join("CarThingRootDir", "home", "clientthing", "appstart.png"),
    ]
    for output_path in output_paths:
        out_dir = os.path.dirname(output_path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        img.save(output_path, "PNG")
        print(f"✓ Boot splash saved to {output_path}")
    print(f"  Size: {WIDTH}x{HEIGHT}")
    print("  Ready to deploy to device")


if __name__ == "__main__":
    main()
