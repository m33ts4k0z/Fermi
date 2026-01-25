/**
 * Fermi Desktop Client - Electron Main Process
 *
 * This is the main entry point for the Electron desktop application.
 * It creates the browser window and handles native OS integration.
 */
import { app, BrowserWindow, ipcMain, desktopCapturer, session, Menu, Tray, nativeImage, shell, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Get the webpage directory path
function getWebpagePath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'webpage');
    }
    return path.join(__dirname, '../dist/webpage');
}
// ===========================================
// Hardware Video Acceleration Configuration
// ===========================================
// Enable hardware acceleration for video encoding/decoding
// Supports NVENC (NVIDIA), AMF (AMD), QuickSync (Intel)
// Don't disable hardware acceleration
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-video-encode');
// Ignore GPU blocklist to enable hardware accel on more systems
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Enable GPU rasterization for better performance
app.commandLine.appendSwitch('enable-gpu-rasterization');
// Enable zero-copy video capture (better performance)
app.commandLine.appendSwitch('enable-zero-copy');
// Enable native GPU memory buffers for better video performance
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
// Enable hardware overlays
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay');
// WebRTC specific optimizations
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,' + // VAAPI (Linux/Intel)
    'VaapiVideoEncoder,' + // VAAPI encoder
    'CanvasOopRasterization,' + // Out-of-process canvas rasterization
    'WebRTCPipeWireCapturer' // Better screen capture on Linux
);
// Use ANGLE for better GPU compatibility on Windows
if (process.platform === 'win32') {
    app.commandLine.appendSwitch('use-angle', 'default');
}
// Handle Squirrel events for Windows installer
// This must be at the top before any other code runs
const handleSquirrelEvent = () => {
    if (process.platform !== 'win32') {
        return false;
    }
    const squirrelCommand = process.argv[1];
    switch (squirrelCommand) {
        case '--squirrel-install':
        case '--squirrel-updated':
        case '--squirrel-uninstall':
        case '--squirrel-obsolete':
            app.quit();
            return true;
        default:
            return false;
    }
};
if (handleSquirrelEvent()) {
    process.exit(0);
}
// Keep a global reference of the window object to prevent garbage collection
let mainWindow = null;
let tray = null;
// Determine if we're in development or production
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
// App configuration
const APP_NAME = 'Fermi';
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const MIN_WIDTH = 940;
const MIN_HEIGHT = 500;
/**
 * Create the main application window
 */
function createWindow() {
    // Create the browser window with optimized settings for video streaming
    mainWindow = new BrowserWindow({
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        title: APP_NAME,
        icon: getIconPath(),
        backgroundColor: '#1a1a2e',
        show: false, // Don't show until ready
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false, // Required for screen capture
            webSecurity: true,
            // Enable features needed for WebRTC
            backgroundThrottling: false, // Keep WebRTC active in background
        },
        // Frame settings
        frame: true,
        autoHideMenuBar: true,
    });
    // Configure Content Security Policy for WebRTC
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self' app: 'unsafe-inline' 'unsafe-eval' data: blob: ws: wss: https: http:; " +
                        "media-src 'self' app: blob: data: https: http:; " +
                        "connect-src 'self' app: ws: wss: https: http: blob:; " +
                        "script-src 'self' app: 'unsafe-inline' 'unsafe-eval';"
                ]
            }
        });
    });
    // Load the app
    if (isDev) {
        // In development, load from the local dev server
        mainWindow.loadURL('http://localhost:8080/login');
        mainWindow.webContents.openDevTools();
    }
    else {
        // In production, use the app:// protocol which handles absolute paths correctly
        mainWindow.loadURL('app://./login.html');
    }
    // Show window when ready to prevent visual flash
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        mainWindow?.focus();
    });
    // Handle window closed
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    // Handle minimize to tray (optional)
    mainWindow.on('minimize', () => {
        // To enable minimize to tray, uncomment below and use:
        // mainWindow?.hide();
    });
    // Set up the application menu
    setupMenu();
}
/**
 * Get the path to the application icon
 */
function getIconPath() {
    const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
    // Try assets folder (development)
    const devIconPath = path.join(__dirname, '../assets', iconName);
    if (fs.existsSync(devIconPath)) {
        return devIconPath;
    }
    // Try production paths
    if (!isDev) {
        // Try favicon from extraResources
        const prodFaviconPath = path.join(process.resourcesPath, 'webpage', 'favicon.ico');
        if (fs.existsSync(prodFaviconPath)) {
            return prodFaviconPath;
        }
    }
    // Fallback to favicon in dist (development)
    const faviconPath = path.join(__dirname, '../dist/webpage/favicon.ico');
    if (fs.existsSync(faviconPath)) {
        return faviconPath;
    }
    return '';
}
/**
 * Set up the application menu
 */
function setupMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Settings',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => {
                        mainWindow?.webContents.send('open-settings');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'close' }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}
/**
 * Set up system tray (optional)
 */
function setupTray() {
    const iconPath = getIconPath();
    if (!iconPath)
        return;
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Fermi',
            click: () => {
                mainWindow?.show();
                mainWindow?.focus();
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            }
        }
    ]);
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
        mainWindow?.show();
        mainWindow?.focus();
    });
}
// ===========================================
// IPC Handlers for Screen Capture
// ===========================================
/**
 * Set up display media request handler for getDisplayMedia support
 * This is required in Electron 17+ for screen sharing to work properly
 */
function setupDisplayMediaHandler() {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        console.log('[DisplayMedia] Request received');
        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen', 'window'],
                thumbnailSize: { width: 320, height: 180 }
            });
            console.log('[DisplayMedia] Available sources:', sources.length);
            // For now, auto-select the first screen
            // The custom picker in the renderer handles the actual selection
            if (sources.length > 0) {
                console.log('[DisplayMedia] Granting access to:', sources[0].name);
                callback({ video: sources[0] });
            }
            else {
                console.log('[DisplayMedia] No sources available');
                callback({});
            }
        }
        catch (error) {
            console.error('[DisplayMedia] Error:', error);
            callback({});
        }
    });
}
/**
 * Get available screen capture sources
 * This is used for the "Go Live" feature to let users pick what to share
 */
ipcMain.handle('get-sources', async () => {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 320, height: 180 },
            fetchWindowIcons: true
        });
        return sources.map(source => ({
            id: source.id,
            name: source.name,
            thumbnail: source.thumbnail.toDataURL(),
            appIcon: source.appIcon?.toDataURL() || null,
            display_id: source.display_id
        }));
    }
    catch (error) {
        console.error('Error getting sources:', error);
        return [];
    }
});
/**
 * Get a specific source by ID
 */
ipcMain.handle('get-source-by-id', async (_event, sourceId) => {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });
        const source = sources.find(s => s.id === sourceId);
        if (source) {
            return {
                id: source.id,
                name: source.name,
                display_id: source.display_id
            };
        }
        return null;
    }
    catch (error) {
        console.error('Error getting source:', error);
        return null;
    }
});
// ===========================================
// App Lifecycle Events
// ===========================================
// Squirrel events are handled at the top of the file
// Register custom app:// protocol for serving local files
// This handles absolute paths like /style.css correctly
// And SPA routing for paths like /channels/@me
function registerAppProtocol() {
    protocol.registerFileProtocol('app', (request, callback) => {
        const webpageDir = getWebpagePath();
        const url = new URL(request.url);
        // Handle both app://./path and app:///path formats
        let filePath = decodeURIComponent(url.pathname);
        // Also check hostname in case path is in there (app://./file.html)
        if (url.hostname && url.hostname !== '.' && url.hostname !== 'localhost') {
            filePath = url.hostname + filePath;
        }
        // Remove leading slash for path joining
        if (filePath.startsWith('/')) {
            filePath = filePath.slice(1);
        }
        // Remove leading ./ if present
        if (filePath.startsWith('./')) {
            filePath = filePath.slice(2);
        }
        let fullPath = path.join(webpageDir, filePath);
        // SPA routing: if file doesn't exist and it's not a static asset, serve app.html
        // This handles routes like /channels/@me, /guilds/123, etc.
        if (!fs.existsSync(fullPath)) {
            // Check if it's a client-side route (not a file with extension)
            const hasExtension = path.extname(filePath).length > 0;
            if (!hasExtension) {
                // It's a SPA route, serve app.html
                fullPath = path.join(webpageDir, 'app.html');
                console.log('[Protocol] SPA route:', request.url, '-> app.html');
            }
            else {
                console.log('[Protocol] File not found:', request.url, '->', fullPath);
            }
        }
        else {
            console.log('[Protocol] Resolving:', request.url, '->', fullPath);
        }
        callback(fullPath);
    });
}
// Register the app:// protocol as privileged (must be done before app ready)
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'app',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true
        }
    }
]);
// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
    // Register the custom protocol before creating windows
    registerAppProtocol();
    // Set up display media handler for screen capture
    setupDisplayMediaHandler();
    createWindow();
    // setupTray(); // Uncomment to enable system tray
    // On macOS, re-create window when dock icon is clicked
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
// Handle certificate errors (for self-signed certs in development)
app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
    if (isDev) {
        // In development, accept self-signed certificates
        event.preventDefault();
        callback(true);
    }
    else {
        callback(false);
    }
});
// Prevent new window creation (open links in default browser instead)
app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
        // Open external links in default browser
        shell.openExternal(url);
        return { action: 'deny' };
    });
});
// Clean up on quit
app.on('before-quit', () => {
    if (tray) {
        tray.destroy();
        tray = null;
    }
});
//# sourceMappingURL=main.js.map