/** The Android app wears the phone menu (ToolbarMenu); the dock/rail choice is
 *  for desktops. mobile/boot.ts marks the host before anything renders. */
export const usesPhoneMenu = (): boolean =>
  typeof document !== "undefined" && document.documentElement.dataset.host === "android";
