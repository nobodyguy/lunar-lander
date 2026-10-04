// Keeps the screen on while the game is in view, so it doesn't dim between
// touches or during a long force sensor session. The browser drops the lock
// whenever the page is hidden, so it's taken again on return, and Safari
// can refuse it until the first tap, so every tap retries while it's missing.
export const keepScreenOn = () => {
  if (!("wakeLock" in navigator)) return;

  let sentinel = null;
  let requesting = false;

  const request = async () => {
    if (sentinel || requesting || document.visibilityState !== "visible") {
      return;
    }
    requesting = true;
    try {
      sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", () => {
        sentinel = null;
      });
    } catch {
      // Denied (battery saver, no gesture yet); the next attempt may succeed
    } finally {
      requesting = false;
    }
  };

  request();
  document.addEventListener("visibilitychange", request);
  document.addEventListener("pointerdown", request);
  document.addEventListener("keydown", request);
};
