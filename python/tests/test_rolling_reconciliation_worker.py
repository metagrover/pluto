import pytest
from rolling_reconciliation_worker import reconcile_transcript_segments

def test_reconcile_transcript_segments():
    draft_segments = [
        {"start": 0.0, "end": 4.0, "text": "we are deploying to kubernets today"}
    ]
    reconciled_raw = "we are deploying to Kubernetes today"
    
    updated, corrected_count = reconcile_transcript_segments(draft_segments, reconciled_raw)
    assert corrected_count == 1
    assert updated[0]["text"] == "we are deploying to Kubernetes today"
