/**
 * 从 Codex App 的本地 SQLite 数据库读取对话信息。
 * 数据库路径：~/.codex/state_5.sqlite
 * 不引入额外依赖，直接调用系统 sqlite3 CLI。
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.homedir(), ".codex", "state_5.sqlite");

/**
 * 查询最近的 Codex 对话列表（带标题）
 */
export async function listCodexThreadsFromDb(limit = 6) {
  if (!existsSync(DB_PATH)) {
    return { ok: false, error: "Codex 数据库不存在", threads: [] };
  }

  const sql = `SELECT id, title, updated_at FROM threads ORDER BY updated_at DESC LIMIT ${limit};`;

  try {
    const rows = await queryJson(sql);
    return {
      ok: true,
      threads: rows.map((row) => ({
        threadId: row.id,
        title: row.title || `对话 ${row.id.slice(0, 8)}`,
        updatedAt: row.updated_at,
      })),
    };
  } catch (error) {
    return { ok: false, error: error.message, threads: [] };
  }
}

/**
 * 根据 thread ID 查询对话标题
 */
export async function getCodexThreadTitle(threadId) {
  if (!existsSync(DB_PATH) || !threadId) return null;

  const sql = `SELECT title FROM threads WHERE id = '${threadId}' LIMIT 1;`;
  try {
    const rows = await queryJson(sql);
    return rows[0]?.title || null;
  } catch {
    return null;
  }
}

/**
 * 执行 SQLite 查询，返回 JSON 数组
 */
function queryJson(sql) {
  return new Promise((resolve, reject) => {
    execFile("sqlite3", ["-json", "-readonly", DB_PATH, sql], { timeout: 3000 }, (error, stdout) => {
      if (error) return reject(error);
      try {
        resolve(JSON.parse(stdout || "[]"));
      } catch (parseError) {
        reject(new Error(`SQLite JSON 解析失败: ${parseError.message}`));
      }
    });
  });
}
