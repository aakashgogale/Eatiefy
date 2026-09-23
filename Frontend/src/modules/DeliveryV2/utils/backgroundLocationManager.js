/**
 * Background Location Anti-Throttling Manager for Android & iOS.
 *
 * Prevents OS throttling of location tracking when the screen locks or when the rider
 * switches to external turn-by-turn navigation apps (e.g., Google Maps / Apple Maps).
 *
 * Strategies:
 * 1. Screen Wake Lock API (keeps device screen awake while active delivery or online).
 * 2. Silent Web Audio loop (maintains audio background session on iOS Safari & Android Chrome).
 * 3. Visibility Change Re-sync (forces immediate high-accuracy fix upon app resume).
 * 4. Native Bridge hooks for Capacitor / Cordova foreground service if running in hybrid shell.
 * 5. Geolocation Permission status observer.
 */

class BackgroundLocationManager {
  constructor() {
    this.wakeLockSentinel = null;
    this.audioContext = null;
    this.silentSource = null;
    this.isActive = false;
    this.visibilityListener = null;
    this.permissionStatus = null;
    this.onResumeCallback = null;
  }

  /**
   * Start anti-throttling mechanisms when tracking is enabled.
   */
  start({ onResume = null } = {}) {
    if (this.isActive) return;
    this.isActive = true;
    this.onResumeCallback = onResume;

    this.requestWakeLock();
    this.startAudioKeepAlive();
    this.setupVisibilityListener();
    this.checkPermissionStatus();
    this.enableNativeBackgroundService();
  }

  /**
   * Stop anti-throttling mechanisms when tracking is disabled (e.g. rider went offline).
   */
  stop() {
    this.isActive = false;
    this.releaseWakeLock();
    this.stopAudioKeepAlive();
    this.teardownVisibilityListener();
    this.disableNativeBackgroundService();
    this.onResumeCallback = null;
  }

  /**
   * 1. Screen Wake Lock (W3C Screen Wake Lock API)
   */
  async requestWakeLock() {
    if (typeof navigator === 'undefined' || !navigator.wakeLock || !this.isActive) return;
    try {
      if (document.visibilityState !== 'visible') return;
      this.wakeLockSentinel = await navigator.wakeLock.request('screen');
      this.wakeLockSentinel.addEventListener('release', () => {
        this.wakeLockSentinel = null;
      });
    } catch (err) {
      // Non-critical: wake lock might be denied due to battery saver
    }
  }

  releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        this.wakeLockSentinel.release();
      } catch {}
      this.wakeLockSentinel = null;
    }
  }

  /**
   * 2. Silent Web Audio loop
   * Prevents iOS Safari & Android Chrome from aggressively clamping timers and
   * suspending watchPosition when rider switches to Google Maps.
   */
  startAudioKeepAlive() {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioContext) {
        this.audioContext = new AudioCtx();
      }

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      if (!this.silentSource) {
        // Create 1 second of near-silent buffer (volume 0.0001)
        const buffer = this.audioContext.createBuffer(1, this.audioContext.sampleRate, this.audioContext.sampleRate);
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 0.0001; // Inaudible to human ear
        gainNode.connect(this.audioContext.destination);

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gainNode);
        source.start(0);
        this.silentSource = source;
      }
    } catch (err) {
      // Audio autoplay policy might require user interaction; handled gracefully
    }
  }

  stopAudioKeepAlive() {
    if (this.silentSource) {
      try {
        this.silentSource.stop();
        this.silentSource.disconnect();
      } catch {}
      this.silentSource = null;
    }
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
  }

  /**
   * 3. Visibility Change Listener: re-acquires wake lock and triggers fresh GPS fix on resume.
   */
  setupVisibilityListener() {
    if (typeof document === 'undefined') return;
    this.visibilityListener = () => {
      if (document.visibilityState === 'visible' && this.isActive) {
        this.requestWakeLock();
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
        if (typeof this.onResumeCallback === 'function') {
          this.onResumeCallback();
        }
      }
    };
    document.addEventListener('visibilitychange', this.visibilityListener);
  }

  teardownVisibilityListener() {
    if (this.visibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
  }

  /**
   * 4. Geolocation Permission status observer
   */
  async checkPermissionStatus() {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      this.permissionStatus = status;
      status.onchange = () => {
        if (status.state === 'granted' && this.isActive && typeof this.onResumeCallback === 'function') {
          this.onResumeCallback();
        }
      };
    } catch {}
  }

  /**
   * 5. Native Container Bridge (Capacitor / Cordova / React Native)
   * Activates native foreground service notification on Android and background location on iOS
   * if the app is bundled within a hybrid mobile wrapper.
   */
  enableNativeBackgroundService() {
    if (typeof window === 'undefined') return;

    // Check for Capacitor Background Mode / Foreground Service
    if (window.Capacitor?.Plugins?.BackgroundMode) {
      try {
        window.Capacitor.Plugins.BackgroundMode.enable();
      } catch {}
    }

    // Check for Cordova Background Mode
    if (window.cordova?.plugins?.backgroundMode) {
      try {
        const bg = window.cordova.plugins.backgroundMode;
        bg.enable();
        bg.setDefaults({
          title: 'Eatiefy Delivery Active',
          text: 'Tracking delivery route in real-time',
          icon: 'icon',
          color: 'D91F3A',
          silent: true,
        });
      } catch {}
    }
  }

  disableNativeBackgroundService() {
    if (typeof window === 'undefined') return;

    if (window.Capacitor?.Plugins?.BackgroundMode) {
      try {
        window.Capacitor.Plugins.BackgroundMode.disable();
      } catch {}
    }

    if (window.cordova?.plugins?.backgroundMode) {
      try {
        window.cordova.plugins.backgroundMode.disable();
      } catch {}
    }
  }
}

export const backgroundLocationManager = new BackgroundLocationManager();
export default backgroundLocationManager;
