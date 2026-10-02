import type { DesktopBridge } from '../shared/contracts';
declare global { interface Window { opentypora?: DesktopBridge } }
export const desktop = typeof window === 'undefined' ? undefined : window.opentypora;
