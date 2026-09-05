/**
 * A short beep through WebAudio — no asset, no permission, no Notification
 * API (flaky inside Android WebViews). The sign-in tap already satisfied
 * the autoplay policy; where it did not, silence is not a fault.
 */
export function chime(): void {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.4);
    oscillator.onended = (): void => {
      void context.close();
    };
  } catch {
    // No audio here — the screen still tells the story.
  }
  try {
    navigator.vibrate?.(200);
  } catch {
    // Same: vibration is a courtesy, not a requirement.
  }
}
