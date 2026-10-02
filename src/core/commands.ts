import type { Result } from '../shared/contracts';
import type { DocumentStore } from './document';
import { failure, success, toAppError } from '../shared/errors';
export interface CommandContext { document: DocumentStore; notify(message: string): void }
export interface CommandDefinition { id: string; label: string; menu: string; shortcut?: string; modifiesDocument: boolean }
export type CommandHandler = (context: CommandContext, argument?: unknown) => void | Promise<void>;
export class CommandRegistry {
  private handlers = new Map<string, { run: CommandHandler; enabled: (context: CommandContext) => boolean }>();
  constructor(readonly definitions: readonly CommandDefinition[]) {
    if (new Set(definitions.map(item => item.id)).size !== definitions.length) throw new Error('DUPLICATE_COMMAND');
  }
  register(id: string, run: CommandHandler, enabled: (context: CommandContext) => boolean = () => true) {
    if (!this.definitions.some(item => item.id === id)) throw new Error(`UNKNOWN_COMMAND: ${id}`);
    if (this.handlers.has(id)) throw new Error(`DUPLICATE_HANDLER: ${id}`);
    this.handlers.set(id, { run, enabled }); return () => this.handlers.delete(id);
  }
  isEnabled(id: string, context: CommandContext) {
    const definition = this.definitions.find(item => item.id === id), handler = this.handlers.get(id);
    return !!definition && !!handler && (!definition.modifiesDocument || !context.document.getSnapshot().readonly) && handler.enabled(context);
  }
  async execute(id: string, context: CommandContext, argument?: unknown): Promise<Result<void>> {
    if (!this.isEnabled(id, context)) return failure('COMMAND_UNAVAILABLE', '当前上下文不可执行此命令');
    try { await this.handlers.get(id)!.run(context, argument); return success(undefined); }
    catch (error) { const value = toAppError(error); return { ok: false, error: value }; }
  }
  implementedIds() { return [...this.handlers.keys()]; }
}
