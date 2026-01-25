/**
 * Fermi Desktop Client - Preload Script
 * 
 * This script runs in the renderer process before web content loads.
 * It exposes a safe, limited API to the web content via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Screen capture source information
 */
interface ScreenSource {
    id: string;
    name: string;
    thumbnail: string;
    appIcon: string | null;
    display_id: string;
}

/**
 * Video constraints for screen capture
 */
interface VideoConstraints {
    width: { ideal: number; max: number };
    height: { ideal: number; max: number };
    frameRate: { ideal: number; max: number };
}

/**
 * Fermi Desktop API
 * This object is exposed to the renderer process as window.fermiDesktop
 */
const fermiDesktopAPI = {
    /**
     * Check if running in Electron
     */
    isElectron: true,

    /**
     * Get platform information
     */
    platform: process.platform,

    /**
     * Get available screen capture sources for Go Live
     * Returns a list of windows and screens that can be captured
     */
    getScreenSources: async (): Promise<ScreenSource[]> => {
        return await ipcRenderer.invoke('get-sources');
    },

    /**
     * Get a specific screen source by ID
     */
    getSourceById: async (sourceId: string): Promise<ScreenSource | null> => {
        return await ipcRenderer.invoke('get-source-by-id', sourceId);
    },

    /**
     * Start screen capture with the given source ID
     * Returns a MediaStream that can be used for Go Live streaming
     * 
     * @param sourceId - The ID of the source to capture (from getScreenSources)
     * @param constraints - Optional video constraints for quality settings
     */
    captureScreen: async (
        sourceId: string,
        constraints?: Partial<VideoConstraints>
    ): Promise<MediaStream> => {
        // Default constraints for 720p H.264 streaming
        const defaultConstraints: VideoConstraints = {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 60 }
        };

        const videoConstraints = {
            ...defaultConstraints,
            ...constraints
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    // Capture system audio if available
                    // @ts-ignore - Electron-specific constraint
                    mandatory: {
                        chromeMediaSource: 'desktop'
                    }
                },
                video: {
                    // @ts-ignore - Electron-specific constraint
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceId,
                        minWidth: 640,
                        maxWidth: videoConstraints.width.max,
                        minHeight: 480,
                        maxHeight: videoConstraints.height.max,
                        minFrameRate: 15,
                        maxFrameRate: videoConstraints.frameRate.max
                    }
                }
            });

            return stream;
        } catch (error) {
            console.error('Screen capture failed:', error);
            throw error;
        }
    },

    /**
     * Capture screen with audio (for streaming with system sound)
     * 
     * @param sourceId - The ID of the source to capture
     * @param includeAudio - Whether to include system audio
     */
    captureScreenWithAudio: async (
        sourceId: string,
        includeAudio: boolean = true
    ): Promise<MediaStream> => {
        console.log('captureScreenWithAudio called with sourceId:', sourceId, 'includeAudio:', includeAudio);
        
        try {
            // Capture video and audio together in one call (more reliable on Windows)
            console.log('Attempting to capture video + audio together...');
            
            const constraints: MediaStreamConstraints = {
                video: {
                    // @ts-ignore - Electron-specific constraint
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceId,
                        minWidth: 1280,
                        maxWidth: 1920,
                        minHeight: 720,
                        maxHeight: 1080,
                        minFrameRate: 15,
                        maxFrameRate: 30
                    }
                },
                audio: includeAudio ? {
                    // @ts-ignore - Electron-specific constraint  
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceId
                    }
                } : false
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            console.log('Stream obtained:', stream);
            console.log('Video tracks:', stream.getVideoTracks().length);
            console.log('Audio tracks:', stream.getAudioTracks().length);
            
            if (stream.getVideoTracks().length > 0) {
                console.log('Video track settings:', stream.getVideoTracks()[0]?.getSettings());
            }
            if (stream.getAudioTracks().length > 0) {
                console.log('Audio track settings:', stream.getAudioTracks()[0]?.getSettings());
            }

            return stream;
        } catch (error) {
            console.error('Screen capture failed:', error);
            
            // If combined capture fails, try video-only as fallback
            console.log('Trying video-only fallback...');
            try {
                const videoOnlyStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        // @ts-ignore - Electron-specific constraint
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: sourceId,
                            minWidth: 1280,
                            maxWidth: 1920,
                            minHeight: 720,
                            maxHeight: 1080,
                            minFrameRate: 15,
                            maxFrameRate: 30
                        }
                    }
                });
                console.log('Video-only fallback successful');
                return videoOnlyStream;
            } catch (fallbackError) {
                console.error('Video-only fallback also failed:', fallbackError);
                throw fallbackError;
            }
        }
    },

    /**
     * Show a native screen picker dialog
     * This provides a better UX than the browser's built-in picker
     */
    showScreenPicker: async (): Promise<ScreenSource | null> => {
        const sources = await ipcRenderer.invoke('get-sources');
        
        // The actual picker UI should be implemented in the renderer
        // This just returns the sources for the web app to display
        if (sources.length > 0) {
            // Return first source as default (usually the primary screen)
            return sources[0];
        }
        return null;
    },

    /**
     * Get microphone access
     */
    getMicrophone: async (): Promise<MediaStream> => {
        return await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
    },

    /**
     * Get webcam access
     */
    getWebcam: async (constraints?: MediaTrackConstraints): Promise<MediaStream> => {
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
    },

    /**
     * Listen for events from the main process
     */
    on: (channel: string, callback: (...args: any[]) => void): void => {
        const validChannels = ['open-settings', 'notification'];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (_event, ...args) => callback(...args));
        }
    },

    /**
     * Remove event listener
     */
    removeListener: (channel: string, callback: (...args: any[]) => void): void => {
        const validChannels = ['open-settings', 'notification'];
        if (validChannels.includes(channel)) {
            ipcRenderer.removeListener(channel, callback);
        }
    },

    /**
     * Get app version
     */
    getVersion: (): string => {
        return process.env.npm_package_version || '1.0.0';
    }
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('fermiDesktop', fermiDesktopAPI);

// Type declaration for TypeScript support in the renderer
declare global {
    interface Window {
        fermiDesktop: typeof fermiDesktopAPI;
    }
}

// Log that preload script has loaded
console.log('Fermi Desktop preload script loaded');
