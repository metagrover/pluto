import pytest
from fastapi.testclient import TestClient
import sys
from pathlib import Path

# Add python root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from whisperx_server import app, MLX_WHISPER_AVAILABLE, MLX_MODEL_MAP

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "mlx_available" in data
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
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "updated"
    if MLX_WHISPER_AVAILABLE:
        assert data["config"]["device"] == "mlx"
        assert data["config"]["compute_type"] == "float16"
