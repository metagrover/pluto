import pytest
from chunk_cleanup_engine import (
    clean_transcript_chunk,
    validate_cleanup_chunk,
    strip_fillers,
    resolve_self_corrections,
)

def test_strip_fillers():
    raw = "um so we should uh like start the deployment at 2pm"
    cleaned = strip_fillers(raw)
    assert cleaned == "so we should start the deployment at 2pm"

def test_resolve_self_corrections():
    raw = "let's meet at 2... no wait, 3pm tomorrow"
    cleaned = resolve_self_corrections(raw)
    assert cleaned == "let's meet at 3pm tomorrow"

def test_validate_cleanup_chunk_pass():
    raw = "um we need to ship the API update by Tuesday"
    cleaned = "we need to ship the API update by Tuesday"
    assert validate_cleanup_chunk(raw, cleaned) is True

def test_validate_cleanup_chunk_fail_hallucination():
    raw = "let's start"
    cleaned = "let's start discussing the quantum physics quarterly revenue projection"
    assert validate_cleanup_chunk(raw, cleaned) is False

def test_validate_cleanup_chunk_fail_missing_entity():
    raw = "the server IP is 192.168.1.1 on Tuesday"
    cleaned = "the server is ready"
    assert validate_cleanup_chunk(raw, cleaned) is False
