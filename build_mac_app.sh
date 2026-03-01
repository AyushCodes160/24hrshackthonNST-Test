#!/usr/bin/env bash
set -o errexit

echo "============================================="
echo "Building DeepShield macOS Desktop Application"
echo "============================================="
echo "WARNING: This can take 30-45 minutes of heavy processor load."

# 1. Build the Vite React Frontend
echo ""
echo "==== 1/4: Building Frontend ===="
npm run build

# 2. Package the Python Backend using PyInstaller
echo ""
echo "==== 2/4: Compiling Python Backend (PyInstaller) ===="
cd backend
# Ensure all dependencies are present in the build environment
pip install -r requirements.txt
pip install pyinstaller

# Run PyInstaller
# We use --collect-all for mediapipe and transformers as they are complex with many data files
# We ensure opencv-python is properly found
pyinstaller --noconfirm --onedir \
    --name "api" \
    --add-data "models:models" \
    --collect-all "mediapipe" \
    --collect-all "transformers" \
    --hidden-import "cv2" \
    --hidden-import "uvicorn" \
    --hidden-import "fastapi" \
    --hidden-import "websockets" \
    --hidden-import "numpy" \
    --hidden-import "torch" \
    --hidden-import "torchvision" \
    main.py

echo "Python compilation finished."
cd ..

# 3. Use Electron-Builder to compress EVERYTHING into a DMG
echo ""
echo "==== 3/4: Packaging App via Electron Builder ===="
# Notice: package.json has 'extraResources' which guarantees 'backend/dist/api' is bundled inside the app container
npx electron-builder --mac dmg

echo ""
echo "==== 4/4: DONE! ===="
echo "Look inside the 'release/' folder for your DeepShield.dmg installer!"
