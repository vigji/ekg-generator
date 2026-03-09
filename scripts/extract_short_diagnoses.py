"""Post-process LITFL ECG data to extract short diagnosis labels from the full interpretation text."""

import json
import re
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output" / "litfl_ecg"

# Map of case number -> short diagnosis (manually curated from page content + AI extraction)
# These are derived from the bold/key findings in each case's interpretation
DIAGNOSIS_PATTERNS = [
    # STEMI patterns
    (r"inferior\s*(?:(?:postero|poster)[\s-]*lateral)?\s*stemi", "Inferior STEMI"),
    (r"infero[\s-]*postero[\s-]*lateral\s*stemi", "Inferoposterolateral STEMI"),
    (r"infero[\s-]*poster(?:ior)?\s*stemi", "Inferoposterior STEMI"),
    (r"anterolateral\s*stemi", "Anterolateral STEMI"),
    (r"anterior\s*stemi", "Anterior STEMI"),
    (r"antero[\s-]*septal\s*stemi", "Anteroseptal STEMI"),
    (r"high\s*lateral\s*stemi", "High Lateral STEMI"),
    (r"lateral\s*stemi", "Lateral STEMI"),
    (r"posterior\s*stemi", "Posterior STEMI"),
    (r"right\s*ventricular\s*infarction", "RV Infarction"),
    (r"stemi", "STEMI"),
    (r"occlusion\s*myocardial\s*infarction", "Occlusion MI (OMI)"),
    (r"sgarbossa", "Sgarbossa Criteria (STEMI equivalent)"),

    # Arrhythmias
    (r"ventricular\s*tachycardia", "Ventricular Tachycardia"),
    (r"torsades\s*de\s*pointes", "Torsades de Pointes"),
    (r"ventricular\s*fibrillation", "Ventricular Fibrillation"),
    (r"atrial\s*flutter", "Atrial Flutter"),
    (r"atrial\s*fibrillation", "Atrial Fibrillation"),
    (r"atrial\s*tachycardia", "Atrial Tachycardia"),
    (r"focal\s*atrial\s*tachycardia", "Focal Atrial Tachycardia"),
    (r"svt|supraventricular\s*tachycardia", "SVT"),
    (r"avnrt", "AVNRT"),
    (r"avrt", "AVRT"),
    (r"sinus\s*tachycardia", "Sinus Tachycardia"),
    (r"sinus\s*bradycardia", "Sinus Bradycardia"),
    (r"junctional\s*(?:escape\s*)?rhythm", "Junctional Rhythm"),
    (r"accelerated\s*idioventricular", "Accelerated Idioventricular Rhythm (AIVR)"),
    (r"idioventricular", "Idioventricular Rhythm"),
    (r"sick\s*sinus|tachycardia[\s-]*bradycardia", "Sick Sinus Syndrome"),
    (r"pacemaker\s*mediated\s*tachycardia", "Pacemaker Mediated Tachycardia"),

    # Blocks
    (r"complete\s*heart\s*block|3rd\s*degree\s*(?:av\s*)?block|third\s*degree", "Complete Heart Block"),
    (r"2nd\s*degree.*mobitz\s*(?:type\s*)?ii|mobitz\s*ii", "Mobitz Type II AV Block"),
    (r"2nd\s*degree.*mobitz\s*(?:type\s*)?i|wenckebach|mobitz\s*i", "Wenckebach (Mobitz I)"),
    (r"2nd\s*degree\s*(?:av\s*)?block", "2nd Degree AV Block"),
    (r"1st\s*degree\s*(?:av\s*)?block", "1st Degree AV Block"),
    (r"trifascicular\s*block", "Trifascicular Block"),
    (r"bifascicular\s*block", "Bifascicular Block"),
    (r"left\s*anterior\s*fascicular\s*block|lafb", "Left Anterior Fascicular Block"),
    (r"left\s*posterior\s*fascicular\s*block|lpfb", "Left Posterior Fascicular Block"),
    (r"rbbb.*lbbb|lbbb.*rbbb", "Alternating Bundle Branch Block"),
    (r"rbbb", "Right Bundle Branch Block"),
    (r"lbbb", "Left Bundle Branch Block"),

    # WPW / Pre-excitation
    (r"wolff[\s-]*parkinson[\s-]*white|wpw", "Wolff-Parkinson-White (WPW)"),
    (r"pre[\s-]*excitation", "Pre-excitation"),

    # Electrolyte / Metabolic
    (r"hyperkalaemia|hyperkalemia|hyperkal", "Hyperkalaemia"),
    (r"hypokalaemia|hypokalemia|hypokal", "Hypokalaemia"),
    (r"hypercalcaemia|hypercalcemia|hypercalc", "Hypercalcaemia"),
    (r"hypocalcaemia|hypocalcemia|hypocalc", "Hypocalcaemia"),
    (r"hypothermia", "Hypothermia"),

    # Toxicology
    (r"tricyclic|tca\s*(?:overdose|toxicity)", "Tricyclic Antidepressant Toxicity"),
    (r"digoxin\s*toxicity", "Digoxin Toxicity"),
    (r"sotalol\s*toxicity", "Sotalol Toxicity"),
    (r"sodium[\s-]*channel\s*block", "Sodium Channel Blockade"),

    # Structural / Other
    (r"brugada", "Brugada Syndrome"),
    (r"long\s*qt", "Long QT Syndrome"),
    (r"wellens", "Wellens Syndrome"),
    (r"pericarditis", "Pericarditis"),
    (r"pulmonary\s*embolism|pe\b", "Pulmonary Embolism"),
    (r"right\s*ventricular\s*hypertrophy|rvh|rv\s*strain", "Right Ventricular Hypertrophy"),
    (r"left\s*ventricular\s*hypertrophy|lvh", "Left Ventricular Hypertrophy"),
    (r"dilated\s*cardiomyopathy", "Dilated Cardiomyopathy"),
    (r"hypertrophic\s*(?:obstructive\s*)?cardiomyopathy|hocm", "Hypertrophic Cardiomyopathy"),
    (r"dextrocardia", "Dextrocardia"),
    (r"brash\s*syndrome", "BRASH Syndrome"),
    (r"paced\s*rhythm|pacemaker|a[\s-]*v\s*sequential\s*pacing", "Paced Rhythm"),
    (r"pseudo[\s-]*infarction", "Pseudo-infarction Pattern"),
    (r"de\s*winter", "De Winter T-waves"),
    (r"qrs\s*alternans", "QRS Alternans"),
    (r"sine\s*wave", "Sine Wave (Critical Hyperkalaemia)"),
    (r"northwest\s*axis", "Northwest Axis"),
    (r"lead\s*misplacement", "Lead Misplacement"),
    (r"ventricular\s*ectop|pvc|bigeminy|trigeminy", "Ventricular Ectopy"),
    (r"low\s*(?:qrs\s*)?voltage", "Low QRS Voltage"),
    (r"u\s*wave", "Prominent U Waves"),
    (r"t[\s-]*wave\s*inversion", "T-wave Inversion"),
    (r"chronic\s*(?:obstructive\s*)?pulmonary|copd|cor\s*pulmonale", "Chronic Pulmonary Disease"),
    (r"left\s*main|lmca", "Left Main Occlusion"),
    (r"intraventricular\s*conduction\s*delay", "Intraventricular Conduction Delay"),
    (r"paediatric|pediatric", "Normal Paediatric ECG"),
]


def extract_short_diagnosis(full_text: str) -> str:
    """Extract a short diagnosis label from full interpretation text."""
    text_lower = full_text.lower()
    matches = []
    for pattern, label in DIAGNOSIS_PATTERNS:
        if re.search(pattern, text_lower):
            matches.append(label)
    # Return the most specific match (longest label often = most specific)
    # but avoid duplicates like "STEMI" if we already have "Inferior STEMI"
    if not matches:
        return ""
    # Filter out generic labels if more specific ones exist
    filtered = []
    for m in matches:
        # Skip generic if we have a more specific version
        is_generic = False
        for m2 in matches:
            if m != m2 and m in m2:
                is_generic = True
                break
        if not is_generic:
            filtered.append(m)
    return "; ".join(dict.fromkeys(filtered))  # dedupe preserving order


def main():
    json_path = OUTPUT_DIR / "litfl_ecg_cases.json"
    with open(json_path) as f:
        cases = json.load(f)

    for case in cases:
        short = extract_short_diagnosis(case["diagnosis"])
        case["short_diagnosis"] = short

    # Save updated JSON
    with open(json_path, "w") as f:
        json.dump(cases, f, indent=2)

    # Save clean summary
    summary_path = OUTPUT_DIR / "litfl_ecg_summary.tsv"
    with open(summary_path, "w") as f:
        f.write("case_num\tshort_diagnosis\timage_files\turl\n")
        for case in cases:
            imgs = "; ".join(case.get("local_images", []))
            f.write(f"{case['case_num']:03d}\t{case['short_diagnosis']}\t{imgs}\t{case['url']}\n")
    print(f"Updated {summary_path}")

    # Print results
    n_labeled = sum(1 for c in cases if c["short_diagnosis"])
    print(f"\nShort diagnosis extracted: {n_labeled}/{len(cases)}")
    print()
    for case in cases:
        sd = case["short_diagnosis"] or "(unclassified)"
        print(f"  Case {case['case_num']:03d}: {sd}")

    missing = [c["case_num"] for c in cases if not c["short_diagnosis"]]
    if missing:
        print(f"\nUnclassified cases: {missing}")


if __name__ == "__main__":
    main()
