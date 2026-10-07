import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Store } from './db/store.js';
import { DlogService } from './services/dlog-service.js';

const DATA_DIR = process.env.BSGS_DATA_DIR ?? join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'bsgs.sqlite');
const PORT_ENV = process.env.BSGS_PORT ? Number(process.env.BSGS_PORT) : undefined;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('非法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 选择一个空闲端口（默认）；显式指定端口则使用该端口 */
function listen(server: Server, port: number | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // 端口 0 让操作系统分配空闲端口
    server.listen(port ?? 0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('无法获取监听端口'));
    });
  });
}

export async function startServer(): Promise<{ server: Server; port: number }> {
  const store = new Store(DB_PATH);
  const service = new DlogService(store);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      if (method === 'GET' && path === '/health') {
        return sendJson(res, 200, { ok: true, service: 'bsgs-dlog', time: new Date().toISOString() });
      }

      if (method === 'POST' && path === '/api/problems') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const budget = parseBudget(body.budget);
        const result = service.solve(
          { p: body.p, g: body.g, h: body.h },
          budget,
        );
        if (!result.ok) return sendJson(res, 400, { error: result.error });
        return sendJson(res, 201, result.value);
      }

      if (method === 'GET' && path === '/api/problems') {
        return sendJson(res, 200, { problems: service.listProblems() });
      }

      const problemMatch = path.match(/^\/api\/problems\/(\d+)$/);
      if (method === 'GET' && problemMatch) {
        const id = Number(problemMatch[1]);
        const problem = service.getProblem(id);
        if (!problem) return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `问题 ${id} 不存在` } });
        return sendJson(res, 200, { problem, reports: service.listReports(id) });
      }

      const reportMatch = path.match(/^\/api\/reports\/(\d+)$/);
      if (method === 'GET' && reportMatch) {
        const id = Number(reportMatch[1]);
        const report = service.getReport(id);
        if (!report) return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `报告 ${id} 不存在` } });
        return sendJson(res, 200, report);
      }

      const recheckMatch = path.match(/^\/api\/reports\/(\d+)\/recheck$/);
      if (method === 'POST' && recheckMatch) {
        const id = Number(recheckMatch[1]);
        const result = service.recheckWitness(id);
        if (!result.ok) return sendJson(res, 404, { error: result.error });
        return sendJson(res, 200, result.value);
      }

      if (method === 'POST' && path === '/api/verify') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const result = service.verify(body);
        if (!result.ok) return sendJson(res, 400, { error: result.error });
        return sendJson(res, 200, result.value);
      }

      if (method === 'GET' && path === '/api/compare') {
        const a = Number(url.searchParams.get('a'));
        const b = Number(url.searchParams.get('b'));
        if (!Number.isInteger(a) || !Number.isInteger(b)) {
          return sendJson(res, 400, { error: { code: 'INVALID_QUERY', message: '需要查询参数 a 与 b（问题 id）' } });
        }
        const result = service.compareVersions(a, b);
        if (!result.ok) return sendJson(res, 404, { error: result.error });
        return sendJson(res, 200, result.value);
      }

      if (method === 'GET' && path === '/api/export') {
        return sendJson(res, 200, service.exportAll());
      }

      return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `未知路径: ${method} ${path}` } });
    } catch (err) {
      return sendJson(res, 500, {
        error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  const port = await listen(server, PORT_ENV);
  return { server, port };
}

function parseBudget(raw: unknown) {
  if (!raw || typeof raw !== 'object') return {};
  const b = raw as Record<string, unknown>;
  const budget: { maxBabySteps?: bigint; maxGiantSteps?: bigint; previewLimit?: number } = {};
  if (typeof b.maxBabySteps === 'string' && /^\d+$/.test(b.maxBabySteps)) {
    budget.maxBabySteps = BigInt(b.maxBabySteps);
  }
  if (typeof b.maxGiantSteps === 'string' && /^\d+$/.test(b.maxGiantSteps)) {
    budget.maxGiantSteps = BigInt(b.maxGiantSteps);
  }
  if (typeof b.previewLimit === 'number') budget.previewLimit = b.previewLimit;
  return budget;
}

const isMain = process.argv[1] && process.argv[1].endsWith('server.ts');
if (isMain) {
  startServer()
    .then(({ port }) => {
      console.log(`BSGS 离散对数后端已启动: http://127.0.0.1:${port}`);
      console.log(`数据目录: ${DATA_DIR}`);
      console.log('可用端点: GET /health, POST /api/problems, GET /api/problems,');
      console.log('  GET /api/problems/:id, GET /api/reports/:id, POST /api/reports/:id/recheck,');
      console.log('  POST /api/verify, GET /api/compare?a=&b=, GET /api/export');
    })
    .catch((err) => {
      console.error('启动失败:', err);
      process.exit(1);
    });
}
