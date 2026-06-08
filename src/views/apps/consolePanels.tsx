// Console Inspector — barrel re-export.
//
// Each panel lives in its own file under ./console/ for readability. This file
// preserves the original import path (`./consolePanels`) so the surrounding
// app code (ConsoleApp.tsx + tests) doesn't have to change as we split.

export { ErrorsPanel } from './console/ErrorsPanel';
export { NetworkPanel } from './console/NetworkPanel';
export { VitalsPanel } from './console/VitalsPanel';
export { SecurityPanel } from './console/SecurityPanel';
export { StoragePanel } from './console/StoragePanel';
export { SensitivePanel } from './console/SensitivePanel';
export { TechStackPanel } from './console/TechStackPanel';
export { A11yPanel } from './console/A11yPanel';
export { SeoPanel } from './console/SeoPanel';
export { AeoPanel } from './console/AeoPanel';
export { HealthPanel } from './console/HealthPanel';
export {
  runTool,
  invalidateToolCache,
  copyToClipboard,
  CopyHandoffButtons,
  useTechContext,
  type OnHandoff,
} from './console/shared';
