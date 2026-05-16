import { promises as fs } from "node:fs";
import { join } from "node:path";
import { getAppPaths } from "./appPaths.js";
import type { Chart } from "../core/types.js";

type CacheEntry<V> = {
  value: V;
  cachedAt: number;
  lastAccessedAt: number;
};

export type CacheOptions<K extends string | number = string | number> = {
  fileName: string;
  maxMemorySize?: number;
  ttl?: number; // 缓存过期时间（毫秒），undefined 表示永不过期
  persistToDisk?: boolean; // 是否持久化到磁盘，默认 true
  keyType?: K extends string ? "string" : K extends number ? "number" : "string" | "number";
};

export type CacheStats = {
  hits: number;
  misses: number;
  total: number;
  hitRate: number;
  size: number;
};

export class Cache<K extends string | number, V> {
  private memoryCache = new Map<K, CacheEntry<V>>();
  private cacheFilePath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private maxMemorySize: number;
  private ttl?: number;
  private persistToDisk: boolean;
  private keyType: "string" | "number";
  private _stats = { hits: 0, misses: 0 };
  private saveTimer: NodeJS.Timeout | null = null;
  private pendingSave = false;

  constructor(options: CacheOptions<K>) {
    const paths = getAppPaths();
    this.cacheFilePath = join(paths.dataDir, "tmp", "cache", options.fileName);
    this.maxMemorySize = options.maxMemorySize ?? 100;
    this.ttl = options.ttl;
    this.persistToDisk = options.persistToDisk ?? true;
    this.keyType = options.keyType ?? "string";
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.persistToDisk ? this.loadFromDisk() : Promise.resolve();
    await this.initPromise;
    this.initialized = true;
    this.initPromise = null;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const data = await fs.readFile(this.cacheFilePath, "utf-8");
      const parsed = JSON.parse(data) as Record<string, Omit<CacheEntry<V>, "lastAccessedAt">>;

      const now = Date.now();
      for (const [keyStr, entry] of Object.entries(parsed)) {
        if (!entry.value || typeof entry.cachedAt !== "number") continue;

        // 检查是否过期
        if (this.ttl && now - entry.cachedAt > this.ttl) continue;

        const key = (this.keyType === "number" ? parseInt(keyStr, 10) : keyStr) as K;

        this.memoryCache.set(key, {
          value: entry.value,
          cachedAt: entry.cachedAt,
          lastAccessedAt: now
        });
      }
    } catch {
      // 文件不存在或解析失败，忽略错误
    }
  }

  private scheduleSaveToDisk(): void {
    if (!this.persistToDisk) return;
    this.pendingSave = true;

    if (this.saveTimer) return; // 已经安排了保存

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.pendingSave) return;
      this.pendingSave = false;
      void this.flushToDisk();
    }, 100); // 100ms 防抖
  }

  private async flushToDisk(): Promise<void> {
    try {
      const cacheDir = join(getAppPaths().dataDir, "tmp", "cache");
      await fs.mkdir(cacheDir, { recursive: true });

      const obj: Record<string, { value: V; cachedAt: number }> = {};
      for (const [key, entry] of this.memoryCache.entries()) {
        obj[key.toString()] = { value: entry.value, cachedAt: entry.cachedAt };
      }

      await fs.writeFile(this.cacheFilePath, JSON.stringify(obj, null, 2), "utf-8");
    } catch {
      // 写入失败，忽略错误
    }
  }

  async get(key: K): Promise<V | null> {
    await this.ensureInitialized();

    const entry = this.memoryCache.get(key);
    if (!entry) {
      this._stats.misses++;
      return null;
    }

    // 检查是否过期
    if (this.ttl && Date.now() - entry.cachedAt > this.ttl) {
      this.memoryCache.delete(key);
      this._stats.misses++;
      return null;
    }

    // 更新最后访问时间（LRU）
    entry.lastAccessedAt = Date.now();
    this._stats.hits++;
    return entry.value;
  }

  async set(key: K, value: V): Promise<void> {
    await this.ensureInitialized();

    const now = Date.now();
    this.memoryCache.set(key, {
      value,
      cachedAt: now,
      lastAccessedAt: now
    });

    // LRU 淘汰：移除最久未访问的
    if (this.memoryCache.size > this.maxMemorySize) {
      let oldestKey: K | undefined;
      let oldestTime = Infinity;
      for (const [k, entry] of this.memoryCache.entries()) {
        if (entry.lastAccessedAt < oldestTime) {
          oldestTime = entry.lastAccessedAt;
          oldestKey = k;
        }
      }
      if (oldestKey !== undefined) {
        this.memoryCache.delete(oldestKey);
      }
    }

    this.scheduleSaveToDisk();
  }

  /**
   * 获取缓存值，如果不存在则通过 factory 生成并写入缓存
   */
  async getOrSet(key: K, factory: () => V | Promise<V>): Promise<V> {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value);
    return value;
  }

  async has(key: K): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async delete(key: K): Promise<void> {
    await this.ensureInitialized();
    this.memoryCache.delete(key);
    this.scheduleSaveToDisk();
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    this.memoryCache.clear();
    this._stats.hits = 0;
    this._stats.misses = 0;
    if (this.persistToDisk) {
      this.pendingSave = false;
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      await this.flushToDisk().catch(() => {});
    }
  }

  /**
   * 返回当前缓存中所有有效的 key
   */
  async keys(): Promise<K[]> {
    await this.ensureInitialized();
    const result: K[] = [];
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (this.ttl && now - entry.cachedAt > this.ttl) continue;
      result.push(key);
    }
    return result;
  }

  /**
   * 返回当前缓存中有效条目数量
   */
  async size(): Promise<number> {
    const keys = await this.keys();
    return keys.length;
  }

  /**
   * 获取缓存命中率统计
   */
  stats(): CacheStats {
    const hits = this._stats.hits;
    const misses = this._stats.misses;
    const total = hits + misses;
    return {
      hits,
      misses,
      total,
      hitRate: total > 0 ? hits / total : 0,
      size: this.memoryCache.size
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this._stats.hits = 0;
    this._stats.misses = 0;
  }
}

// 谱面缓存实例，TTL 1 小时
export const chartCache = new Cache<number, Chart>({
  fileName: "chart_cache.json",
  maxMemorySize: 200,
  ttl: 60 * 60 * 1000, // 1 小时
  keyType: "number"
});
