import sqlite3
import pytest
from auto_learn_dictionary import (
    compute_word_diffs,
    qualify_jargon_candidate,
    init_dictionary_db,
    save_jargon_candidate,
    get_hotwords_prompt,
)

def test_compute_word_diffs():
    original = "we deployed to kubernets today"
    edited = "we deployed to Kubernetes today"
    diffs = compute_word_diffs(original, edited)
    assert diffs == [("kubernets", "Kubernetes")]

def test_qualify_jargon_candidate():
    assert qualify_jargon_candidate("the") is False
    assert qualify_jargon_candidate("Kubernetes") is True
    assert qualify_jargon_candidate("GraphQL") is True

def test_save_and_get_hotwords():
    conn = sqlite3.connect(":memory:")
    init_dictionary_db(conn)
    save_jargon_candidate(conn, "kubernets", "Kubernetes")
    save_jargon_candidate(conn, "graphql", "GraphQL")
    
    prompt = get_hotwords_prompt(conn)
    assert "Kubernetes" in prompt
    assert "GraphQL" in prompt
