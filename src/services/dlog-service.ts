import { Store } from '../db/store.js';
import { validateProblem } from '../math/validation.js';
import {
  babyStepGiantStep,
  verifyCandidate,
  ALGORITHM_VERSION,
  type BsgsReport,
  type SearchBudget,
} from '../math/bsgs.js';
import {
  isDecimalString,
  modInverse,
  modPow,
  parseDecimal,
} from '../math/bigint-utils.js';

export interface ServiceError {
  code: string;
  message: string;
}

export interface SolveResult {
  problemId: number;
  reportId: number;
  report: BsgsReport;
}

export class DlogService {
  constructor(private store: Store) {}

  /**
   * 保存问题并执行搜索。
   * 校验失败直接返回错误，不写入任何记录；
   * 仅在搜索成功生成报告后提交，失败输入不留下成功记录。
   */
  solve(
    input: { p?: unknown; g?: unknown; h?: unknown },
    budget: SearchBudget = {},
  ): { ok: true; value: SolveResult } | { ok: false; error: ServiceError } {
    const checked = validateProblem(input);
    if (!checked.ok) return { ok: false, error: checked.error };

    const { p, g, h } = checked.value;

    let report: BsgsReport;
    try {
      report = babyStepGiantStep(p, g, h, budget);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'SCALE_LIMIT',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }

    // 先存问题原文，再存报告；二者都成功才返回
    const problemId = this.store.saveProblem(p.toString(), g.toString(), h.toString());
    const reportId = this.store.saveReport(problemId, report);

    return { ok: true, value: { problemId, reportId, report } };
  }

  getProblem(id: number) {
    return this.store.getProblem(id);
  }

  listProblems() {
    return this.store.listProblems();
  }

  listReports(problemId: number) {
    return this.store.listReports(problemId);
  }

  getReport(reportId: number) {
    return this.store.getReport(reportId);
  }

  /**
   * 独立核验用户给出的候选 x。
   * 直接计算 g^x mod p；区分“满足等式”与“已证实最小解”。
   */
  verify(input: {
    p?: unknown;
    g?: unknown;
    h?: unknown;
    x?: unknown;
  }):
    | { ok: true; value: ReturnType<typeof verifyCandidate> }
    | { ok: false; error: ServiceError } {
    const checked = validateProblem(input);
    if (!checked.ok) return { ok: false, error: checked.error };

    if (typeof input.x !== 'string' || !isDecimalString(input.x)) {
      return {
        ok: false,
        error: { code: 'INVALID_NUMBER', message: '参数 x 不是合法十进制整数字符串' },
      };
    }
    const x = parseDecimal(input.x);
    if (x < 0n) {
      return {
        ok: false,
        error: { code: 'X_OUT_OF_RANGE', message: '候选指数 x 必须为非负整数' },
      };
    }
    const value = verifyCandidate(checked.value.p, checked.value.g, checked.value.h, x);
    return { ok: true, value };
  }

  /**
   * 复查历史见证：依据存储的问题原文与见证，重新计算模等式。
   * 故意篡改余数或指数会在此被拒绝。
   */
  recheckWitness(reportId: number):
    | {
        ok: true;
        value: {
          valid: boolean;
          reasons: string[];
          report: BsgsReport;
        };
      }
    | { ok: false; error: ServiceError } {
    const row = this.store.getReport(reportId);
    if (!row) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `报告 ${reportId} 不存在` } };
    }
    const report = JSON.parse(row.report_json) as BsgsReport;
    const reasons: string[] = [];

    const p = BigInt(report.p);
    const g = BigInt(report.g);
    const h = BigInt(report.h);

    // 1) 命中余数必须同时等于 g^j mod p 与 h*(g^-m)^i mod p
    if (report.hit) {
      const { i, j, residue, candidateX } = report.hit;
      const bi = BigInt(i);
      const bj = BigInt(j);
      const babyResidue = modPow(g, bj, p);
      const m = BigInt(report.m);
      const gm = modPow(g, m, p);
      // giant 余数 = h * (g^-m)^i mod p
      const invGm = modInverse(gm, p);
      const giantResidue2 = (h * modPow(invGm, bi, p)) % p;

      if (babyResidue.toString() !== residue) {
        reasons.push(`baby 余数被篡改或不一致: g^j mod p = ${babyResidue} != 见证 ${residue}`);
      }
      if (giantResidue2.toString() !== residue) {
        reasons.push(`giant 余数被篡改或不一致: 重算 = ${giantResidue2} != 见证 ${residue}`);
      }

      // 2) 候选指数必须等于 i*m+j
      const rebuiltX = bi * m + bj;
      if (rebuiltX.toString() !== candidateX) {
        reasons.push(`候选指数与 i*m+j 不一致: ${rebuiltX} != ${candidateX}`);
      }

      // 3) 核心模等式
      const computed = modPow(g, BigInt(candidateX), p);
      if (computed.toString() !== h.toString()) {
        reasons.push(`模等式不成立: g^x mod p = ${computed} != h = ${h}`);
      }
    } else if (report.status === 'solved') {
      reasons.push('报告声称已解决但缺少命中见证');
    }

    return { ok: true, value: { valid: reasons.length === 0, reasons, report } };
  }

  /**
   * 比较两个问题（版本）：参数差异与各自最新结果。
   */
  compareVersions(idA: number, idB: number) {
    const a = this.store.getProblem(idA);
    const b = this.store.getProblem(idB);
    if (!a || !b) {
      return {
        ok: false as const,
        error: {
          code: 'NOT_FOUND',
          message: `问题不存在: ${!a ? idA : idB}`,
        },
      };
    }
    const latest = (pid: number) => {
      const list = this.store.listReports(pid);
      const last = list[list.length - 1];
      return last
        ? {
            reportId: last.id,
            status: last.status,
            minimumX: last.minimum_x,
            algorithmVersion: last.algorithm_version,
            report: JSON.parse(last.report_json) as BsgsReport,
          }
        : null;
    };
    return {
      ok: true as const,
      value: {
        a: { problem: a, latest: latest(a.id) },
        b: { problem: b, latest: latest(b.id) },
        paramDiff: {
          pChanged: a.p !== b.p,
          gChanged: a.g !== b.g,
          hChanged: a.h !== b.h,
        },
      },
    };
  }

  /** 导出全部问题与报告为 JSON 可序列化对象 */
  exportAll() {
    const problems = this.store.listProblems().map((prob) => ({
      ...prob,
      reports: this.store.listReports(prob.id).map((r) => ({
        ...r,
        report: JSON.parse(r.report_json) as BsgsReport,
      })),
    }));
    return { exportedAt: new Date().toISOString(), algorithmVersion: ALGORITHM_VERSION, problems };
  }
}
