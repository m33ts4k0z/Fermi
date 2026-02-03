/**
 * Electron Bridge - Integration layer for Electron desktop features
 * 
 * This module provides a unified API for accessing Electron-specific features
 * while maintaining compatibility with the web version.
 */

/**
 * Screen source information from Electron's desktopCapturer
 */
export interface ScreenSource {
    id: string;
    name: string;
    thumbnail: string;
    appIcon: string | null;
    display_id: string;
}

/**
 * Video quality presets for screen sharing (transcode at streamer: capture + encode at these).
 */
export const VideoQualityPresets = {
    '240p': {
        width: { ideal: 426, max: 426 },
        height: { ideal: 240, max: 240 },
        frameRate: { ideal: 30, max: 30 }
    },
    '360p': {
        width: { ideal: 640, max: 640 },
        height: { ideal: 360, max: 360 },
        frameRate: { ideal: 30, max: 30 }
    },
    '480p': {
        width: { ideal: 854, max: 854 },
        height: { ideal: 480, max: 480 },
        frameRate: { ideal: 30, max: 30 }
    },
    '720p': {
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 30, max: 30 }
    },
    '1080p': {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 60 }
    },
    '1440p': {
        width: { ideal: 2560, max: 2560 },
        height: { ideal: 1440, max: 1440 },
        frameRate: { ideal: 30, max: 60 }
    },
    '2160p': {
        width: { ideal: 3840, max: 3840 },
        height: { ideal: 2160, max: 2160 },
        frameRate: { ideal: 30, max: 60 }
    }
} as const;

export type VideoQuality = keyof typeof VideoQualityPresets;

/** Map resolution (width x height) to closest VideoQuality for getDisplayMedia constraints. */
export function resolutionToQuality(resolution?: { width: number; height: number }): VideoQuality {
    if (!resolution?.height) return '720p';
    const h = resolution.height;
    if (h <= 240) return '240p';
    if (h <= 360) return '360p';
    if (h <= 480) return '480p';
    if (h <= 720) return '720p';
    if (h <= 1080) return '1080p';
    if (h <= 1440) return '1440p';
    return '2160p';
}

/**
 * Check if we're running in Electron
 */
export function isElectron(): boolean {
    return typeof window !== 'undefined' && 
           window.fermiDesktop !== undefined && 
           window.fermiDesktop.isElectron === true;
}

/**
 * Get the current platform
 */
export function getPlatform(): string {
    if (isElectron()) {
        return window.fermiDesktop.platform;
    }
    return 'web';
}

/**
 * Get available screen sources for Go Live
 * In Electron: Uses desktopCapturer for native window/screen list
 * In Web: Falls back to getDisplayMedia prompt
 */
export async function getScreenSources(): Promise<ScreenSource[]> {
    if (isElectron()) {
        return await window.fermiDesktop.getScreenSources();
    }
    // Web fallback - return empty array, will use browser prompt
    return [];
}

/**
 * Capture screen/window for streaming
 * Supports both Electron native capture and web getDisplayMedia
 * 
 * @param sourceId - Source ID from getScreenSources (Electron only)
 * @param quality - Video quality preset (default: 720p)
 * @param includeAudio - Whether to capture system audio
 */
export async function captureScreen(
    sourceId?: string,
    quality: VideoQuality = '720p',
    includeAudio: boolean = true
): Promise<MediaStream> {
    const qualityConstraints = VideoQualityPresets[quality];
    console.log('[CaptureScreen] sourceId:', sourceId, 'quality:', quality, 'includeAudio:', includeAudio);
    console.log('[CaptureScreen] isElectron:', isElectron(), 'hasSourceId:', !!sourceId);

    if (isElectron() && sourceId) {
        // Capture directly in renderer using Electron's chromeMediaSource
        // MediaStream can't be passed through contextBridge, so we capture here
        console.log('[CaptureScreen] Using direct Electron capture with chromeMediaSource');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    // @ts-ignore - Electron-specific constraint
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceId,
                        minWidth: qualityConstraints.width.ideal,
                        maxWidth: qualityConstraints.width.max,
                        minHeight: qualityConstraints.height.ideal,
                        maxHeight: qualityConstraints.height.max,
                        minFrameRate: 15,
                        maxFrameRate: qualityConstraints.frameRate.max
                    }
                },
                audio: includeAudio ? {
                    // @ts-ignore - Electron-specific constraint
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceId
                    }
                } : false
            });
            
            console.log('[CaptureScreen] Electron capture successful');
            console.log('[CaptureScreen] Video tracks:', stream.getVideoTracks().length);
            console.log('[CaptureScreen] Audio tracks:', stream.getAudioTracks().length);
            return stream;
        } catch (error) {
            console.error('[CaptureScreen] Electron capture failed:', error);
            // Try video-only fallback
            console.log('[CaptureScreen] Trying video-only fallback...');
            try {
                const videoOnlyStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        // @ts-ignore - Electron-specific constraint
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: sourceId,
                            minWidth: qualityConstraints.width.ideal,
                            maxWidth: qualityConstraints.width.max,
                            minHeight: qualityConstraints.height.ideal,
                            maxHeight: qualityConstraints.height.max,
                            minFrameRate: 15,
                            maxFrameRate: qualityConstraints.frameRate.max
                        }
                    },
                    audio: false
                });
                console.log('[CaptureScreen] Video-only fallback successful');
                return videoOnlyStream;
            } catch (fallbackError) {
                console.error('[CaptureScreen] Video-only fallback also failed:', fallbackError);
                throw fallbackError;
            }
        }
    }

    // Web fallback - use getDisplayMedia
    console.log('[CaptureScreen] Using web getDisplayMedia fallback');
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: qualityConstraints.width,
                height: qualityConstraints.height,
                frameRate: qualityConstraints.frameRate
            },
            audio: includeAudio
        });
        console.log('[CaptureScreen] Web capture result:', stream);
        return stream;
    } catch (error) {
        console.error('[CaptureScreen] Web capture failed:', error);
        throw error;
    }
}

/**
 * Show a screen picker UI
 * In Electron: Returns sources for custom UI
 * In Web: Triggers browser's built-in picker via getDisplayMedia
 * @param quality - Capture resolution/quality (transcode at streamer: getDisplayMedia uses this).
 */
export async function showScreenPicker(quality?: VideoQuality): Promise<MediaStream | null> {
    const q = quality ?? '720p';
    console.log('[ScreenPicker] isElectron:', isElectron(), 'quality:', q);

    if (isElectron()) {
        const sources = await getScreenSources();
        if (sources.length === 0) {
            console.warn('[ScreenPicker] No sources available');
            return null;
        }
        const selectedSource = await showElectronScreenPicker(sources);
        if (!selectedSource) return null;
        try {
            return await captureScreen(selectedSource.id, q, true);
        } catch (error) {
            console.error('[ScreenPicker] Capture failed:', error);
            throw error;
        }
    }

    return await captureScreen(undefined, q, true);
}

/**
 * Create and show the Electron screen picker modal
 * Returns the selected source or null if cancelled
 */
async function showElectronScreenPicker(sources: ScreenSource[]): Promise<ScreenSource | null> {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'screen-picker-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

        // Create modal container
        const modal = document.createElement('div');
        modal.className = 'screen-picker-modal';
        modal.style.cssText = `
            background: var(--primary-bg, #2f3136);
            border-radius: 8px;
            padding: 20px;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
            color: var(--primary-text, #dcddde);
        `;

        // Title
        const title = document.createElement('h2');
        title.textContent = 'Select a Screen or Window to Share';
        title.style.cssText = 'margin: 0 0 16px 0; font-size: 20px;';
        modal.appendChild(title);

        // Separate screens and windows
        const screens = sources.filter(s => s.id.startsWith('screen:'));
        const windows = sources.filter(s => s.id.startsWith('window:'));

        // Add screens section
        if (screens.length > 0) {
            const screensTitle = document.createElement('h3');
            screensTitle.textContent = 'Screens';
            screensTitle.style.cssText = 'margin: 16px 0 8px 0; font-size: 14px; text-transform: uppercase; color: var(--secondary-text, #8e9297);';
            modal.appendChild(screensTitle);

            const screensGrid = createSourceGrid(screens, resolve, overlay);
            modal.appendChild(screensGrid);
        }

        // Add windows section
        if (windows.length > 0) {
            const windowsTitle = document.createElement('h3');
            windowsTitle.textContent = 'Application Windows';
            windowsTitle.style.cssText = 'margin: 16px 0 8px 0; font-size: 14px; text-transform: uppercase; color: var(--secondary-text, #8e9297);';
            modal.appendChild(windowsTitle);

            const windowsGrid = createSourceGrid(windows, resolve, overlay);
            modal.appendChild(windowsGrid);
        }

        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
            margin-top: 16px;
            padding: 10px 20px;
            background: var(--button-secondary-bg, #4f545c);
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        `;
        cancelBtn.onclick = () => {
            overlay.remove();
            resolve(null);
        };
        modal.appendChild(cancelBtn);

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(null);
            }
        };

        // Close on Escape key
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                overlay.remove();
                resolve(null);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    });
}

/**
 * Create a grid of source thumbnails
 */
function createSourceGrid(
    sources: ScreenSource[],
    resolve: (value: ScreenSource | null) => void,
    overlay: HTMLElement
): HTMLElement {
    const grid = document.createElement('div');
    grid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 12px;
    `;

    for (const source of sources) {
        const item = document.createElement('div');
        item.className = 'screen-source-item';
        item.style.cssText = `
            background: var(--secondary-bg, #36393f);
            border-radius: 8px;
            padding: 8px;
            cursor: pointer;
            transition: transform 0.1s, box-shadow 0.1s;
            border: 2px solid transparent;
        `;

        item.onmouseenter = () => {
            item.style.transform = 'scale(1.02)';
            item.style.borderColor = 'var(--accent, #5865f2)';
        };
        item.onmouseleave = () => {
            item.style.transform = 'scale(1)';
            item.style.borderColor = 'transparent';
        };

        // Thumbnail
        const thumbnail = document.createElement('img');
        thumbnail.src = source.thumbnail;
        thumbnail.alt = source.name;
        thumbnail.style.cssText = `
            width: 100%;
            height: 120px;
            object-fit: contain;
            background: #1a1a1a;
            border-radius: 4px;
        `;
        item.appendChild(thumbnail);

        // Name
        const name = document.createElement('div');
        name.textContent = source.name;
        name.style.cssText = `
            margin-top: 8px;
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        item.appendChild(name);

        item.onclick = () => {
            overlay.remove();
            resolve(source);
        };

        grid.appendChild(item);
    }

    return grid;
}

/**
 * Get microphone stream
 */
export async function getMicrophone(): Promise<MediaStream> {
    if (isElectron()) {
        return await window.fermiDesktop.getMicrophone();
    }
    
    return await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        },
        video: false
    });
}

/**
 * Get webcam stream
 */
export async function getWebcam(constraints?: MediaTrackConstraints): Promise<MediaStream> {
    if (isElectron()) {
        return await window.fermiDesktop.getWebcam(constraints);
    }

    const defaultConstraints: MediaTrackConstraints = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
    };

    return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            ...defaultConstraints,
            ...constraints
        }
    });
}

// Type declarations for the fermiDesktop API
declare global {
    interface Window {
        fermiDesktop?: {
            isElectron: boolean;
            platform: string;
            getScreenSources: () => Promise<ScreenSource[]>;
            getSourceById: (sourceId: string) => Promise<ScreenSource | null>;
            captureScreen: (sourceId: string, constraints?: any) => Promise<MediaStream>;
            captureScreenWithAudio: (sourceId: string, includeAudio: boolean) => Promise<MediaStream>;
            showScreenPicker: () => Promise<ScreenSource | null>;
            getMicrophone: () => Promise<MediaStream>;
            getWebcam: (constraints?: MediaTrackConstraints) => Promise<MediaStream>;
            on: (channel: string, callback: (...args: any[]) => void) => void;
            removeListener: (channel: string, callback: (...args: any[]) => void) => void;
            getVersion: () => string;
        };
    }
}
