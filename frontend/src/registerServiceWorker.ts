export function registerServiceWorker() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener(
      "load",
      () => {
        void navigator.serviceWorker
          .register("/sw.js", { scope: "/", updateViaCache: "none" })
          .catch(() => {
            console.warn(
              "Offline app-shell installation failed; online browsing remains available.",
            );
          });
      },
      { once: true },
    );
  }
}
