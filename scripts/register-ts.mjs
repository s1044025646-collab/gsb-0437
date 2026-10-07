// 注册 .js -> .ts 解析钩子（通过 --import 注入）。
import { register } from 'node:module';

register(new URL('./ts-resolve.mjs', import.meta.url));
