import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin, PluginHooks } from "./types.js";
import type { ServerState } from "../core/state.js";
import type { Logger } from "../utils/logger.js";
import type { User } from "../game/user.js";
import type { ClientCommand } from "../../common/commands.js";
import { createPluginContext } from "./PluginContext.js";

/**
 * 插件管理器
 */
export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private contexts = new Map<string, ReturnType<typeof createPluginContext>>();
  private timers = new Map<string, NodeJS.Timeout[]>();
  
  constructor(
    private state: ServerState,
    private logger: Logger,
    private pluginsDir: string
  ) {}
  
  /**
   * 加载所有插件
   */
  async loadPlugins(): Promise<void> {
    try {
      const entries = await readdir(this.pluginsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // 从 plugins/插件名/main.js 加载
          const mainPath = join(this.pluginsDir, entry.name, 'main.js');
          try {
            await this.loadPlugin(mainPath);
          } catch (e) {
            this.logger.log("ERROR", `Failed to load plugin ${entry.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
      
      this.logger.log("INFO", `Loaded ${this.plugins.size} plugin(s)`);
    } catch (e) {
      if ((e as any).code === 'ENOENT') {
        this.logger.log("INFO", "Plugins directory not found, skipping plugin loading");
      } else {
        this.logger.log("ERROR", `Failed to load plugins: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  
  /**
   * 加载单个插件
   */
  private async loadPlugin(path: string): Promise<void> {
    const module = await import(path);
    const plugin: Plugin = module.default || module;
    
    if (!plugin.metadata || !plugin.metadata.id) {
      throw new Error("Plugin must have metadata with id");
    }
    
    // 检查是否启用
    if (plugin.metadata.enabled === false) {
      this.logger.log("INFO", `Plugin ${plugin.metadata.id} is disabled, skipping`);
      return;
    }
    
    // 创建插件上下文
    const timers: NodeJS.Timeout[] = [];
    this.timers.set(plugin.metadata.id, timers);
    const context = createPluginContext(plugin.metadata.id, this.state, this.logger, timers);
    this.contexts.set(plugin.metadata.id, context);
    
    // 初始化插件
    if (plugin.hooks.onInit) {
      await plugin.hooks.onInit(context);
    }
    
    this.plugins.set(plugin.metadata.id, plugin);
    this.logger.log("INFO", `Loaded plugin: ${plugin.metadata.name} v${plugin.metadata.version}`);
  }
  
  /**
   * 卸载所有插件
   */
  async unloadPlugins(): Promise<void> {
    for (const [id, plugin] of this.plugins) {
      try {
        // 清理定时器
        const timers = this.timers.get(id);
        if (timers) {
          for (const timer of timers) {
            clearInterval(timer);
          }
        }
        
        // 调用销毁钩子
        if (plugin.hooks.onDestroy) {
          await plugin.hooks.onDestroy();
        }
      } catch (e) {
        this.logger.log("ERROR", `Failed to unload plugin ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    
    this.plugins.clear();
    this.contexts.clear();
    this.timers.clear();
  }
  
  /**
   * 触发钩子
   */
  async triggerHook<K extends keyof PluginHooks>(
    hookName: K,
    ...args: Parameters<NonNullable<PluginHooks[K]>>
  ): Promise<void> {
    for (const plugin of this.plugins.values()) {
      const hook = plugin.hooks[hookName];
      if (hook) {
        try {
          await (hook as any)(...args);
        } catch (e) {
          this.logger.log("ERROR", `Plugin ${plugin.metadata.id} hook ${hookName} error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }
  
  /**
   * 触发命令前钩子（可以拦截命令）
   */
  async triggerBeforeCommand(user: User, command: ClientCommand): Promise<ClientCommand | null> {
    let currentCommand: ClientCommand | null = command;
    
    for (const plugin of this.plugins.values()) {
      if (plugin.hooks.onBeforeCommand && currentCommand) {
        try {
          currentCommand = await plugin.hooks.onBeforeCommand(user, currentCommand);
        } catch (e) {
          this.logger.log("ERROR", `Plugin ${plugin.metadata.id} onBeforeCommand error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    
    return currentCommand;
  }
  
  /**
   * 获取所有已加载的插件
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }
}
