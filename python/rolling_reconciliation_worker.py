from typing import List, Dict, Any, Tuple
import re

def levenshtein_distance(a: str, b: str) -> int:
    if len(a) < len(b):
        return levenshtein_distance(b, a)
    if len(b) == 0:
        return len(a)

    previous_row = range(len(b) + 1)
    for i, c1 in enumerate(a):
        current_row = [i + 1]
        for j, c2 in enumerate(b):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    return previous_row[-1]

def reconcile_transcript_segments(
    draft_segments: List[Dict[str, Any]],
    reconciled_text: str
) -> Tuple[List[Dict[str, Any]], int]:
    updated_segments = [dict(s) for s in draft_segments]
    corrections_made = 0
    
    rec_words = re.findall(r'\b\w+\b', reconciled_text)
    if not rec_words:
        return updated_segments, 0

    for seg in updated_segments:
        orig_text = seg.get("text", "")
        orig_words = re.findall(r'\b\w+\b', orig_text)
        
        for o in orig_words:
            o_lower = o.lower()
            for r in rec_words:
                r_lower = r.lower()
                is_jargon = r[0].isupper() or any(c.isupper() for c in r[1:])
                if is_jargon:
                    if o_lower == r_lower or (abs(len(o) - len(r)) <= 3 and levenshtein_distance(o_lower, r_lower) <= 2):
                        if o != r:
                            new_text = re.sub(rf'\b{re.escape(o)}\b', r, seg["text"])
                            if new_text != seg["text"]:
                                seg["text"] = new_text
                                corrections_made += 1

    return updated_segments, corrections_made
