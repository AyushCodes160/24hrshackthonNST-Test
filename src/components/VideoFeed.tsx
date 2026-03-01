import { useEffect, useRef, useState } from "react";
import { Camera, Upload, Video, AlertTriangle, X, CameraOff, ShieldAlert, ShieldCheck } from "lucide-react";

interface VideoFeedProps {
  mode: "webcam" | "upload_faceswap" | "upload_ai";
  onModeChange: (mode: "webcam" | "upload_faceswap" | "upload_ai") => void;
  isAnalyzing: boolean;
  onAnalyzeToggle: () => void;
  onAnalysisResult?: (data: any) => void;
}

const VideoFeed = ({ mode, onModeChange, isAnalyzing, onAnalyzeToggle, onAnalysisResult }: VideoFeedProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [hasWebcam, setHasWebcam] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(true);
  const [uploadedVideo, setUploadedVideo] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<any[]>([]);

  // Calculate highest risk score for global panel
  const maxRisk = boxes.length > 0 
    ? Math.max(...boxes.map(b => b.confidence))
    : null;
  const isFake = maxRisk !== null && maxRisk > 0.50;

  useEffect(() => {
    let currentStream: MediaStream | null = null;
    if (mode === "webcam" && isCameraActive) {
      navigator.mediaDevices
        .getUserMedia({ video: { width: 640, height: 480 } })
        .then((stream) => {
          currentStream = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            setHasWebcam(true);
          }
        })
        .catch(() => setHasWebcam(false));
    } else {
      setHasWebcam(false);
    }
    return () => {
      // Clean up the stream explicitly, otherwise the camera LED stays on and leaks memory
      if (currentStream) {
        currentStream.getTracks().forEach((t) => t.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [mode, isCameraActive]);

  // WebSocket and frame streaming loop
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isAnalyzing) {
      // Connect to Python Backend based on selected mode
      const analysisMode = mode === "upload_ai" ? "ai_generated" : "faceswap";
      
      let wsBaseUrl;
      if (window.location.protocol === "file:") {
        wsBaseUrl = "ws://127.0.0.1:8005";
      } else {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        wsBaseUrl = import.meta.env.PROD ? `${protocol}//${window.location.host}` : "ws://localhost:8005";
      }
      wsRef.current = new WebSocket(`${wsBaseUrl}/ws/stream?mode=${analysisMode}`);
      
      wsRef.current.onopen = () => console.log(`WS Connected to Backend [Mode: ${analysisMode}]`);
      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.detections) {
          setBoxes(data.detections);
          if (onAnalysisResult) onAnalysisResult(data);
        }
      };

      interval = setInterval(() => {
        const activeVideo = mode === "webcam" ? videoRef.current : uploadVideoRef.current;
        
        if (activeVideo && canvasRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
          const video = activeVideo;
          const canvas = canvasRef.current;
          
          if (video.videoWidth === 0) return;
          
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            // Send to backend as base64 JPEG
            const base64Data = canvas.toDataURL("image/jpeg", 0.7);
            wsRef.current.send(base64Data);
          }
        }
      }, 50); // 20 FPS
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setBoxes([]);
    }

    return () => {
      clearInterval(interval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [isAnalyzing, onAnalysisResult, mode]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedVideo(URL.createObjectURL(file));
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Mode toggle */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => {
            if (isAnalyzing) onAnalyzeToggle();
            onModeChange("webcam");
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-all ${
            mode === "webcam"
              ? "bg-primary/20 text-primary border border-primary/30"
              : "bg-secondary text-muted-foreground border border-border hover:text-foreground"
          }`}
        >
          <Camera className="h-3.5 w-3.5" />
          Live Feed
        </button>
        <button
          onClick={() => {
            if (isAnalyzing) onAnalyzeToggle();
            onModeChange("upload_faceswap");
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-all ${
            mode === "upload_faceswap"
              ? "bg-primary/20 text-primary border border-primary/30"
              : "bg-secondary text-muted-foreground border border-border hover:text-foreground"
          }`}
        >
          <Upload className="h-3.5 w-3.5" />
          Face-Swap Deepfake
        </button>
        <button
          onClick={() => {
            if (isAnalyzing) onAnalyzeToggle();
            onModeChange("upload_ai");
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-all ${
            mode === "upload_ai"
              ? "bg-primary/20 text-primary border border-primary/30"
              : "bg-secondary text-muted-foreground border border-border hover:text-foreground"
          }`}
        >
          <Video className="h-3.5 w-3.5" />
          AI Generated
        </button>
        <div className="flex-1" />
        <button
          onClick={onAnalyzeToggle}
          className={`px-4 py-1.5 rounded-md text-xs font-mono font-semibold transition-all ${
            isAnalyzing
              ? "bg-threat/20 text-threat border border-threat/30 hover:bg-threat/30"
              : "bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30"
          }`}
        >
          {isAnalyzing ? "■ Stop" : "▶ Analyze"}
        </button>
      </div>

      {/* Video area */}
      <div className="relative flex-1 bg-secondary/50 rounded-lg border border-border overflow-hidden min-h-[300px]">
        {mode === "webcam" ? (
          <>
            <video
              key="webcam-video"
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {isCameraActive && hasWebcam && (
              <button
                onClick={() => {
                  if (isAnalyzing) onAnalyzeToggle();
                  setIsCameraActive(false);
                }}
                className="absolute top-3 right-3 bg-background/60 hover:bg-destructive text-foreground hover:text-destructive-foreground p-2 rounded-md backdrop-blur-md transition-all border border-border/50 z-10 shadow-sm"
                title="Turn Camera Off"
              >
                <CameraOff className="h-4 w-4" />
              </button>
            )}
            {!hasWebcam && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 backdrop-blur-sm z-10">
                {isCameraActive ? (
                  <>
                    <Camera className="h-12 w-12 text-muted-foreground/50" />
                    <p className="text-sm font-mono text-muted-foreground">
                      Camera access required
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      Allow camera permissions to use live detection
                    </p>
                  </>
                ) : (
                  <>
                    <CameraOff className="h-12 w-12 text-muted-foreground/50" />
                    <p className="text-sm font-mono text-muted-foreground">
                      Camera is paused
                    </p>
                    <button
                      onClick={() => setIsCameraActive(true)}
                      className="mt-2 px-4 py-1.5 bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 rounded-md text-xs font-mono font-semibold transition-colors"
                    >
                      Turn Camera On
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {uploadedVideo ? (
              <div className="relative w-full h-full flex items-center justify-center bg-black/50">
                <video
                  key="upload-video"
                  ref={uploadVideoRef}
                  src={uploadedVideo}
                  controls
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
                <button
                  onClick={() => {
                    if (isAnalyzing) onAnalyzeToggle();
                    setUploadedVideo(null);
                    if (uploadVideoRef.current) {
                      uploadVideoRef.current.src = "";
                    }
                  }}
                  className="absolute top-3 right-3 bg-background/60 hover:bg-destructive text-foreground hover:text-destructive-foreground p-2 rounded-md backdrop-blur-md transition-all border border-border/50 z-10 shadow-sm"
                  title="Clear Video"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="absolute inset-0 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-primary/5 transition-colors">
                <Video className="h-12 w-12 text-muted-foreground/50" />
                <p className="text-sm font-mono text-muted-foreground">
                  Drop video or click to upload
                </p>
                
                {/* Specific AI Engine Warnings based on Mode */}
                {mode === "upload_faceswap" && (
                  <div className="flex items-start gap-2 max-w-[80%] bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-md mt-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="flex flex-col">
                      <p className="text-xs font-semibold text-amber-500 font-mono">FACE-SWAPS ONLY</p>
                      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                        This engine requires a visible human face to detect digital stitching. Fully AI-generated videos (Sora/Midjourney) will fail here.
                      </p>
                    </div>
                  </div>
                )}
                
                {mode === "upload_ai" && (
                  <div className="flex items-start gap-2 max-w-[80%] bg-blue-500/10 border border-blue-500/30 p-2.5 rounded-md mt-2">
                    <AlertTriangle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    <div className="flex flex-col">
                      <p className="text-xs font-semibold text-blue-500 font-mono">FULL-FRAME AI GEN ONLY</p>
                      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                        This engine scans the entire video for fake backgrounds and physics. Face-Swaps on real bodies will fail here.
                      </p>
                    </div>
                  </div>
                )}
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            )}
          </>
        )}

        {/* Scanning overlay */}
        <canvas ref={canvasRef} className="hidden" />

        {isAnalyzing && maxRisk !== null && (
          <div className="absolute top-4 left-4 z-20 flex flex-col gap-1 bg-background/80 backdrop-blur-md border border-border/50 rounded-lg p-3 shadow-lg min-w-[180px] animate-in slide-in-from-left-4 fade-in duration-300">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Global Risk</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isFake ? (
                  <ShieldAlert className="h-5 w-5 text-red-500" />
                ) : (
                  <ShieldCheck className="h-5 w-5 text-green-500" />
                )}
                <span className={`font-mono text-lg font-bold ${isFake ? 'text-red-500' : 'text-green-500'}`}>
                  {isFake ? 'FAKE' : 'REAL'}
                </span>
              </div>
              <span className={`font-mono text-xl font-black ${isFake ? 'text-red-500' : 'text-green-500'}`}>
                {isFake ? 'FAKE' : 'REAL'} {isFake ? (maxRisk * 100).toFixed(1) : ((1 - maxRisk) * 100).toFixed(1)}%
              </span>
            </div>
            {/* Minimal Progress Bar */}
            <div className="h-1.5 w-full bg-secondary rounded-full mt-2 overflow-hidden">
              <div 
                className={`h-full transition-all duration-300 ${isFake ? 'bg-red-500' : 'bg-green-500'}`} 
                style={{ width: `${(isFake ? maxRisk : (1 - maxRisk)) * 100}%` }}
              />
            </div>
          </div>
        )}
        
        {isAnalyzing && (
          <>
            <div className="absolute inset-0 scanline pointer-events-none" />
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan" />
            </div>
            
            {/* Live bounding boxes from backend */}
            {boxes.map((box, i) => {
              const b = box.bbox;
              const isBoxFake = box.status === "FAKE";
              const prob = isBoxFake ? (box.confidence * 100).toFixed(1) : ((1 - box.confidence) * 100).toFixed(1);
              // Calculate bounds taking into account CSS object-cover/object-contain cropping
              const activeVideo = mode === "webcam" ? videoRef.current : uploadVideoRef.current;
              if (!activeVideo || activeVideo.videoWidth === 0) return null;
              
              const containerWidth = activeVideo.clientWidth;
              const containerHeight = activeVideo.clientHeight;
              const videoWidth = activeVideo.videoWidth;
              const videoHeight = activeVideo.videoHeight;
              
              const isCover = mode === "webcam";
              // Calculate scaling factor used by object-cover or object-contain
              const scale = isCover 
                 ? Math.max(containerWidth / videoWidth, containerHeight / videoHeight)
                 : Math.min(containerWidth / videoWidth, containerHeight / videoHeight);
              
              // Calculate letterbox/crop offset
              const visualWidth = videoWidth * scale;
              const visualHeight = videoHeight * scale;
              const offsetX = (containerWidth - visualWidth) / 2;
              const offsetY = (containerHeight - visualHeight) / 2;

              // Apply offset and scale to intrinsic coordinates
              const leftPx = offsetX + b.x * scale;
              const topPx = offsetY + b.y * scale;
              const widthPx = b.w * scale;
              const heightPx = b.h * scale;
              
              // Convert to final positioning percentages for the container div
              const leftPct = (leftPx / containerWidth) * 100;
              const topPct = (topPx / containerHeight) * 100;
              const widthPct = (widthPx / containerWidth) * 100;
              const heightPct = (heightPx / containerHeight) * 100;

              return (
                <div 
                  key={i}
                  className="absolute border-2 pointer-events-none rounded-sm"
                  style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    width: `${widthPct}%`,
                    height: `${heightPct}%`,
                    borderColor: box.status === "FAKE" ? 'rgba(239, 68, 68, 0.8)' : 'rgba(34, 197, 94, 0.8)'
                  }}
                >
                  <div className={`absolute -top-6 left-0 text-[10px] font-mono px-1.5 py-0.5 rounded text-white ${box.status === "FAKE" ? 'bg-red-500/80' : 'bg-green-500/80'}`}>
                    {box.status} • {prob} %
                  </div>
                </div>
              );
            })}

          </>
        )}

        {/* Status bar */}
        <div className="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-sm px-3 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${isAnalyzing ? "bg-safe animate-pulse" : "bg-muted-foreground/40"}`} />
            <span className="text-[10px] font-mono text-muted-foreground">
              {isAnalyzing ? "ANALYZING" : "STANDBY"}
            </span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">
            {mode === "webcam" ? "640×480 • 30fps" : "VIDEO INPUT"}
          </span>
        </div>
      </div>
    </div>
  );
};

export default VideoFeed;
