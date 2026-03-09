"""Scrape ECG images and diagnoses from LITFL Top 100 ECG cases."""

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://litfl.com/ecg-case-{:03d}/"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output" / "litfl_ecg"
IMAGES_DIR = OUTPUT_DIR / "images"
MAX_CASE = 137  # cases go up to 137
HEADERS = {"User-Agent": "Mozilla/5.0 (educational research)"}


def extract_diagnosis(soup) -> str:
    """Extract the ECG diagnosis from the page using multiple strategies."""

    # Strategy 1: Genesis Blocks accordion with "ANSWER" or "INTERPRETATION"
    for accordion_title in soup.find_all(class_="gb-accordion-title"):
        title_text = accordion_title.get_text(strip=True).lower()
        if any(kw in title_text for kw in ["answer", "interpretation"]):
            # The answer content is in the sibling gb-accordion-text
            accordion = accordion_title.find_parent(class_="gb-block-accordion")
            if accordion:
                answer_div = accordion.find(class_="gb-accordion-text")
                if answer_div:
                    return answer_div.get_text(strip=True)

    # Strategy 2: Look for heading with "Interpretation", "Answer", "Key Points"
    for heading in soup.find_all(re.compile(r"^h[1-6]$")):
        text = heading.get_text(strip=True).lower()
        if any(kw in text for kw in ["interpretation", "answer", "key points"]):
            parts = []
            for sib in heading.find_next_siblings():
                if sib.name and re.match(r"^h[1-6]$", sib.name):
                    break
                sib_text = sib.get_text(strip=True)
                if sib_text:
                    parts.append(sib_text)
            if parts:
                return "\n".join(parts)

    # Strategy 3: Look for strong/bold text with ECG diagnosis keywords
    for strong in soup.find_all(["strong", "b"]):
        text = strong.get_text(strip=True)
        if len(text) > 10 and any(kw in text.lower() for kw in [
            "stemi", "fibrillation", "flutter", "tachycardia", "bradycardia",
            "block", "hypertrophy", "ischemia", "infarction", "wpw",
            "pericarditis", "hyperkal", "hypokal", "long qt", "brugada",
            "pulmonary embolism", "axis", "rhythm", "hypothermia",
            "hypercalc", "hypocalc", "wellens", "sgarbossa",
        ]):
            return text

    return ""


def fetch_case(case_num: int) -> dict | None:
    """Fetch a single ECG case page and extract image URLs + diagnosis."""
    url = BASE_URL.format(case_num)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  Case {case_num:03d}: request error - {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    # --- Extract images ---
    article = soup.find("article") or soup.find("div", class_="entry-content") or soup
    img_urls = []
    for img in article.find_all("img"):
        src = img.get("data-src") or img.get("src") or ""
        if not src:
            continue
        if re.search(r"\.(jpe?g|png)", src, re.IGNORECASE):
            if any(skip in src.lower() for skip in [
                "gravatar", "logo", "icon", "avatar", "emoji", "plugin",
            ]):
                continue
            if src.startswith("//"):
                src = "https:" + src
            elif src.startswith("/"):
                src = "https://litfl.com" + src
            img_urls.append(src)

    # --- Extract diagnosis ---
    diagnosis_text = extract_diagnosis(soup)

    return {
        "case_num": case_num,
        "url": url,
        "image_urls": img_urls,
        "diagnosis": diagnosis_text,
    }


def download_image(url: str, filepath: Path) -> bool:
    """Download an image to disk."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        filepath.write_bytes(resp.content)
        return True
    except requests.RequestException as e:
        print(f"  Failed to download {url}: {e}")
        return False


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Scraping LITFL ECG cases 001-{MAX_CASE}...")
    cases = []

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(fetch_case, i): i for i in range(1, MAX_CASE + 1)}
        for future in as_completed(futures):
            case_num = futures[future]
            result = future.result()
            if result:
                cases.append(result)
                n_img = len(result["image_urls"])
                diag = result["diagnosis"][:80] if result["diagnosis"] else "(no diagnosis extracted)"
                print(f"  Case {case_num:03d}: {n_img} image(s) | {diag}")
            else:
                print(f"  Case {case_num:03d}: not found or error")

    cases.sort(key=lambda c: c["case_num"])
    print(f"\nFound {len(cases)} cases total.")

    # Download images
    print("\nDownloading images...")
    for case in cases:
        for i, img_url in enumerate(case["image_urls"]):
            ext = "jpg"
            m = re.search(r"\.(jpe?g|png)", img_url, re.IGNORECASE)
            if m:
                ext = m.group(1).lower()
                if ext == "jpeg":
                    ext = "jpg"
            suffix = "" if i == 0 else f"_{chr(ord('a') + i)}"
            filename = f"case_{case['case_num']:03d}{suffix}.{ext}"
            filepath = IMAGES_DIR / filename
            if filepath.exists():
                pass  # already downloaded
            else:
                if download_image(img_url, filepath):
                    print(f"  Downloaded {filename}")
            case.setdefault("local_images", []).append(filename)
        time.sleep(0.1)

    # Save metadata JSON
    json_path = OUTPUT_DIR / "litfl_ecg_cases.json"
    with open(json_path, "w") as f:
        json.dump(cases, f, indent=2)
    print(f"\nMetadata saved to {json_path}")

    # Save summary TSV
    summary_path = OUTPUT_DIR / "litfl_ecg_summary.tsv"
    with open(summary_path, "w") as f:
        f.write("case_num\tdiagnosis\timage_files\timage_urls\n")
        for case in cases:
            imgs = "; ".join(case.get("local_images", []))
            urls = "; ".join(case["image_urls"])
            diag = case["diagnosis"].replace("\t", " ").replace("\n", " | ")
            f.write(f"{case['case_num']:03d}\t{diag}\t{imgs}\t{urls}\n")
    print(f"Summary saved to {summary_path}")

    # Print stats
    with_diag = sum(1 for c in cases if c["diagnosis"])
    print(f"\nDiagnosis extracted: {with_diag}/{len(cases)} cases")
    missing = [c["case_num"] for c in cases if not c["diagnosis"]]
    if missing:
        print(f"Missing diagnosis for cases: {missing}")


if __name__ == "__main__":
    main()
