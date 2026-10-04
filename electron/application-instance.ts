import type { App } from 'electron';
import { resolve } from 'node:path';
import { launchDocument } from '../src/shared/launch-document';

export function launchDocumentPath(argv: readonly string[], packaged: boolean, workingDirectory: string): string | undefined {
  const path = launchDocument(argv, packaged);
  return path ? resolve(workingDirectory, path) : undefined;
}

interface InstanceOptions {
  app: Pick<App, 'requestSingleInstanceLock' | 'exit' | 'on'>;
  documentPath?: string;
  packaged: boolean;
  ready: Promise<void>;
  openWindow(documentPath?: string): Promise<unknown>;
  onError(error: unknown): void;
}

/** One main process owns the Chromium profile; each launch still opens its own window. */
export function claimApplicationInstance(options: InstanceOptions): boolean {
  const { app } = options;
  // Send the parsed path explicitly: Electron may reorder or append secondary argv.
  if (!app.requestSingleInstanceLock({ documentPath: options.documentPath ?? null })) {
    // This process has no windows or unsaved state. Exit before Chromium opens the shared profile.
    app.exit(0);
    return false;
  }

  let pending = Promise.resolve();
  app.on('second-instance', (_event, argv, workingDirectory, additionalData) => {
    const forwarded = additionalData && typeof additionalData === 'object'
      ? (additionalData as Record<string, unknown>).documentPath : undefined;
    const documentPath = forwarded === null ? undefined
      : typeof forwarded === 'string' && forwarded.length > 0 ? resolve(workingDirectory, forwarded)
      : launchDocumentPath(argv, options.packaged, workingDirectory);
    // Startup may still be loading settings or registering IPC. Preserve every request.
    pending = pending.then(async () => {
      await options.ready;
      await options.openWindow(documentPath);
    }).catch(options.onError);
  });
  return true;
}
