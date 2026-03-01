import cv2
import mediapipe as mp
import torch
import torchvision.transforms as transforms
from PIL import Image
import numpy as np
import os
import sys

class DeepfakeDetector:
    def __init__(self):
        def get_resource_path(relative_path):
            """ Get absolute path to resource, works for dev and for PyInstaller """
            try:
                # PyInstaller creates a temp folder and stores path in _MEIPASS
                base_path = sys._MEIPASS
            except Exception:
                # In development, the project root is backend/
                base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            
            # Use os.path.normpath to ensure consistent separators across OS
            path = os.path.normpath(os.path.join(base_path, relative_path))
            print(f"DEBUG: Resolving resource path: {path}")
            return path

        # Initialize MediaPipe Face Detection
        model_path = get_resource_path(os.path.join('models', 'weights', 'blaze_face_short_range.tflite'))
        print(f"Loading MediaPipe model from: {model_path}")
        
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
        
        if not os.path.exists(model_path):
            print(f"CRITICAL ERROR: MediaPipe model not found at {model_path}")
        
        base_options = python.BaseOptions(model_asset_path=model_path)
        # Confidence lowered to 0.4 for better detection in various lighting
        options = vision.FaceDetectorOptions(base_options=base_options, min_detection_confidence=0.4)
        self.face_detector = vision.FaceDetector.create_from_options(options)

        # Initialize Device (CPU/GPU)
        if torch.cuda.is_available():
            self.device = torch.device('cuda')
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            self.device = torch.device('mps') # Apple Silicon GPU
        else:
            self.device = torch.device('cpu')
            
        print(f"DeepShield Detector using device: {self.device}")

        # Initialize Real Deepfake Model (Vision Transformer)
        from transformers import AutoImageProcessor, AutoModelForImageClassification
        
        model1_path = get_resource_path(os.path.join('models', 'weights', 'deepfake_vs_real_image_detection'))
        print(f"Loading FaceForensics ViT from: {model1_path}")
        self.processor = AutoImageProcessor.from_pretrained(model1_path)
        self.model = AutoModelForImageClassification.from_pretrained(model1_path)
        self.model.to(self.device)
        self.model.eval()
        
        # Initialize Generative AI Detector Model
        model2_path = get_resource_path(os.path.join('models', 'weights', 'ai_vs_deepfake_vs_real'))
        print(f"Loading Generative AI Detector from: {model2_path}")
        self.ai_processor = AutoImageProcessor.from_pretrained(model2_path)
        self.ai_model = AutoModelForImageClassification.from_pretrained(model2_path)
        self.ai_model.to(self.device)
        self.ai_model.eval()
        
        print("All DeepShield AI models loaded successfully!")
        
        # Buffer for mock demo smoothing
        self._last_prob_faceswap = 0.5
        self._last_prob_ai = 0.5

    def detect_faces(self, image_np: np.ndarray):
        """ Detects faces using MediaPipe Tasks API. """
        image_rgb = cv2.cvtColor(image_np, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
        
        detection_result = self.face_detector.detect(mp_image)
        
        faces = []
        if detection_result.detections:
            for detection in detection_result.detections:
                bboxC = detection.bounding_box
                faces.append({
                    "xmin": max(0, int(bboxC.origin_x)),
                    "ymin": max(0, int(bboxC.origin_y)),
                    "width": int(bboxC.width),
                    "height": int(bboxC.height)
                })
        return faces

    def process_frame(self, image_np: np.ndarray, analysis_mode: str = "faceswap"):
        """ Processes a single frame and returns detections. """
        results = []
        
        # --- MODE 1: Generative AI Video ---
        if analysis_mode == "ai_generated":
            frame_pil = Image.fromarray(cv2.cvtColor(image_np, cv2.COLOR_BGR2RGB))
            inputs = self.ai_processor(images=frame_pil, return_tensors="pt").to(self.device)
            
            with torch.no_grad():
                outputs = self.ai_model(**inputs)
                
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
            new_prob = probs[0][0].item() + probs[0][1].item()
            
            # Asymmetric smoothing
            alpha = 0.6 if new_prob > self._last_prob_ai else 0.1
            fake_prob = (alpha * new_prob) + ((1 - alpha) * self._last_prob_ai)
            self._last_prob_ai = fake_prob
            
            status = "FAKE" if fake_prob > 0.5 else "REAL"
            
            faces = self.detect_faces(image_np)
            if not faces:
                return [{
                    "bbox": {"x": 0, "y": 0, "w": image_np.shape[1], "h": image_np.shape[0]},
                    "confidence": float(fake_prob),
                    "status": status
                }]
                
            for face in faces:
                x, y, w, h = face["xmin"], face["ymin"], face["width"], face["height"]
                results.append({
                    "bbox": {"x": x, "y": y, "w": w, "h": h},
                    "confidence": float(fake_prob),
                    "status": status
                })
            return results
        
        # --- MODE 2: Deepfake Face-Swap ---
        faces = self.detect_faces(image_np)
        if not faces:
            return []

        for face in faces:
            x, y, w, h = face["xmin"], face["ymin"], face["width"], face["height"]
            
            # Padded box for ViT context
            pad_x = int(w * 0.4)
            pad_y = int(h * 0.4)
            ui_x1 = max(0, x - pad_x)
            ui_y1 = max(0, y - pad_y)
            ui_x2 = min(image_np.shape[1], x + w + pad_x)
            ui_y2 = min(image_np.shape[0], y + h + pad_y)

            if ui_x2 <= ui_x1 or ui_y2 <= ui_y1:
                continue
                
            face_img = image_np[ui_y1:ui_y2, ui_x1:ui_x2]
            face_pil = Image.fromarray(cv2.cvtColor(face_img, cv2.COLOR_BGR2RGB))
            inputs = self.processor(images=face_pil, return_tensors="pt").to(self.device)

            with torch.no_grad():
                outputs = self.model(**inputs)
                
            probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
            new_prob = probs[0][1].item() # FaceSwap Deepfake class
            
            alpha = 0.6 if new_prob > self._last_prob_faceswap else 0.1
            fake_prob = (alpha * new_prob) + ((1 - alpha) * self._last_prob_faceswap)
            self._last_prob_faceswap = fake_prob
            
            status = "FAKE" if fake_prob > 0.5 else "REAL"

            results.append({
                "bbox": {"x": x, "y": y, "w": w, "h": h},
                "confidence": float(fake_prob),
                "status": status
            })

        return results
