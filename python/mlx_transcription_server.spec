# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, copy_metadata

datas = []
for pkg in ['tqdm', 'regex', 'requests', 'packaging', 'filelock', 'numpy', 'tokenizers', 'huggingface_hub']:
    try:
        datas += copy_metadata(pkg)
    except Exception:
        pass
sherpa_datas, sherpa_binaries, sherpa_hiddenimports = collect_all('sherpa_onnx')
datas += sherpa_datas

try:
    mlx_datas, mlx_binaries, mlx_hiddenimports = collect_all('mlx')
    datas += mlx_datas
except Exception:
    mlx_binaries, mlx_hiddenimports = [], []

try:
    mlx_w_datas, mlx_w_binaries, mlx_w_hiddenimports = collect_all('mlx_whisper')
    mlx_w_datas = [
        item for item in mlx_w_datas if not item[0].endswith('torch_whisper.py')
    ]
    datas += mlx_w_datas
except Exception:
    mlx_w_binaries, mlx_w_hiddenimports = [], []

block_cipher = None

a = Analysis(
    ['mlx_transcription_server.py'],
    pathex=[],
    binaries=sherpa_binaries + mlx_binaries + mlx_w_binaries,
    datas=datas,
    hiddenimports=[
        'mlx',
        'mlx_whisper',
    ] + sherpa_hiddenimports + mlx_hiddenimports + mlx_w_hiddenimports,
    hookspath=['hooks'],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torch', 'torchaudio', 'whisperx', 'mlx_whisper.torch_whisper'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='mlx_transcription_server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='mlx_transcription_server',
)
