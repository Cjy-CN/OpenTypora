import type { Ref, ReactNode } from 'react';
import type { DocumentStore } from '../core/document';
import type { CommandRegistry, CommandContext } from '../core/commands';
import type { DesktopBridge } from './contracts';
import type { SettingsSnapshot, SettingsStore } from './settings';
export interface EditorHandle { execute(commandId: string, argument?: unknown): boolean | Promise<boolean>; focus(): void; scrollTo(position: number): void }
export interface EditorProps { store: DocumentStore; settings: SettingsSnapshot; sourceMode: boolean; focusMode: boolean; typewriterMode: boolean; bridge?: DesktopBridge; onCommand?: (id: string, argument?: unknown) => void; ref?: Ref<EditorHandle> }
export interface WorkspaceShellProps { store: DocumentStore; settingsStore: SettingsStore; registry: CommandRegistry; context: CommandContext; bridge?: DesktopBridge; editor: ReactNode; overlays?: ReactNode; message: string; viewModes?: {source:boolean;focus:boolean;typewriter:boolean}; onCommand: (id: string, argument?: unknown) => void; onNavigate: (position: number) => void }
