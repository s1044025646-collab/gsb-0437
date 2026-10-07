// 仅用于开发/测试：将相对的 ".js" 导入解析到同路径 ".ts" 源文件。
// 正式构建仍由 tsc 输出真实 .js。
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    specifier.endsWith('.js')
  ) {
    try {
      const parentURL = context.parentURL ?? pathToFileURL(process.cwd() + '/').href;
      const candidate = new URL(specifier.replace(/\.js$/, '.ts'), parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    } catch {
      // 落到默认解析
    }
  }
  return nextResolve(specifier, context);
}
