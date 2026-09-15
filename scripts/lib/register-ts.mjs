/**
 * 注册 TS 解析钩子（供 `node --import ./scripts/lib/register-ts.mjs <script>` 使用）。
 * 见 ts-resolve.mjs 的说明。
 */
import { register } from "node:module";

register(new URL("./ts-resolve.mjs", import.meta.url).href);
