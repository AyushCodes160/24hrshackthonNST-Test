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
        const logPath = path.join(app.getPath("userData"), "backend_debug.log");
        dialog.showErrorBox(
          "Connection Error",
          `The DeepShield backend failed to initialize within the expected time.\n\nPlease check the logs for details: ${logPath}`,
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
  const fs = require("fs");
  const logPath = path.join(app.getPath("userData"), "backend_debug.log");

  // Clear old logs
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
  fs.appendFileSync(
    logPath,
    `[INIT] Starting Backend at ${new Date().toISOString()}\n`,
  );
  fs.appendFileSync(logPath, `[PATH] Script: ${script}\n`);
  fs.appendFileSync(logPath, `[DIR] CWD: ${backendDir}\n`);

  // Ensure the binary is executable (important for shared DMGs)
  try {
    if (process.platform !== "win32") {
      fs.chmodSync(script, "755");
      fs.appendFileSync(logPath, `[PERM] Applied chmod 755 to ${script}\n`);
    }
  } catch (err) {
    fs.appendFileSync(logPath, `[PERM_ERROR] ${err.message}\n`);
  }

  try {
    pythonProcess = spawn(script, ["--host", "127.0.0.1", "--port", "8005"], {
      cwd: backendDir,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    pythonProcess.stdout.on("data", (data) => {
      const msg = data.toString();
      console.log(`Python: ${msg}`);
      fs.appendFileSync(logPath, `[STDOUT] ${msg}`);
    });

    pythonProcess.stderr.on("data", (data) => {
      const msg = data.toString();
      console.error(`Python Error: ${msg}`);
      fs.appendFileSync(logPath, `[STDERR] ${msg}`);
    });

    pythonProcess.on("error", (err) => {
      console.error("Failed to start backend process:", err);
      fs.appendFileSync(logPath, `[SPAWN_ERROR] ${err.message}\n`);
    });

    pythonProcess.on("close", (code) => {
      console.log(`Python process exited with code ${code}`);
      fs.appendFileSync(
        logPath,
        `[EXIT] Code ${code} at ${new Date().toISOString()}\n`,
      );
      if (code !== 0 && code !== null) {
        dialog.showErrorBox(
          "Backend Engine Error",
          `The analysis engine exited unexpectedly (Code: ${code}).\n\nPlease check the logs for details: ${logPath}`,
        );
      }
    });
  } catch (err) {
    fs.appendFileSync(logPath, `[FATAL] ${err.message}\n`);
  }
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
