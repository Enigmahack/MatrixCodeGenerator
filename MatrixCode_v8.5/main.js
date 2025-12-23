const { app, BrowserWindow, screen } = require('electron');
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
        contextIsolation: false // For simple DOM manipulation if needed, though mostly standard web
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

app.whenReady().then(() => {
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
