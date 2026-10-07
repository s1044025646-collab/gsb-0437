import { createServer, type IncomingMessage, type Server } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import { Store } from './store.js';
import { runBsgs, verifyCandidate, type BsgsResult } from './bsgs.js';
import { isPrime } from './bigmath.js';
import {
  parseDecimal,
  validateBudget,
  validateParams,
  ValidationError,
} from './validation.js';

const DATA_DIR = resolve(process.cwd(), 'data');

export interface AppContext {
  store: Store;
}

function send(res: import('node:http').ServerResponse, code: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        rejectPromise(Object.assign(new Error('请求体过大'), { code: 'PAYLOAD_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8');
      if (!text) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(text));
      } catch {
        rejectPromise(Object.assign(new Error('JSON 解析失败'), { code: 'INVALID_JSON' }));
      }
    });
    req.on('error', rejectPromise);
  });
}

async function handle(ctx: AppContext, req: IncomingMessage, res: import('node:http').ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  // GET /healthz
  if (method === 'GET' && path === '/healthz') {
    return send(res, 200, { ok: true });
  }

  // POST /problems  保存问题（仅当参数合法；失败输入不留下记录）
  if (method === 'POST' && path === '/problems') {
    const body = await readJson(req);
    const params = validateParams(body);
    if (!isPrime(params.p)) {
      throw Object.assign(new Error(`p=${params.p} 不是素数（服务端独立试除检查）`), {
        code: 'P_NOT_PRIME',
      });
    }
    const budget = validateBudget(body.budget);
    // 参数与素性均通过后才落库；失败输入在上面已抛出，不会留下任何记录。
    const saved = ctx.store.saveReport(
      JSON.stringify(body),
      params.p.toString(),
      params.g.toString(),
      params.h.toString(),
      budget,
      null
    );
    return send(res, 201, {
      id: saved.id,
      problemKey: saved.problemKey,
      version: saved.version,
      status: 'saved',
    });
  }

  // POST /search  执行 BSGS 并持久化结果
  if (method === 'POST' && path === '/search') {
    const body = await readJson(req);
    const params = validateParams(body);
    if (!isPrime(params.p)) {
      throw Object.assign(new Error(`p=${params.p} 不是素数（服务端独立试除检查）`), {
        code: 'P_NOT_PRIME',
      });
    }
    const budget = validateBudget(body.budget);
    const sample = typeof body.sampleSize === 'number' ? Math.max(0, Math.min(500, body.sampleSize)) : 10;
    const result = runBsgs(params, budget, sample);
    // 仅在成功得到确定结论（found / no_solution / undetermined 都是正常完成）后落库；
    // 参数错误在此之前已抛出，不会留下记录。
    const saved = ctx.store.saveReport(
      JSON.stringify(body),
      params.p.toString(),
      params.g.toString(),
      params.h.toString(),
      budget,
      result
    );
    return send(res, 200, { reportId: saved.id, problemKey: saved.problemKey, version: saved.version, result });
  }

  // GET /problems/:id/steps  查询碰撞步骤与见证
  const stepsMatch = path.match(/^\/problems\/(\d+)\/steps$/);
  if (method === 'GET' && stepsMatch) {
    const saved = ctx.store.getById(Number(stepsMatch[1]));
    if (!saved) throw Object.assign(new Error('报告不存在'), { code: 'NOT_FOUND' });
    if (!saved.result) {
      return send(res, 200, { report: saved, executed: false, recheck: ctx.store.recheck(saved) });
    }
    const result: BsgsResult = JSON.parse(saved.result);
    const recheck = ctx.store.recheck(saved);
    return send(res, 200, {
      report: saved,
      hit: result.hit,
      m: result.m,
      distinctBabyResidues: result.distinctBabyResidues,
      giantSteps: result.giantSteps,
      babySample: result.babySample,
      giantSample: result.giantSample,
      equation: result.equation,
      recheck,
    });
  }

  // POST /verify  独立核验用户给定 x
  if (method === 'POST' && path === '/verify') {
    const body = await readJson(req);
    const params = validateParams(body);
    if (!isPrime(params.p)) {
      throw Object.assign(new Error('p 不是素数'), { code: 'P_NOT_PRIME' });
    }
    const x = parseDecimal('x', body.x);
    const verdict = verifyCandidate(params, x);
    return send(res, 200, verdict);
  }

  // GET /problems  列表 / GET /problems/:id 详情
  if (method === 'GET' && path === '/problems') {
    return send(res, 200, { problems: ctx.store.list(Number(url.searchParams.get('limit') ?? 50)) });
  }
  const oneMatch = path.match(/^\/problems\/(\d+)$/);
  if (method === 'GET' && oneMatch) {
    const saved = ctx.store.getById(Number(oneMatch[1]));
    if (!saved) throw Object.assign(new Error('报告不存在'), { code: 'NOT_FOUND' });
    return send(res, 200, {
      report: saved,
      result: saved.result ? JSON.parse(saved.result) : null,
      recheck: ctx.store.recheck(saved),
    });
  }

  // GET /compare/:key  比较同一问题不同版本
  const cmpMatch = path.match(/^\/compare\/([A-Za-z0-9]+)$/);
  if (method === 'GET' && cmpMatch) {
    const versions = ctx.store.listByProblem(cmpMatch[1]);
    if (versions.length === 0) throw Object.assign(new Error('问题不存在'), { code: 'NOT_FOUND' });
    return send(res, 200, {
      problemKey: cmpMatch[1],
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        algorithmVersion: v.algorithmVersion,
        createdAt: v.createdAt,
        rawInput: v.rawInput,
        result: JSON.parse(v.result),
      })),
    });
  }

  // GET /export/:id  导出 JSON 见证包
  const expMatch = path.match(/^\/export\/(\d+)$/);
  if (method === 'GET' && expMatch) {
    const saved = ctx.store.getById(Number(expMatch[1]));
    if (!saved) throw Object.assign(new Error('报告不存在'), { code: 'NOT_FOUND' });
    return send(res, 200, {
      report: saved,
      result: saved.result ? JSON.parse(saved.result) : null,
      recheck: ctx.store.recheck(saved),
    });
  }

  throw Object.assign(new Error(`未知路由 ${method} ${path}`), { code: 'NOT_FOUND' });
}
export function createApp(store: Store): Server {
  const ctx: AppContext = { store };
  return createServer((req, res) => {
    handle(ctx, req, res).catch((err: unknown) => {
      const e = err as { code?: string; message?: string };
      const codeMap: Record<string, number> = {
        INVALID_TYPE: 400,
        INVALID_INTEGER: 400,
        NUMBER_TOO_LONG: 400,
        P_OUT_OF_RANGE: 400,
        G_OUT_OF_RANGE: 400,
        H_OUT_OF_RANGE: 400,
        X_OUT_OF_RANGE: 400,
        INVALID_BUDGET: 400,
        BUDGET_TOO_LARGE: 400,
        P_NOT_PRIME: 422,
        INVALID_JSON: 400,
        PAYLOAD_TOO_LARGE: 413,
        SCALE_TOO_LARGE: 422,
        NOT_FOUND: 404,
      };
      const httpCode = (e.code && codeMap[e.code]) || 500;
      send(res, httpCode, { error: e.message ?? '内部错误', code: e.code ?? 'INTERNAL' });
    });
  });
}

// 请求系统分配空闲端口
export function pickFreePort(): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close((err) => (err ? rejectPromise(err) : resolvePromise(addr && typeof addr === 'object' ? addr.port : 0)));
    });
    srv.on('error', rejectPromise);
  });
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const requested = process.env.PORT ? Number(process.env.PORT) : 0;
  const store = new Store(resolve(DATA_DIR, 'dlog.sqlite'));
  const server = createApp(store);
  const port = requested > 0 ? requested : await pickFreePort();
  server.listen(port, '127.0.0.1', () => {
    console.log(`[dlog] 服务已启动: http://127.0.0.1:${port}`);
    console.log(`[dlog] 数据库: ${resolve(DATA_DIR, 'dlog.sqlite')}`);
  });
}
