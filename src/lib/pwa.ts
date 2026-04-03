export type MobileOs = "ios" | "android" | "other";

function hasWindow() {
  return typeof window !== "undefined";
}

export async function registerServiceWorker() {
  if (!hasWindow() || !("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.error("Service worker registration failed:", error);
  }
}

export function isRunningAsInstalledApp() {
  if (!hasWindow()) return false;

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (typeof navigator !== "undefined" &&
      "standalone" in navigator &&
      navigator.standalone === true)
  );
}

export function supportsWebPush() {
  return (
    hasWindow() &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export function detectMobileOs(userAgent = typeof navigator !== "undefined" ? navigator.userAgent : ""): MobileOs {
  const normalized = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(normalized)) return "ios";
  if (/android/.test(normalized)) return "android";
  return "other";
}

export function isLikelyMobileDevice() {
  if (!hasWindow()) return false;
  return (
    window.matchMedia("(max-width: 767px)").matches ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function getPushPermission(): NotificationPermission | "unsupported" {
  if (!hasWindow() || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export async function getExistingPushSubscription() {
  if (!supportsWebPush()) return null;

  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPushNotifications(vapidPublicKey: string) {
  if (!supportsWebPush()) {
    throw new Error("Web push is not supported on this device.");
  }

  const registration = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Push permission was not granted.");
  }

  const existingSubscription = await registration.pushManager.getSubscription();
  if (existingSubscription) {
    return existingSubscription;
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

export async function unsubscribeFromPushNotifications() {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return false;
  return subscription.unsubscribe();
}

export function getInstallInstructions(os: MobileOs, lang: "it" | "en") {
  if (os === "ios") {
    return lang === "en"
      ? "Open BITE in Safari, tap Share, then choose Add to Home Screen."
      : "Apri BITE in Safari, tocca Condividi e poi Aggiungi a Home.";
  }

  if (os === "android") {
    return lang === "en"
      ? "Open BITE in Chrome, then use Install app or Add to Home screen from the browser menu."
      : "Apri BITE in Chrome, poi usa Installa app o Aggiungi a schermata Home dal menu del browser.";
  }

  return lang === "en"
    ? "Install BITE from your browser menu to enable app-style push notifications."
    : "Installa BITE dal menu del browser per abilitare le notifiche push in stile app.";
}
