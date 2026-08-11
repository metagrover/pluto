import re
from typing import List

FILLER_REGEX = re.compile(r'\b(um|uh|you know|sort of|like)\b\s*', re.IGNORECASE)
SELF_CORRECT_REGEX = re.compile(r'(\S+)\s*(?:\.\.\.|,)?\s*(?:no wait|actually|scratch that|I mean)\s*,?\s*(\S+)', re.IGNORECASE)

def strip_fillers(text: str) -> str:
    cleaned = FILLER_REGEX.sub('', text)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned

def resolve_self_corrections(text: str) -> str:
    def _replace(match):
        return match.group(2)
    return SELF_CORRECT_REGEX.sub(_replace, text).strip()

def clean_transcript_chunk(raw_text: str) -> str:
    if not raw_text or not raw_text.strip():
        return raw_text
    
    cleaned = strip_fillers(raw_text)
    cleaned = resolve_self_corrections(cleaned)
    
    if not validate_cleanup_chunk(raw_text, cleaned):
        return raw_text.strip()
        
    return cleaned

def validate_cleanup_chunk(raw_text: str, cleaned_text: str) -> bool:
    if not raw_text or not cleaned_text:
        return True
        
    raw_len = len(raw_text)
    cleaned_len = len(cleaned_text)
    
    # Length ratio guard
    if cleaned_len < 0.4 * raw_len or cleaned_len > 1.6 * raw_len:
        return False
        
    # Entity retention: preserve numbers & dates
    raw_numbers = set(re.findall(r'\b\d+(?:\.\d+)?\b', raw_text))
    cleaned_numbers = set(re.findall(r'\b\d+(?:\.\d+)?\b', cleaned_text))
    if not raw_numbers.issubset(cleaned_numbers):
        return False
        
    return True
