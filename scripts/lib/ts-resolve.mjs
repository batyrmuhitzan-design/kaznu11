/**
 * Node ESM 解析钩子：允许 `import "../utils/config"` 这种**不带扩展名**的 TS 写法。
 *
 * 为什么需要：仓库里的相对导入都是 bundler 风格（`../utils/config`，靠 Vite 解析）。
 * 守卫脚本要**真跑**这些模块（Node 24 能直接执行 TS），就必须把缺省的 `.ts` / `.tsx`
 * 补回来，否则 `ERR_MODULE_NOT_FOUND`。
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) {
      for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        try {
          return await next(specifier + suffix, context);
        } catch {
          /* 继续尝试下一个后缀 */
        }
      }
    }
    throw error;
  }
}
