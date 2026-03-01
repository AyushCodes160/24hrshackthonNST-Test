const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

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
  });

  // Load the compiled React frontend
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    mainWindow.loadFile(path.join(app.getAppPath(), "dist/index.html"));
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", function () {
    mainWindow = null;
  });
}

function startPythonBackend() {
  // In production, the python executable is packaged alongside the app in a specific Resources folder
  let script;
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    // When packaged,Resources is one level up from the app.asar
    script = path.join(process.resourcesPath, "backend/dist/api/api");
  } else {
    script = path.join(__dirname, "../backend/dist/api/api");
  }

  // If running on windows, the executable has a .exe extension
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
  });
}

app.whenReady().then(() => {
  startPythonBackend();
  // Give the python server 2-3 seconds to load the PyTorch models before showing the UI
  setTimeout(createWindow, 3000);

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// Clean up the Python background process when Electron quits
app.on("will-quit", () => {
  if (pythonProcess) {
    console.log("Killing Python backend...");
    pythonProcess.kill();
  }
});
