"""Image region crop/annotation helpers."""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont


def crop_regions(
    image: Image.Image,
    regions: list[tuple[int, int, int, int]],
    padding_frac: float = 0.10,
) -> dict[int, Image.Image]:
    """Return padded source-quality crops without writing evidence artifacts."""
    width, height = image.size
    crops: dict[int, Image.Image] = {}
    for index, (y_min, x_min, y_max, x_max) in enumerate(regions):
        pad_y = int((y_max - y_min) * padding_frac)
        pad_x = int((x_max - x_min) * padding_frac)
        crops[index] = image.crop(
            (
                max(0, x_min - pad_x),
                max(0, y_min - pad_y),
                min(width, x_max + pad_x),
                min(height, y_max + pad_y),
            )
        )
    return crops


def crop_and_save_images(
    image: Image.Image,
    regions: list[tuple[int, int, int, int]],
    output_dir: str,
    page_stem: str,
    padding_frac: float = 0.10,
    quality: int = 95,
) -> dict[int, str]:
    """Crop detected regions from the source-quality color page.

    The 10% evidence margin is part of the visual-call contract.  Public asset
    optimization happens later, after only referenced crops are known.
    """
    if not regions:
        return {}

    img_dir = os.path.join(output_dir, "images")
    os.makedirs(img_dir, exist_ok=True)

    saved = {}
    for i, cropped in crop_regions(image, regions, padding_frac).items():
        filename = f"{page_stem}_img{i+1}.jpg"
        filepath = os.path.join(img_dir, filename)
        cropped.save(filepath, "JPEG", quality=quality)

        saved[i] = os.path.join("images", filename)

    return saved


def draw_region_annotations(
    image: Image.Image,
    regions: list[tuple[int, int, int, int]],
) -> Image.Image:
    """Draw numbered red rectangles on image at each CV bounding box."""
    annotated = image.convert("RGB")
    draw = ImageDraw.Draw(annotated)

    width, height = annotated.size
    line_width = max(3, min(width, height) // 300)
    font_size = max(20, min(width, height) // 40)

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except (OSError, IOError):
        try:
            font = ImageFont.truetype("DejaVuSans.ttf", font_size)
        except (OSError, IOError):
            font = ImageFont.load_default()

    for i, (y_min, x_min, y_max, x_max) in enumerate(regions):
        label = str(i + 1)
        draw.rectangle([(x_min, y_min), (x_max, y_max)], outline="red", width=line_width)

        bbox = font.getbbox(label)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        padding = 4
        label_x = x_min + line_width
        label_y = y_min + line_width

        draw.rectangle(
            [(label_x, label_y), (label_x + text_w + 2 * padding, label_y + text_h + 2 * padding)],
            fill="white",
            outline="red",
            width=1,
        )
        draw.text((label_x + padding, label_y + padding), label, fill="red", font=font)

    return annotated


__all__ = ["crop_and_save_images", "crop_regions", "draw_region_annotations"]
