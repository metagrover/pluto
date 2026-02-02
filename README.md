# Pluto

Intelligent meeting assistant and "second brain" application.

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v18+)
- **Python** (v3.9+ recommended)
    - *Note: You do NOT need to install Python libraries globally. The project handles this for you.*
- **FFmpeg** (`brew install ffmpeg` on macOS)

### Installation (for Contributors)

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-org/pluto.git
    cd pluto
    ```

2.  **Install Dependencies**
    This will install Node packages AND set up a local Python virtual environment automatically.
    ```bash
    npm install
    ```

3.  **Run the App**
    ```bash
    npm run dev
    ```

## 📦 Building for Production

To create a DMG installer that includes the bundled Python environment (no client-side setup required):

```bash
npm run build
```

The output DMG will be in `release/`.

## 🛠 Project Structure

- `src/` - React/Electron source code
- `python/` - Python server (WhisperX) and requirements
- `scripts/` - Build and setup automation scripts
- `resources/` - Assets and bundled binaries
