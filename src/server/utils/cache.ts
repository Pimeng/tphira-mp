import { promises as fs } from "node:fs";
import { join } from "node:path";
import { Redis } from "ioredis";
import { getAppPaths } from "./appPaths.js";
import { NOOP } from "../../common/utils.js";
import type { Chart, RedisConfig } from "../core/types.js";

type CacheEntry<V> = {
  value: V;
  cachedAt: number;
  lastAccessedAt: number;
};

type CacheOptions<K extends string | number = string | number> = {
  fileName: string;
  maxMemorySize?: number;
  ttl?: number; // 缓存过期时间（毫秒），undefined 表示永不过期
  persistToDisk?: boolean; // 是否持久化到磁盘，默认 true
  keyType?: K extends string ? "string" : K extends number ? "number" : "string" | "number";
};

type CacheStats = {
  hits: number;
  misses: number;
  total: number;
  hitRate: number;
  size: number;
};

let redisClient: Redis | null = null;
const allCaches: Cache<string | number, unknown>[] = [];

/**
 * 初始化 Redis 缓存支持。
 * 如果配置中启用了 Redis，会建立连接并将所有本地缓存数据迁移到 Redis。
 * 如果未启用或配置变更，会断开已有连接。
 */
export async function initRedisCache(config: RedisConfig | undefined): Promise<void> {
  if (!config?.enabled) {
    if (redisClient) {
      redisClient.disconnect();
      redisClient = null;
    }
    return;
  }

  const newClient = new Redis({
    host: config.host ?? "127.0.0.1",
    port: config.port ?? 6379,
    password: config.password,
    db: config.db ?? 0,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 3) return null;
      return Math.min(times * 100, 3000);
    }
  });

  await newClient.connect();

  if (redisClient) {
    redisClient.disconnect();
  }
  redisClient = newClient;

  for (const cache of allCaches) {
    await cache.migrateToRedis();
  }
}

export function getRedisClient(): Redis | null {
  return redisClient;
}

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
  private _approxSize = 0;
  private saveTimer: NodeJS.Timeout | null = null;
  private pendingSave = false;
  private readonly fileName: string;
  /** In-flight promise 去重：并发请求同一 key 时共享同一个 Promise */
  private readonly inFlight = new Map<K, Promise<V>>();
  /** LRU 采样大小 */
  private static readonly LRU_SAMPLE_SIZE = 5;

  constructor(options: CacheOptions<K>) {
    this.fileName = options.fileName;
    const paths = getAppPaths();
    this.cacheFilePath = join(paths.dataDir, "tmp", "cache", options.fileName);
    this.maxMemorySize = options.maxMemorySize ?? 100;
    this.ttl = options.ttl;
    this.persistToDisk = options.persistToDisk ?? true;
    this.keyType = options.keyType ?? "string";
    allCaches.push(this as unknown as Cache<string | number, unknown>);
  }

  private get useRedis(): boolean {
    return redisClient !== null;
  }

  private redisKey(key: K): string {
    return `cache:${this.fileName}:${key}`;
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
        this._approxSize++;
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

  /**
   * 将本地缓存数据迁移到 Redis，并清空本地内存和磁盘文件。
   * 仅在启用 Redis 时调用。
   */
  async migrateToRedis(): Promise<void> {
    if (!redisClient) return;
    await this.ensureInitialized();

    const now = Date.now();
    const pipeline = redisClient.pipeline();
    let count = 0;

    for (const [key, entry] of this.memoryCache.entries()) {
      if (this.ttl && now - entry.cachedAt > this.ttl) continue;
      const redisKey = this.redisKey(key);
      pipeline.set(redisKey, JSON.stringify({ value: entry.value, cachedAt: entry.cachedAt }));
      if (this.ttl) {
        const remaining = Math.max(1, this.ttl - (now - entry.cachedAt));
        pipeline.pexpire(redisKey, remaining);
      }
      count++;
    }

    if (count > 0) {
      await pipeline.exec();
    }

    this.memoryCache.clear();
    this._approxSize = count;
    this._stats.hits = 0;
    this._stats.misses = 0;

    // 停止待写入的磁盘保存任务（内存已清空，无需再写）
    if (this.persistToDisk) {
      this.pendingSave = false;
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
    }
  }

  async get(key: K): Promise<V | null> {
    if (this.useRedis) {
      const data = await redisClient!.get(this.redisKey(key));
      if (data === null) {
        this._stats.misses++;
        return null;
      }
      try {
        const parsed = JSON.parse(data) as { value: V; cachedAt: number };
        if (this.ttl && Date.now() - parsed.cachedAt > this.ttl) {
          await redisClient!.del(this.redisKey(key));
          this._stats.misses++;
          return null;
        }
        this._stats.hits++;
        return parsed.value;
      } catch {
        this._stats.misses++;
        return null;
      }
    }

    await this.ensureInitialized();
    return this.getFromMemory(key);
  }

  /**
   * 同步获取缓存值（仅内存模式，不触发 microtask）
   * Redis 模式下返回 null（调用方需 fallback 到 get()）
   */
  getSync(key: K): V | null {
    if (this.useRedis) return null;
    return this.getFromMemory(key);
  }

  private getFromMemory(key: K): V | null {
    const entry = this.memoryCache.get(key);
    if (!entry) {
      this._stats.misses++;
      return null;
    }

    if (this.ttl && Date.now() - entry.cachedAt > this.ttl) {
      this.memoryCache.delete(key);
      this._approxSize--;
      this._stats.misses++;
      return null;
    }

    entry.lastAccessedAt = Date.now();
    this._stats.hits++;
    return entry.value;
  }

  /** 获取当前内存缓存中的所有 key（用于 LRU 采样） */
  private memoryCacheKeys(): K[] {
    return [...this.memoryCache.keys()];
  }

  async set(key: K, value: V): Promise<void> {
    if (this.useRedis) {
      const cachedAt = Date.now();
      const existed = await redisClient!.exists(this.redisKey(key));
      await redisClient!.set(this.redisKey(key), JSON.stringify({ value, cachedAt }));
      if (this.ttl) {
        await redisClient!.pexpire(this.redisKey(key), this.ttl);
      }
      if (!existed) {
        this._approxSize++;
      }
      return;
    }

    await this.ensureInitialized();

    const existed = this.memoryCache.has(key);
    const now = Date.now();
    this.memoryCache.set(key, {
      value,
      cachedAt: now,
      lastAccessedAt: now
    });

    if (!existed) {
      this._approxSize++;
    }

    // LRU 淘汰：随机采样 N 个条目，淘汰其中最久未访问的（O(1) 近似 LRU）
    if (this.memoryCache.size > this.maxMemorySize && this.memoryCache.size > 0) {
      const keys = this.memoryCacheKeys();
      const sampleSize = Math.min(Cache.LRU_SAMPLE_SIZE, keys.length);
      let oldestKey: K | undefined;
      let oldestTime = Infinity;

      // Fisher-Yates 随机采样前 sampleSize 个
      for (let i = 0; i < sampleSize; i++) {
        const j = i + Math.floor(Math.random() * (keys.length - i));
        const key = keys[j]!;
        keys[j] = keys[i]!;
        keys[i] = key;
        const entry = this.memoryCache.get(key);
        if (entry && entry.lastAccessedAt < oldestTime) {
          oldestTime = entry.lastAccessedAt;
          oldestKey = key;
        }
      }

      if (oldestKey !== undefined) {
        this.memoryCache.delete(oldestKey);
        this._approxSize--;
      }
    }

    this.scheduleSaveToDisk();
  }

  /**
   * 获取缓存值，如果不存在则通过 factory 生成并写入缓存
   * 自动去重：并发请求同一 key 时共享同一个 factory Promise
   */
  async getOrSet(key: K, factory: () => V | Promise<V>): Promise<V> {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    // in-flight 去重：同一 key 的并发请求共享同一个 Promise
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const value = await factory();
        await this.set(key, value);
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  async has(key: K): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async delete(key: K): Promise<void> {
    if (this.useRedis) {
      const deleted = await redisClient!.del(this.redisKey(key));
      if (deleted > 0) {
        this._approxSize--;
      }
      return;
    }

    await this.ensureInitialized();
    if (this.memoryCache.delete(key)) {
      this._approxSize--;
    }
    this.scheduleSaveToDisk();
  }

  async clear(): Promise<void> {
    if (this.useRedis) {
      const pattern = this.redisKey("*" as K);
      let cursor = "0";
      do {
        const reply = await redisClient!.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = reply[0];
        const keys = reply[1];
        if (keys.length > 0) {
          await redisClient!.del(...keys);
        }
      } while (cursor !== "0");

      this._approxSize = 0;
      this._stats.hits = 0;
      this._stats.misses = 0;
      return;
    }

    await this.ensureInitialized();
    this.memoryCache.clear();
    this._approxSize = 0;
    this._stats.hits = 0;
    this._stats.misses = 0;
    if (this.persistToDisk) {
      this.pendingSave = false;
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      await this.flushToDisk().catch(NOOP);
    }
  }

  /**
   * 返回当前缓存中所有有效的 key
   */
  async keys(): Promise<K[]> {
    if (this.useRedis) {
      const pattern = this.redisKey("*" as K);
      const result: K[] = [];
      let cursor = "0";
      const now = Date.now();

      do {
        const reply = await redisClient!.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = reply[0];
        for (const fullKey of reply[1]) {
          const prefix = `cache:${this.fileName}:`;
          const keyStr = fullKey.slice(prefix.length);
          const key = (this.keyType === "number" ? parseInt(keyStr, 10) : keyStr) as K;
          if (this.ttl) {
            const data = await redisClient!.get(fullKey);
            if (data) {
              try {
                const parsed = JSON.parse(data) as { cachedAt: number };
                if (now - parsed.cachedAt <= this.ttl) {
                  result.push(key);
                }
              } catch {
                // 忽略解析错误
              }
            }
          } else {
            result.push(key);
          }
        }
      } while (cursor !== "0");

      return result;
    }

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
      size: this.useRedis ? this._approxSize : this.memoryCache.size
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

// 游戏记录缓存实例，TTL 1 小时（记录不可变）
export const recordCache = new Cache<number, import("../core/types.js").RecordData>({
  fileName: "record_cache.json",
  maxMemorySize: 500,
  ttl: 60 * 60 * 1000, // 1 小时
  keyType: "number"
});
