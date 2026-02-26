import json
import os
import shutil

EDITION = "1980-04-17"
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_DIR = os.path.join(ROOT_DIR, f"public/editions/{EDITION}")
DEST_DIR = os.path.join(ROOT_DIR, f"tests/ocr/gold_data/{EDITION}")

# Clean and recreate destination
if os.path.exists(DEST_DIR):
    shutil.rmtree(DEST_DIR)
os.makedirs(DEST_DIR, exist_ok=True)
os.makedirs(os.path.join(DEST_DIR, "images"), exist_ok=True)

with open(os.path.join(SRC_DIR, "edition.json")) as f:
    data = json.load(f)

page_texts = {i: [] for i in range(1, 9)}

for article in data.get("articles", []):
    pages = article.get("source_pages", [])
    for p in pages:
        headline = article.get('headline', '')
        body = article.get('body', '')
        text = f"{headline}\n\n{body}".strip() if headline else body.strip()
        page_texts[int(p)].append(text)

# Hardcoded text-only ad mapping from our verification
text_only_map = {
    "Tominilli's Pizza": 2,
    "Blackburn's": 2,
    "MEL'S SUNOCO": 3,
    "the gathering inn": 3,
    "NEWS SHOP": 3,
    "Delta Tau Delta": 3,
    "delaware CABLE TV": 5,
    "Stanley H. Kaplan Educational Center": 5,
    "THOMPSON'S BIKE & KEY SHOP": 5,
    "Attention All Students": 6,
    "Cubberly Studios": 7,
    "Yarn Barn": 7,
    "Summer Jobs": 7,
    "Stair's Carry Out": 8
}

for ad in data.get("ads", []):
    biz = ad.get("business_name", "")
    page = -1
    
    if biz in text_only_map:
        page = text_only_map[biz]
    elif ad.get("image_files"):
        # Example: images/0002_Page 2_img2.jpg
        fname = ad["image_files"][0]
        if "Page " in fname:
            try:
                page = int(fname.split("Page ")[1].split("_")[0])
            except:
                pass
            
    if page != -1:
        text = f"{biz}\n\n{ad.get('body', '')}".strip() if biz else ad.get('body', '').strip()
        page_texts[page].append(text)

for page, texts in page_texts.items():
    ref_path = os.path.join(DEST_DIR, f"page{page}.reference.txt")
    with open(ref_path, "w") as f:
        # Separate articles/ads by a double newline + dashes to mimic markdown blocks nicely
        f.write("\n\n---\n\n".join(texts))
        
# Copy edition.json
shutil.copy2(os.path.join(SRC_DIR, "edition.json"), os.path.join(DEST_DIR, "edition.json"))

# Copy images
src_images_dir = os.path.join(SRC_DIR, "images")
if os.path.exists(src_images_dir):
    for f in os.listdir(src_images_dir):
        if f.endswith(".jpg") or f.endswith(".png"):
            shutil.copy2(os.path.join(src_images_dir, f), os.path.join(DEST_DIR, "images", f))

print(f"Successfully generated dataset at {DEST_DIR} with {len(page_texts)} reference pages.")
