import type { CommandBus, CommandDefinition, CommandSnapshot } from "./types";

/**
 * Default {@link CommandBus} implementation. Plain in-memory map; no
 * editor coupling beyond the closure plugins use when registering.
 * Replacing it would mean swapping a field on Editor — the rest of
 * the surface stays the same.
 */
export class EditorCommands implements CommandBus {
  // Stored as `unknown` so the same Map can hold commands with
  // different `Args` shapes; callers see the typed wrapper.
  private readonly commands = new Map<string, CommandDefinition<unknown>>();

  register<Args = void>(def: CommandDefinition<Args>): () => void {
    if (this.commands.has(def.name)) {
      console.warn(`[sobree] command "${def.name}" registered twice — overwriting`);
    }
    this.commands.set(def.name, def as CommandDefinition<unknown>);
    return () => {
      // Only remove if the same definition is still registered — guards
      // against a re-register replacing this one and a later detach
      // accidentally killing the new one.
      if (this.commands.get(def.name) === (def as unknown)) {
        this.commands.delete(def.name);
      }
    };
  }

  execute<Args = void>(name: string, args?: Args): void {
    const cmd = this.commands.get(name);
    if (!cmd) {
      console.warn(`[sobree] command "${name}" not registered`);
      return;
    }
    if (cmd.isAvailable && !cmd.isAvailable()) return;
    try {
      cmd.run(args as never);
    } catch (err) {
      console.error(`[sobree] command "${name}" threw:`, err);
    }
  }

  list(): CommandSnapshot[] {
    const out: CommandSnapshot[] = [];
    for (const c of this.commands.values()) {
      out.push({
        name: c.name,
        title: c.title ?? c.name,
        isActive: c.isActive?.() ?? false,
        isAvailable: c.isAvailable?.() ?? true,
      });
    }
    return out;
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }
}
