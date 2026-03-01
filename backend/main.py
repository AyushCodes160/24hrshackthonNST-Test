import base64
import time
import cv2
import numpy as np
import traceback
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from models.deepfake_detector import DeepfakeDetector

app = FastAPI(title="TrueFace Deepfake Detector API")

# Allow CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize global detector (takes a few seconds to load PyTorch models)
print("Initializing deepfake detector...")
try:
    detector = DeepfakeDetector()
    print("Detector initialized successfully!")
except Exception as e:
    print(f"Failed to initialize detector: {e}")
    detector = None

@app.get("/health")
def health_check():
    return {"status": "ok", "detector_loaded": detector is not None}

@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket, mode: str = "faceswap"):
    await websocket.accept()
    if detector is None:
        await websocket.send_json({"error": "Detector not initialized"})
        await websocket.close()
        return

    print(f"Client connected to stream with mode: {mode}")
    try:
        while True:
            # Receive base64 encoded frame from frontend
            data = await websocket.receive_text()
            start_time = time.time()
            
            try:
                # Decode base64 frame
                # Data format: data:image/jpeg;base64,...
                if ',' in data:
                    data = data.split(',')[1]
                    
                image_bytes = base64.b64decode(data)
                np_arr = np.frombuffer(image_bytes, np.uint8)
                image_cv2 = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                
                if image_cv2 is None:
                    continue
                
                # Run Inference
                results = detector.process_frame(image_cv2, mode)
                
                process_time_ms = int((time.time() - start_time) * 1000)
                fps = round(1000 / max(1, process_time_ms), 1)

                await websocket.send_json({
                    "detections": results,
                    "metrics": {
                        "processingTime": f"{process_time_ms}ms",
                        "fps": fps
                    }
                })

            except Exception as e:
                print(f"Error processing frame: {e}")
                traceback.print_exc()
                await websocket.send_json({"error": str(e)})

    except WebSocketDisconnect:
        print("Client disconnected from stream.")

# Mount the React frontend static build
dist_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dist")
if os.path.exists(dist_path):
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="static")
else:
    print(f"Warning: Frontend build directory not found at {dist_path}")

if __name__ == "__main__":
    import uvicorn
    import argparse
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8005)
    args = parser.parse_args()
    
    print(f"Starting FastAPI server at http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port)
