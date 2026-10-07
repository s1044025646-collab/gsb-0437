import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { ALGORITHM_VERSION } from './constants.js';
import { modPow } from './bigmath.js';
import type { BsgsResult } from './bsgs.js';

export interface SavedProblem {
  id: number;
  problemKey: string; // 参数指纹，相同参数+预算归并为一个问题
  version: number; // 同一问题的第几次报告
  rawInput: string; // 原始请求（保留原文，含前导零等）
  p: string;
  g: string;
  h: string;
  budget: string;
  status: string;
  result: string; // 完整结果 JSON
  witnessHash: string;
  algorithmVersion: string;
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS problems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        problem_key TEXT NOT NULL,
        version INTEGER NOT NULL,
        raw_input TEXT NOT NULL,
        p TEXT NOT NULL,
        g TEXT NOT NULL,
        h TEXT NOT NULL,
        budget TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT NOT NULL,
        witness_hash TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(problem_key, version)
      );
      CREATE INDEX IF NOT EXISTS idx_problems_key ON problems(problem_key);
    `);
  }

  close() {
    this.db.close();
  }

  // 参数指纹：规范化后的 p/g/h 与预算决定“同一个问题”。
  static problemKey(p: string, g: string, h: string, budget: unknown): string {
    const payload = JSON.stringify({ p, g, h, budget: budget ?? {} });
    return createHash('sha256').update(payload).digest('hex').slice(0, 32);
  }

  // 见证哈希：对关键见证字段做指纹，篡改余数/指数后重算会不一致。
  static witnessHash(result: BsgsResult): string {
    const w = {
      v: result.algorithmVersion,
      p: result.p,
      g: result.g,
      h: result.h,
      m: result.m,
      hit: result.hit,
      status: result.status,
    };
    return createHash('sha256').update(JSON.stringify(w)).digest('hex');
  }

  // 保存新报告；修改参数会得到新 problem_key，同一参数重复执行则 version 递增。
  // result 为 null 表示“仅保存问题，尚未执行”（status=saved）。
  saveReport(
    rawInput: string,
    p: string,
    g: string,
    h: string,
    budget: unknown,
    result: BsgsResult | null
  ): SavedProblem {
    const key = Store.problemKey(p, g, h, budget);
    const budgetJson = JSON.stringify(budget ?? {});
    const resultJson = result === null ? '' : JSON.stringify(result);
    const hash = result === null ? '' : Store.witnessHash(result);
    const status = result === null ? 'saved' : result.status;

    const nextVersionRow = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM problems WHERE problem_key = ?')
      .get(key) as { v: number };

    const info = this.db
      .prepare(
        `INSERT INTO problems
           (problem_key, version, raw_input, p, g, h, budget, status, result, witness_hash, algorithm_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        key,
        nextVersionRow.v,
        rawInput,
        p,
        g,
        h,
        budgetJson,
        status,
        resultJson,
        hash,
        ALGORITHM_VERSION
      );
    return this.getById(Number(info.lastInsertRowid))!;
  }

  getById(id: number): SavedProblem | null {
    const row = this.db.prepare('SELECT * FROM problems WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.hydrate(row) : null;
  }

  listByProblem(key: string): SavedProblem[] {
    const rows = this.db
      .prepare('SELECT * FROM problems WHERE problem_key = ? ORDER BY version')
      .all(key) as Record<string, unknown>[];
    return rows.map((r) => this.hydrate(r));
  }

  list(limit = 50): SavedProblem[] {
    const rows = this.db
      .prepare('SELECT * FROM problems ORDER BY id DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.hydrate(r));
  }

  // 复查存储的见证：重算哈希并重新执行模幂等式，确认重启后模等式仍成立。
  recheck(saved: SavedProblem): { hashOk: boolean; equationOk: boolean | null; message: string } {
    if (!saved.result) {
      return { hashOk: true, equationOk: null, message: '问题仅保存，尚未执行搜索' };
    }
    const result: BsgsResult = JSON.parse(saved.result);
    const hashOk = Store.witnessHash(result) === saved.witnessHash;
    let equationOk: boolean | null = null;
    if (result.status === 'found' && result.hit) {
      // 独立重算，不信任存证
      const p = BigInt(result.p);
      const g = BigInt(result.g);
      const h = BigInt(result.h);
      const x = BigInt(result.hit.x);
      equationOk = modPow(g, x, p) === h;
    }
    return {
      hashOk,
      equationOk,
      message: !hashOk
        ? '见证哈希不一致：结果可能被篡改'
        : equationOk === false
          ? '模幂等式复验失败'
          : '见证完整' + (equationOk ? '，模等式复验通过' : ''),
    };
  }

  private hydrate(row: Record<string, unknown>): SavedProblem {
    return {
      id: Number(row.id),
      problemKey: String(row.problem_key),
      version: Number(row.version),
      rawInput: String(row.raw_input),
      p: String(row.p),
      g: String(row.g),
      h: String(row.h),
      budget: String(row.budget),
      status: String(row.status),
      result: String(row.result),
      witnessHash: String(row.witness_hash),
      algorithmVersion: String(row.algorithm_version),
      createdAt: String(row.created_at),
    };
  }
}
