/**
 * 配置文件持久化（保留注释）
 *
 * 服务器在运行时通过 CLI / HTTP admin API 改动少量「可热切换」的顶层配置项
 * （如 REPLAY_ENABLED、ROOM_CREATION_ENABLED）后需要把新值落盘，以便重启后保持。
 *
 * 早期实现用 `yaml.load` + `yaml.dump` 整体重写配置文件，会把服主在
 * server_config.yml 里写的注释、空行、键顺序统统抹掉。本模块改为**逐行原地更新**：
 * 只替换目标键所在那一行的值，其余字节（注释/空行/缩进/其它键/换行风格）原样保留；
 * 键不存在时在文件末尾追加一行。
 *
 * 适用范围：顶层、扁平的标量键（boolean / number / 简单字符串）。
 * 不处理嵌套块（如 SHARE_STATION / REDIS 下的子键）——本模块只用于持久化少量
 * 顶层开关，嵌套配置仍由服主手工编辑。
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** 可持久化的标量类型 */
export type ScalarConfigValue = boolean | number | string;

/** 把标量值序列化为 YAML 行内表示 */
function serializeScalar(value: ScalarConfigValue): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  // 字符串：用双引号包裹并转义，避免 YAML 把 yes/no/数字样式的字符串误解析
  return JSON.stringify(value);
}

/** 转义正则元字符，用于按字面量匹配键名 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 在配置文本中就地更新（或追加）若干顶层标量键，返回新文本。
 *
 * - 仅匹配**行首无缩进**的 `KEY:`（顶层键），从而不会误伤嵌套块里的同名子键。
 * - 命中已存在的活动行时只替换其值，保留该行之外的一切（含其它行的尾随注释）。
 * - 被注释掉的示例行（`# KEY: ...`）不会被当作命中，此时在文件末尾追加活动行。
 * - 保留原换行风格：只重写键所在行的「键:值」部分，行尾的 \n / \r\n 不动。
 */
export function applyConfigUpdates(text: string, updates: Record<string, ScalarConfigValue>): string {
  let out = text;
  for (const [key, value] of Object.entries(updates)) {
    const serialized = `${key}: ${serializeScalar(value)}`;
    // 行首（多行模式）紧跟键名与冒号，匹配到行尾换行前为止（不吃 \r / \n）
    const re = new RegExp(`^${escapeRegExp(key)}:[^\\r\\n]*`, "m");
    if (re.test(out)) {
      out = out.replace(re, serialized);
    } else {
      // 末尾追加：确保前面以换行结尾，避免与上一行粘连
      if (out.length > 0 && !out.endsWith("\n")) out += "\n";
      out += `${serialized}\n`;
    }
  }
  return out;
}

/**
 * 把若干顶层标量配置项写回配置文件，保留注释与格式。
 *
 * 采用「写临时文件再 rename」的原子写入策略，避免写入过程中崩溃损坏配置文件；
 * rename 失败（如 Windows 文件锁）时退化为「先删后改名」重试一次。
 * 配置文件不存在时以空内容为基底，仅写入这几个键。
 *
 * @param configPath 配置文件路径
 * @param updates 需要写入的键值（键名为 yaml 中的全大写键名）
 */
export async function persistConfigValues(
  configPath: string,
  updates: Record<string, ScalarConfigValue>
): Promise<void> {
  const original = await readFile(configPath, "utf8").catch(() => "");
  const next = applyConfigUpdates(original, updates);
  if (next === original) return;

  await mkdir(dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  await writeFile(tmp, next, "utf8");
  try {
    await rename(tmp, configPath);
  } catch {
    try {
      await unlink(configPath);
    } catch {
      // 文件可能不存在
    }
    await rename(tmp, configPath);
  }
}
