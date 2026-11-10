// Stand-in for WXT's `#imports` on Android: the background entry's
// defineBackground(main) hands back `main`, which mobile/main.tsx runs itself
// once the native transports are in place.
export function defineBackground<T extends () => void>(main: T): T {
  return main;
}
