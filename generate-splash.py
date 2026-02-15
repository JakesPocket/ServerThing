#!/usr/bin/env python3
"""Generate ServerThing boot splash for Car Thing display"""

from PIL import Image, ImageDraw, ImageFont
import math

# Car Thing Weston mode: 480x800 with transform=90
# Generate in portrait, content will be rotated by Weston
WIDTH = 480
HEIGHT = 800
BG_COLOR = (10, 10, 10)  # #0a0a0a
PRIMARY_COLOR = (74, 158, 255)  # #4a9eff
SECONDARY_COLOR = (107, 182, 255)  # #6bb6ff
TEXT_COLOR = (255, 255, 255)
SUBTLE_COLOR = (102, 102, 102)

# Create image
img = Image.new('RGB', (WIDTH, HEIGHT), BG_COLOR)
draw = ImageDraw.Draw(img)

# Center coordinates (portrait orientation)
cx, cy = WIDTH // 2, HEIGHT // 2

# Draw outer gear
outer_radius = 50
draw.ellipse(
    (cx - outer_radius, cy - outer_radius, cx + outer_radius, cy + outer_radius),
    outline=PRIMARY_COLOR,
    width=6
)

# Outer gear teeth (8 directions)
for i in range(8):
    angle = (math.pi / 4) * i
    x1 = cx + int(math.cos(angle) * outer_radius)
    y1 = cy + int(math.sin(angle) * outer_radius)
    x2 = cx + int(math.cos(angle) * (outer_radius + 12))
    y2 = cy + int(math.sin(angle) * (outer_radius + 12))
    draw.line((x1, y1, x2, y2), fill=PRIMARY_COLOR, width=6)

# Draw inner gear
inner_radius = 32
draw.ellipse(
    (cx - inner_radius, cy - inner_radius, cx + inner_radius, cy + inner_radius),
    outline=SECONDARY_COLOR,
    width=4
)

# Inner gear teeth (4 directions)
for i in range(4):
    angle = (math.pi / 2) * i
    x1 = cx + int(math.cos(angle) * inner_radius)
    y1 = cy + int(math.sin(angle) * inner_radius)
    x2 = cx + int(math.cos(angle) * (inner_radius + 10))
    y2 = cy + int(math.sin(angle) * (inner_radius + 10))
    draw.line((x1, y1, x2, y2), fill=SECONDARY_COLOR, width=4)

# Center circle
center_radius = 12
draw.ellipse(
    (cx - center_radius, cy - center_radius, cx + center_radius, cy + center_radius),
    fill=PRIMARY_COLOR
)

# Text - try to use system font, fallback to default
try:
    title_font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 36)
    version_font = ImageFont.truetype("/System/Library/Fonts/Courier.ttc", 14)
except:
    try:
        title_font = ImageFont.truetype("/Library/Fonts/Arial.ttf", 36)
        version_font = ImageFont.truetype("/Library/Fonts/Courier New.ttf", 14)
    except:
        title_font = ImageFont.load_default()
        version_font = ImageFont.load_default()

# App name
title_text = "ServerThing"
title_bbox = draw.textbbox((0, 0), title_text, font=title_font)
title_width = title_bbox[2] - title_bbox[0]
draw.text((cx - title_width // 2, cy + 80), title_text, fill=TEXT_COLOR, font=title_font)

# Version
version_text = "v1.0.1-syncFix"
version_bbox = draw.textbbox((0, 0), version_text, font=version_font)
version_width = version_bbox[2] - version_bbox[0]
draw.text((cx - version_width // 2, 740), version_text, fill=SUBTLE_COLOR, font=version_font)

# Save
output_path = "appstart.png"
img.save(output_path, 'PNG')
print(f"✓ Boot splash saved to {output_path}")
print(f"  Size: {WIDTH}x{HEIGHT}")
print(f"  Ready to deploy to device")
