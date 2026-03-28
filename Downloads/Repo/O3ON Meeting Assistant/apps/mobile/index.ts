import { registerRootComponent } from "expo";
import App from "./App";

// Register PWA service worker
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

registerRootComponent(App);
