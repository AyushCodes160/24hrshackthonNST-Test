const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

let mainWindow;
let pythonProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "DeepShield Control Center",
    show: false, // Don't show until ready-to-show
  });

  // Load the compiled React frontend
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    mainWindow.loadFile(path.join(app.getAppPath(), "dist/index.html"));
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", function () {
    mainWindow = null;
  });
}

function checkBackendHealth(onReady) {
  const options = {
    hostname: "127.0.0.1",
    port: 8005,
    path: "/health",
    method: "GET",
    timeout: 2000,
  };

  const startTime = Date.now();
  const timeoutMs = 45000; // Wait up to 45 seconds for models to load

  const poll = () => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (result.status === "ok" && result.detector_loaded) {
            console.log("Backend is ready!");
            onReady();
          } else {
            // Backend responded but detector not ready yet
            setTimeout(poll, 1000);
          }
        } catch (e) {
          setTimeout(poll, 1000);
        }
      });
    });

    req.on("error", () => {
      if (Date.now() - startTime > timeoutMs) {
        dialog.showErrorBox(
          "Connection Error",
          "The DeepShield backend failed to initialize within the expected time. Please restart the application.",
        );
        app.quit();
      } else {
        setTimeout(poll, 1000);
      }
    });

    req.end();
  };

  poll();
}

function startPythonBackend() {
  let script;
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    script = path.join(process.resourcesPath, "backend/dist/api/api");
  } else {
    script = path.join(__dirname, "../backend/dist/api/api");
  }

  if (process.platform === "win32") {
    script += ".exe";
  }

  console.log(`Starting Python backend at: ${script}`);
  const backendDir = path.dirname(script);

  pythonProcess = spawn(script, ["--host", "127.0.0.1", "--port", "8005"], {
    cwd: backendDir,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  pythonProcess.stdout.on("data", (data) => {
    console.log(`Python: ${data}`);
  });

  pythonProcess.stderr.on("data", (data) => {
    console.error(`Python Error: ${data}`);
  });

  pythonProcess.on("close", (code) => {
    console.log(`Python process exited with code ${code}`);
    if (code !== 0 && code !== null) {
      dialog.showErrorBox(
        "Backend Error",
        `The DeepShield backend process exited unexpectedly with code ${code}.`,
      );
    }
  });
}

app.whenReady().then(() => {
  startPythonBackend();
  // Poll until the health check passes before showing the window
  checkBackendHealth(createWindow);

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  if (pythonProcess) {
    console.log("Killing Python backend...");
    pythonProcess.kill();
  }
});
