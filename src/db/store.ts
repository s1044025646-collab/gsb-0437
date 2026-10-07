import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ALGORITHM_VERSION, type BsgsReport } from '../math/bsgs.js';

export interface ProblemRow {
  id: number;
  p: string;
  g: string;
  h: string;
  created_at: string;
}

export interface ReportRow {
  id: number;
  problem_id: number;
  algorithm_version: string;
  status: string;
  minimum_x: string | null;
  report_json: string;
  created_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS problems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        p TEXT NOT NULL,
        g TEXT NOT NULL,
        h TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        problem_id INTEGER NOT NULL,
        algorithm_version TEXT NOT NULL,
        status TEXT NOT NULL,
        minimum_x TEXT,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (problem_id) REFERENCES problems(id)
      );
      CREATE INDEX IF NOT EXISTS idx_reports_problem ON reports(problem_id);
    `);
  }

  /** 保存问题原文；返回新问题 id */
  saveProblem(p: string, g: string, h: string): number {
    const stmt = this.db.prepare(
      'INSERT INTO problems (p, g, h) VALUES (?, ?, ?)',
    );
    const info = stmt.run(p, g, h);
    return Number(info.lastInsertRowid);
  }

  getProblem(id: number): ProblemRow | null {
    const row = this.db
      .prepare('SELECT * FROM problems WHERE id = ?')
      .get(id) as ProblemRow | undefined;
    return row ?? null;
  }

  listProblems(): ProblemRow[] {
    return this.db
      .prepare('SELECT * FROM problems ORDER BY id')
      .all() as unknown as ProblemRow[];
  }

  /** 保存一次搜索结果与见证 */
  saveReport(problemId: number, report: BsgsReport): number {
    const stmt = this.db.prepare(
      `INSERT INTO reports (problem_id, algorithm_version, status, minimum_x, report_json)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const info = stmt.run(
      problemId,
      report.algorithmVersion,
      report.status,
      report.minimumX,
      JSON.stringify(report),
    );
    return Number(info.lastInsertRowid);
  }

  listReports(problemId: number): ReportRow[] {
    return this.db
      .prepare(
        'SELECT * FROM reports WHERE problem_id = ? ORDER BY id',
      )
      .all(problemId) as unknown as ReportRow[];
  }

  getReport(reportId: number): ReportRow | null {
    const row = this.db
      .prepare('SELECT * FROM reports WHERE id = ?')
      .get(reportId) as ReportRow | undefined;
    return row ?? null;
  }

  close(): void {
    this.db.close();
  }
}

export { ALGORITHM_VERSION };
