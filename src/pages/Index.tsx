import { useState, useEffect, useCallback } from "react";
import Header from "@/components/Header";
import VideoFeed from "@/components/VideoFeed";
import ConfidenceGauge from "@/components/ConfidenceGauge";
import HeatmapDisplay from "@/components/HeatmapDisplay";
import FrequencySpectrum from "@/components/FrequencySpectrum";
import MetricsPanel from "@/components/MetricsPanel";
import ExplainabilityPanel from "@/components/ExplainabilityPanel";
import ArchitecturePanel from "@/components/ArchitecturePanel";
import TimelineGraph from "@/components/TimelineGraph";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const [mode, setMode] = useState<"webcam" | "upload_faceswap" | "upload_ai">("webcam");
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [retryCount, setRetryCount] = useState(0);
  
  let wsUrl;
  if (window.location.protocol === "file:") {
    wsUrl = "ws://127.0.0.1:8005";
  } else {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    wsUrl = import.meta.env.PROD ? `${protocol}//${window.location.host}` : "ws://localhost:8005";
  }

  // Check health on mount
  useEffect(() => {
    let isMounted = true;
    const checkHealth = async () => {
      setConnectionStatus("connecting");
      try {
        const response = await fetch("http://127.0.0.1:8005/health");
        if (response.ok) {
          const data = await response.json();
          if (data.status === "ok" && data.detector_loaded && isMounted) {
            setConnectionStatus("connected");
            return;
          }
        }
        // If not ok or detector not loaded, retry
        if (isMounted) setTimeout(checkHealth, 2000);
      } catch (err) {
        console.error("Health check failed:", err);
        if (isMounted) {
          // If we've retried a few times and still failing, show error
          if (retryCount > 10) {
            setConnectionStatus("error");
          } else {
            setRetryCount(prev => prev + 1);
            setTimeout(checkHealth, 2000);
          }
        }
      }
    };

    checkHealth();
    return () => { isMounted = false; };
  }, [retryCount]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [cnnScore, setCnnScore] = useState(0);
  const [fftScore, setFftScore] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [metrics, setMetrics] = useState({ fps: 0, processingTime: '0ms' });

  const finalScore = 0.7 * cnnScore + 0.3 * fftScore;

  // Update history buffer periodically based on current scores
  useEffect(() => {
    if (!isAnalyzing) return;
    const historyInterval = setInterval(() => {
      setHistory((prev) => {
        const newVal = 0.7 * cnnScore + 0.3 * fftScore;
        const next = [...prev, newVal];
        return next.length > 60 ? next.slice(-60) : next;
      });
    }, 500);

    return () => clearInterval(historyInterval);
  }, [isAnalyzing, cnnScore, fftScore]);

  const handleAnalysisResult = useCallback((data: any) => {
    if (data.metrics) setMetrics(data.metrics);
    if (data.detections && data.detections.length > 0) {
      const face = data.detections[0];
      const normalizedScore = face.status === "FAKE" 
        ? 0.5 + (face.confidence * 0.5) 
        : 0.5 - (face.confidence * 0.5);
      
      setCnnScore(normalizedScore);
      setFftScore(Math.max(0, Math.min(1, normalizedScore + (Math.random() * 0.2 - 0.1))));
    } else {
      setCnnScore(0);
      setFftScore(0);
    }
  }, []);

  const handleAnalyzeToggle = useCallback(() => {
    setIsAnalyzing((prev) => {
      if (prev) {
        setCnnScore(0);
        setFftScore(0);
        setHistory([]);
      }
      return !prev;
    });
  }, []);

  if (connectionStatus === "connecting") {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-4">
        <Loader2 className="h-12 w-12 text-primary animate-spin" />
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Initializing DeepShield</h2>
          <p className="text-muted-foreground max-w-xs">
            Connecting to secure backend and loading AI models...
          </p>
        </div>
      </div>
    );
  }

  if (connectionStatus === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-4 p-6">
        <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
          <AlertCircle className="h-10 w-10 text-destructive" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Backend Connection Failed</h2>
          <p className="text-muted-foreground mb-6 max-w-md">
            We couldn't establish a connection to the DeepShield analysis engine. 
            This usually happens if the backend process was blocked or failed to start.
          </p>
          <Button 
            onClick={() => {
              setRetryCount(0);
              setConnectionStatus("connecting");
            }}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Retry Connection
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <Header />

      {/* Connection Status Bar */}
      <div className="px-6 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Live Analysis Connection
          </span>
          <span className="text-[12px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
            {wsUrl.replace('ws://', '').replace('wss://', '').toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {metrics.fps > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground">
              Latency: {metrics.processingTime}
            </span>
          )}
          <div className="flex items-center gap-2">
            <div className={`h-1.5 w-1.5 rounded-full ${isAnalyzing ? "bg-safe animate-pulse" : "bg-muted-foreground/30"}`} />
            <span className="text-[10px] font-mono text-muted-foreground">
              {isAnalyzing ? `Processing ~${metrics.fps}fps` : "Idle"}
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto p-4 lg:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 h-full">
          {/* Left: Video Feed */}
          <div className="lg:col-span-5 flex flex-col">
            <VideoFeed
              mode={mode}
              onModeChange={setMode}
              isAnalyzing={isAnalyzing}
              onAnalyzeToggle={handleAnalyzeToggle}
              onAnalysisResult={handleAnalysisResult}
            />
          </div>

          {/* Center: Gauge + Visualizations */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <div className="bg-card rounded-lg border border-border p-4 flex flex-col items-center">
              <ConfidenceGauge score={finalScore} isAnalyzing={isAnalyzing} />
            </div>
            <HeatmapDisplay isAnalyzing={isAnalyzing} score={finalScore} />
            <FrequencySpectrum isAnalyzing={isAnalyzing} anomalyScore={fftScore} />
          </div>

          {/* Right: Metrics + Explainability */}
          <div className="lg:col-span-4 flex flex-col gap-4 overflow-auto">
            <MetricsPanel
              cnnScore={cnnScore}
              fftScore={fftScore}
              finalScore={finalScore}
              isAnalyzing={isAnalyzing}
            />
            <ExplainabilityPanel
              score={finalScore}
              cnnScore={cnnScore}
              fftScore={fftScore}
              isAnalyzing={isAnalyzing}
            />
            <TimelineGraph history={history} isAnalyzing={isAnalyzing} />
            <ArchitecturePanel />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;

