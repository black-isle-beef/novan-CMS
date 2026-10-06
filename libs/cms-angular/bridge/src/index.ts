// `@black-isle-beef/cms-angular/bridge`: the visual editor bridge, loaded only in preview mode inside the admin's
// frame, so other visitors never download it (docs/build/12-visual-editor.md). It imports nothing from the main
// entry point, which loads it.

export { blockLabel, type NovanBridgeEnvironment, type NovanBridgeHandle, type NovanBridgeHost, startNovanBridge } from './bridge';
export * from './protocol';
