# Fermi Desktop Assets

This directory contains assets for building the Fermi desktop application.

## Required Files

### Windows
- `icon.ico` - Application icon (256x256 recommended, multi-resolution ICO)

### macOS
- `icon.icns` - Application icon in ICNS format

### Linux
- `icons/` - Directory containing PNG icons at various sizes:
  - `16x16.png`
  - `32x32.png`
  - `48x48.png`
  - `64x64.png`
  - `128x128.png`
  - `256x256.png`
  - `512x512.png`

## Creating Icons

You can use the existing `favicon.ico` from `src/webpage/favicon.ico` as a starting point.

### Converting to ICO (Windows)
Use a tool like ImageMagick or an online converter to create a multi-resolution ICO file:
```bash
convert logo.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

### Converting to ICNS (macOS)
```bash
# Create iconset directory
mkdir icon.iconset
sips -z 16 16 logo.png --out icon.iconset/icon_16x16.png
sips -z 32 32 logo.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 logo.png --out icon.iconset/icon_32x32.png
sips -z 64 64 logo.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 logo.png --out icon.iconset/icon_128x128.png
sips -z 256 256 logo.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 logo.png --out icon.iconset/icon_256x256.png
sips -z 512 512 logo.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 logo.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 logo.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
```

## Placeholder

Until you create custom icons, the build will use the favicon from the web application.
