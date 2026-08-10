import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
import sys
from pathlib import Path

# Add python root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

import whisperx_server as server
from whisperx_server import app, MLX_WHISPER_AVAILABLE, MLX_MODEL_MAP

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "mlx_available" in data
    assert "whisperx_available" in data
    assert data["engine"] in {"mlx_whisper", "whisperx", "unavailable"}
    assert data["mlx_available"] == MLX_WHISPER_AVAILABLE
    if MLX_WHISPER_AVAILABLE:
        assert "mlx" in data["supported_devices"]

def test_mlx_model_map():
    assert "small" in MLX_MODEL_MAP
    assert MLX_MODEL_MAP["small"] == "mlx-community/whisper-small-mlx"
    assert "medium" in MLX_MODEL_MAP
    assert MLX_MODEL_MAP["medium"] == "mlx-community/whisper-medium-mlx"

def test_config_update_mlx():
    response = client.post("/config", json={"device": "mlx", "model": "small"})
    if not MLX_WHISPER_AVAILABLE:
        assert response.status_code == 503
        assert response.json()["detail"] == "MLX Whisper is unavailable"
        return

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "updated"
    assert data["config"]["device"] == "mlx"
    assert data["config"]["compute_type"] == "float16"


def test_requested_mlx_does_not_silently_fall_back_to_cpu(monkeypatch):
    monkeypatch.setattr(server, "MLX_WHISPER_AVAILABLE", False)
    monkeypatch.setitem(server.model_config, "device", "cpu")
    monkeypatch.setitem(server.model_config, "model_name", "small")
    monkeypatch.setitem(server.model_config, "compute_type", "int8")

    with pytest.raises(HTTPException, match="MLX Whisper is unavailable") as exc:
        server.load_model_if_needed({"device": "mlx", "model": "small"})

    assert exc.value.status_code == 503
    assert server.model_config["device"] == "cpu"
