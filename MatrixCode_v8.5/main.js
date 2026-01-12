const { app, BrowserWindow, screen, session } = require('electron');
const path = require('path');

function createWindows() {
  const displays = screen.getAllDisplays();

  displays.forEach((display) => {
    let window = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      fullscreen: true,
      frame: false, // Frameless for immersive effect
      backgroundColor: '#000000',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false, // For simple DOM manipulation if needed, though mostly standard web
        backgroundThrottling: false // Prevent freezing when not focused
      }
    });

    window.loadFile('index.html');
    
    // Optional: Open DevTools for debugging
    // window.webContents.openDevTools();

    window.on('closed', () => {
      window = null;
    });
  });
}

// IPC Handlers
const fs = require('fs');
const { ipcMain } = require('electron');

ipcMain.on('save-patterns', (event, patterns) => {
    try {
        const filePath = path.join(__dirname, 'js', 'effects', 'QuantizedPatterns.js');
        const content = `window.matrixPatterns = ${JSON.stringify(patterns, null, 4)};`;
        fs.writeFileSync(filePath, content);
        // console.log("Patterns saved to:", filePath);
    } catch (err) {
        console.error("Failed to save patterns:", err);
    }
});

app.whenReady().then(() => {
  // Enable SharedArrayBuffer support via Headers
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp']
      }
    });
  });

  createWindows();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindows();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
