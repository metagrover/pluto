# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, copy_metadata

datas = []
datas += copy_metadata('whisperx')
datas += copy_metadata('torch')
datas += copy_metadata('tqdm')
datas += copy_metadata('regex')
datas += copy_metadata('requests')
datas += copy_metadata('packaging')
datas += copy_metadata('filelock')
datas += copy_metadata('numpy')
datas += copy_metadata('tokenizers')
datas += copy_metadata('huggingface_hub')
sherpa_datas, sherpa_binaries, sherpa_hiddenimports = collect_all('sherpa_onnx')
datas += sherpa_datas

try:
    mlx_datas, mlx_binaries, mlx_hiddenimports = collect_all('mlx')
    datas += mlx_datas
except Exception:
    mlx_binaries, mlx_hiddenimports = [], []

try:
    mlx_w_datas, mlx_w_binaries, mlx_w_hiddenimports = collect_all('mlx_whisper')
    datas += mlx_w_datas
except Exception:
    mlx_w_binaries, mlx_w_hiddenimports = [], []

block_cipher = None

a = Analysis(
    ['whisperx_server.py'],
    pathex=[],
    binaries=sherpa_binaries + mlx_binaries + mlx_w_binaries,
    datas=datas,
    hiddenimports=[
        'whisperx',
        'mlx',
        'mlx_whisper',
        'pytorch_lightning.loops.fit_loop',
        'pytorch_lightning.loops.epoch.training_epoch_loop',
        'pytorch_lightning.loops.batch.training_batch_loop',
        'sklearn.neighbors._typedefs',
        'sklearn.neighbors._quad_tree',
        'sklearn.tree',
        'sklearn.tree._utils',
    ] + sherpa_hiddenimports + mlx_hiddenimports + mlx_w_hiddenimports,
    hookspath=['hooks'],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
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
    name='whisperx_server',
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
    name='whisperx_server',
)
