// Runs before any other module of the Android entry evaluates (it is main.tsx's
// first import), so every fetch the shared app makes goes through native HTTP
// where it has to.
import { installNativeFetch } from "./nativeFetch";

installNativeFetch();
document.documentElement.dataset.host = "android";
// The page lays out at the device's own width (index.html's viewport); the
// shared components adapt below 640px (Tailwind's max-sm), so a phone in
// portrait gets a single-column dashboard rather than a scaled-down desktop.
