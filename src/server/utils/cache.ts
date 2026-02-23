import { promises as fs } from "node:fs";
import { join } from "node:path";
import { getAppPaths } from "./appPaths.js";
import type { Chart } from "../core/types.js";

type CacheEntry<T> = {
  value: T;
  cachedAt: number;
};

export type CacheOptions = {
  fileName: string;
  maxMemorySize?: number;
  ttl?: number; // 缓存过期时间（毫秒），undefined 表示永不过期
  persistToDisk?: boolean; // 是否持久化到磁盘，默认 true
};

export class Cache<K extends string | number, V> {
  private memoryCache = new Map<K, CacheEntry<V>>();
  private cacheFilePath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private maxMemorySize: number;
  private ttl?: number;
  private persistToDisk: boolean;

  constructor(options: CacheOptions) {
    const paths = getAppPaths();
    this.cacheFilePath = join(paths.dataDir, "tmp", "cache", options.fileName);
    this.maxMemorySize = options.maxMemorySize ?? 100;
    this.ttl = options.ttl;
    this.persistToDisk = options.persistToDisk ?? true;
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
      const parsed = JSON.parse(data) as Record<string, CacheEntry<V>>;
      
      const now = Date.now();
      for (const [keyStr, entry] of Object.entries(parsed)) {
        if (!entry.value || typeof entry.cachedAt !== "number") continue;
        
        // 检查是否过期
        if (this.ttl && now - entry.cachedAt > this.ttl) continue;
        
        const key = (typeof this.memoryCache.keys().next().value === "number" 
          ? parseInt(keyStr, 10) 
          : keyStr) as K;
        
        this.memoryCache.set(key, entry);
      }
    } catch {
      // 文件不存在或解析失败，忽略错误
    }
  }

  private async saveToDisk(): Promise<void> {
    if (!this.persistToDisk) return;
    
    try {
      const cacheDir = join(getAppPaths().dataDir, "tmp", "cache");
      await fs.mkdir(cacheDir, { recursive: true });

      const obj: Record<string, CacheEntry<V>> = {};
      for (const [key, entry] of this.memoryCache.entries()) {
        obj[key.toString()] = entry;
      }

      await fs.writeFile(this.cacheFilePath, JSON.stringify(obj, null, 2), "utf-8");
    } catch {
      // 写入失败，忽略错误
    }
  }

  async get(key: K): Promise<V | null> {
    await this.ensureInitialized();
    
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    // 检查是否过期
    if (this.ttl && Date.now() - entry.cachedAt > this.ttl) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: K, value: V): Promise<void> {
    await this.ensureInitialized();

    this.memoryCache.set(key, {
      value,
      cachedAt: Date.now()
    });

    // 限制内存缓存大小
    if (this.memoryCache.size > this.maxMemorySize) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey !== undefined) {
        this.memoryCache.delete(firstKey);
      }
    }

    // 异步保存到磁盘，不阻塞
    this.saveToDisk().catch(() => {});
  }

  async has(key: K): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async delete(key: K): Promise<void> {
    await this.ensureInitialized();
    this.memoryCache.delete(key);
    if (this.persistToDisk) {
      this.saveToDisk().catch(() => {});
    }
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    this.memoryCache.clear();
    if (this.persistToDisk) {
      this.saveToDisk().catch(() => {});
    }
  }
}

// 谱面缓存实例
export const chartCache = new Cache<number, Chart>({
  fileName: "chart_cache.json",
  maxMemorySize: 100
});
