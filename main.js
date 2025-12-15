const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'MatrixCode_v7.7/favicon.ico'), // Try to pick up an icon if it exists
    backgroundColor: '#000000',
    frame: false, // Frameless for immersive/screensaver feel
    fullscreen: true, // Default to fullscreen
    webPreferences: {
      nodeIntegration: false, // Security: Disable node integration in renderer
      contextIsolation: true, // Security: Enable context isolation
      backgroundThrottling: false // Keep animating even if backgrounded (multi-monitor setup)
    }
  });

  // Load the matrix application
  mainWindow.loadFile('MatrixCode_v7.7/index.html');

  // Optional: Open DevTools
  // mainWindow.webContents.openDevTools();

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // Register 'Escape' key to exit fullscreen/app
  globalShortcut.register('Escape', () => {
    if (mainWindow) {
        // If fullscreen, exit fullscreen first? Or just quit?
        // For a screensaver style app, Quit is usually expected on Escape.
        app.quit();
    }
  });
  
  // Register F11 to toggle fullscreen
  globalShortcut.register('F11', () => {
      if (mainWindow) {
          mainWindow.setFullScreen(!mainWindow.isFullScreen());
      }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});
