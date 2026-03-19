
import torch
import sys
import os
from omegaconf.listconfig import ListConfig
from omegaconf.dictconfig import DictConfig

# Allow omegaconf classes for unpickling
torch.serialization.add_safe_globals([ListConfig, DictConfig])

def upgrade(path):
    print(f"Upgrading {path}...")
    # Load with weights_only=False to bypass the new default in Torch 2.8
    checkpoint = torch.load(path, map_location='cpu', weights_only=False)
    
    # Save it back - this will save it in the modern format
    torch.save(checkpoint, path)
    print("Upgrade successful!")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python upgrade_fix.py <path_to_checkpoint>")
        sys.exit(1)
    upgrade(sys.argv[1])
