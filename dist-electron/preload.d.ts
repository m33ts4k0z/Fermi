/**
 * Fermi Desktop Client - Preload Script
 *
 * This script runs in the renderer process before web content loads.
 * It exposes a safe, limited API to the web content via contextBridge.
 */
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
    width: {
        ideal: number;
        max: number;
    };
    height: {
        ideal: number;
        max: number;
    };
    frameRate: {
        ideal: number;
        max: number;
    };
}
/**
 * Fermi Desktop API
 * This object is exposed to the renderer process as window.fermiDesktop
 */
declare const fermiDesktopAPI: {
    /**
     * Check if running in Electron
     */
    isElectron: boolean;
    /**
     * Get platform information
     */
    platform: NodeJS.Platform;
    /**
     * Get available screen capture sources for Go Live
     * Returns a list of windows and screens that can be captured
     */
    getScreenSources: () => Promise<ScreenSource[]>;
    /**
     * Get a specific screen source by ID
     */
    getSourceById: (sourceId: string) => Promise<ScreenSource | null>;
    /**
     * Start screen capture with the given source ID
     * Returns a MediaStream that can be used for Go Live streaming
     *
     * @param sourceId - The ID of the source to capture (from getScreenSources)
     * @param constraints - Optional video constraints for quality settings
     */
    captureScreen: (sourceId: string, constraints?: Partial<VideoConstraints>) => Promise<MediaStream>;
    /**
     * Capture screen with audio (for streaming with system sound)
     *
     * @param sourceId - The ID of the source to capture
     * @param includeAudio - Whether to include system audio
     */
    captureScreenWithAudio: (sourceId: string, includeAudio?: boolean) => Promise<MediaStream>;
    /**
     * Show a native screen picker dialog
     * This provides a better UX than the browser's built-in picker
     */
    showScreenPicker: () => Promise<ScreenSource | null>;
    /**
     * Get microphone access
     */
    getMicrophone: () => Promise<MediaStream>;
    /**
     * Get webcam access
     */
    getWebcam: (constraints?: MediaTrackConstraints) => Promise<MediaStream>;
    /**
     * Listen for events from the main process
     */
    on: (channel: string, callback: (...args: any[]) => void) => void;
    /**
     * Remove event listener
     */
    removeListener: (channel: string, callback: (...args: any[]) => void) => void;
    /**
     * Get app version
     */
    getVersion: () => string;
};
declare global {
    interface Window {
        fermiDesktop: typeof fermiDesktopAPI;
    }
}
export {};
//# sourceMappingURL=preload.d.ts.map