// `@novan/cms-angular/bridge`: the visual editor bridge, loaded only in preview mode so other visitors never
// download it. Package 12 (docs/build/12-visual-editor.md) adds the editing behaviour: block outlines,
// `postMessage` with the admin and live updates.

/** Starts the bridge in the preview page; returns a function that stops it. */
export function startNovanBridge(): () => void {
  return () => undefined;
}
