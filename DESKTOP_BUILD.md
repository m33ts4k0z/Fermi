# Building Fermi Desktop Client

This guide explains how to build the Fermi desktop client for Windows.

## Prerequisites

1. **Node.js** 18.x or later
2. **npm** 9.x or later
3. **Git**

## Quick Start

```bash
# Clone and enter the repository
cd Fermi

# Install dependencies
npm install

# Build for Windows (creates installer and portable)
npm run dist:win
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build web version only |
| `npm run build:electron` | Build Electron main process |
| `npm run build:all` | Build both web and Electron |
| `npm run start:electron` | Build and run in Electron (development) |
| `npm run dev:electron` | Run dev server + Electron concurrently |
| `npm run pack` | Package without creating installer |
| `npm run dist` | Create distributable for current platform |
| `npm run dist:win` | Create Windows installer (.exe) |
| `npm run dist:win:portable` | Create Windows portable version |

## Build Output

After running `npm run dist:win`, you'll find the builds in the `release/` directory:

```
release/
├── Fermi-0.2.0-x64.exe      # NSIS installer
├── Fermi-0.2.0-portable.exe  # Portable version
└── win-unpacked/             # Unpacked application
```

## Configuration

### App Icon

Place your icon files in the `assets/` directory:
- `icon.ico` for Windows (256x256 multi-resolution ICO)

See `assets/README.md` for icon creation instructions.

### Build Settings

Edit `package.json` under the `"build"` key to customize:
- Application ID
- Output directories
- Installer options
- Target platforms

## Features Specific to Desktop

The desktop version includes:

1. **Native Screen Capture**: Uses Electron's `desktopCapturer` for smooth screen sharing without browser prompts.

2. **System Audio Capture**: Can capture system audio on Windows for streaming.

3. **Background Operation**: WebRTC connections stay active when the window is minimized.

4. **Native Notifications**: Uses OS-native notification system.

## Troubleshooting

### Build fails with "Cannot find module 'electron'"
```bash
npm install --save-dev electron electron-builder
```

### Screen capture doesn't work
Ensure you're running the packaged app, not via `electron .` directly.

### WebRTC issues
Check that your firewall allows UDP traffic on ports 10000-20000.

## Development

For development with hot reload:

```bash
# Terminal 1: Start web dev server
npm run start

# Terminal 2: Start Electron (after server is ready)
npm run start:electron
```

Or use the combined command:
```bash
npm run dev:electron
```

## Code Signing (Production)

For production releases, you should code sign your application:

### Windows
Set these environment variables:
```
CSC_LINK=path/to/certificate.pfx
CSC_KEY_PASSWORD=your_password
```

Or configure in `package.json`:
```json
"win": {
  "certificateFile": "path/to/cert.pfx",
  "certificatePassword": "password"
}
```

## Architecture

```
Fermi/
├── electron/
│   ├── main.ts         # Electron main process
│   ├── preload.ts      # IPC bridge (contextBridge)
│   └── tsconfig.json   # TypeScript config for Electron
├── src/
│   └── webpage/
│       ├── voice.ts    # WebRTC implementation
│       └── utils/
│           └── electronBridge.ts  # Electron API wrapper
├── dist/               # Built web files
├── dist-electron/      # Built Electron files
├── release/            # Final builds
└── assets/
    └── icon.ico        # Application icon
```

## H.264 Video Streaming

The client is configured for H.264 720p streaming by default:
- Resolution: 1280x720
- Frame rate: 30fps
- Bitrate: Auto (adaptive)

This is handled in `voice.ts` and can be adjusted in `electronBridge.ts`.
