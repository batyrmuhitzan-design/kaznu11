#!/usr/bin/env node
/**
 * 守卫：两个"线上验证"脚本必须保持**能自己打扫现场**。
 *
 *   npm run verify:live
 *
 * 为什么需要它（这个坑线上真实发生过两轮）：
 *   `backend/tests/check_live_e2e.py` 每次运行都会 POST /notifications/broadcast，
 *   也就是给**全校每一台设备**推一条广播（真机顶部横幅 + 系统通知）。
 *   一旦它不再清理 —— 有人重构时把 `finally:` 写掉了、或者新加一条广播却忘了
 *   `track_broadcast()` —— 线上就永久留下 '1111' / 'E2E 广播' 这类测试数据，
 *   用户看到的现象是"App 里写死了测试内容"，排查成本极高。
 *   而 `check_live_server.py` 是唯一会在部署后**主动指出**"真机横幅上是测试数据"的检查。
 *
 * 判定方式：静态断言 + **负向夹具**（把修复前的坏代码喂给同一组选择器，必须报错）。
 *   否则"全绿"可能只是因为断言写错了、永远匹配不到任何东西。
 *
 * 两个脚本在仓库里是**源码**（不是产物），所以文件缺失 = 失败，不用 [--] 跳过。
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const E2E = "backend/tests/check_live_e2e.py";
const SERVER = "backend/tests/check_live_server.py";

for (const rel of [E2E, SERVER]) {
  if (!fs.existsSync(path.join(root, rel))) {
    console.error(`  [!!] 找不到 ${rel} —— 线上验证脚本被删/挪走了？`);
    console.error("       它们是「部署后必做」的检查，见 backend/README.md");
    process.exit(1);
  }
}
const e2e = fs.readFileSync(path.join(root, E2E), "utf8");
const server = fs.readFileSync(path.join(root, SERVER), "utf8");

// ── 选择器 ────────────────────────────────────────────────────────────────
// 广播创建点：必须是 `"/notifications/broadcast"` 紧接 `"POST"` 的**真实调用**
// （单行 `call("/notifications/broadcast", "POST", …)` 与多行写法都要能认出），
// 但不匹配报错信息里的 `bad(f"POST /notifications/broadcast → HTTP 500")` 这种文本。
const BROADCAST_CALL = /"\/notifications\/broadcast"\s*,\s*"POST"/g;
/** 未被 track_broadcast 记账的广播创建点数量（期望 0）。 */
const untrackedBroadcasts = (src) =>
  [...src.matchAll(BROADCAST_CALL)].filter(
    (m) => !src.slice(m.index, m.index + 1200).includes("track_broadcast("),
  ).length;

/** 取某个顶层函数的函数体（到下一个顶层 def / if __name__ 为止）。 */
const fnBody = (src, name) => {
  const start = src.indexOf(`def ${name}(`);
  if (start < 0) return "";
  const rest = src.slice(start);
  const end = rest.search(/\n(?=def |async def |if __name__)/);
  return end < 0 ? rest : rest.slice(0, end);
};

/** 清理调用点（排除 `def cleanup_test_broadcasts(...)` 自己的签名）。 */
const cleanupCalls = (src) =>
  [...src.matchAll(/cleanup_test_broadcasts\(([^)]*)\)/g)]
    .map((m) => m[1])
    .filter((arg) => arg !== "ids: list[str]");

// ── 1) check_live_e2e.py ─────────────────────────────────────────────────
const e2eCleanup = fnBody(e2e, "cleanup_test_broadcasts");
const e2eChecks = [
  // 广播创建必须全部记账，否则清理时漏掉 → 永久测试横幅
  ["每条广播创建都被 track_broadcast 记账", untrackedBroadcasts(e2e), 0],
  ["确实存在广播创建点（断言不是空转）", [...e2e.matchAll(BROADCAST_CALL)].length, 2],
  // 清理必须在 finally 里：断言失败 / 中途抛错也要打扫
  ["清理调用点唯一", cleanupCalls(e2e).length, 1],
  [
    "清理在 finally 块内（不是正常路径末尾）",
    /finally:[\s\S]{0,400}?cleanup_test_broadcasts\(CREATED_BROADCAST_IDS\)/.test(e2e),
    true,
  ],
  // 清理失败必须"响"，不能静默
  ["后台登录失败时报错而非静默返回", /无法登录后台清理测试广播[\s\S]{0,300}?return/.test(e2eCleanup), true],
  ["下线失败时报错并给手动链接", /下线测试广播失败[\s\S]{0,120}?手动/.test(e2eCleanup), true],
  ["下线后复查 /notifications/latest 真的看不见了", e2eCleanup.includes("/notifications/latest"), true],
  ["复查仍生效时报错（不假装成功）", /latest_id in ids[\s\S]{0,200}?bad\(/.test(e2eCleanup), true],
  // 标题带时间戳 → 万一残留能一眼搜到
  ["广播标题带 STAMP（孤儿数据可搜）", /\{STAMP\}/.test(e2e), true],
  // 不能写死站点/凭据
  ["站点可用 KAZNU_SITE 覆盖", /KAZNU_SITE/.test(e2e), true],
  ["后台凭据可用环境变量覆盖", /KAZNU_ADMIN_PASSWORD/.test(e2e), true],
];

// ── 2) check_live_server.py ──────────────────────────────────────────────
const serverChecks = [
  ["横幅卫生检查存在（JUNK_PATTERNS）", /JUNK_PATTERNS/.test(server), true],
  ["只扫 is_active = 1 的广播（真机会显示的那些）", /is_active = 1/.test(server), true],
  ["命中测试数据时判失败并指名处理方式", /if hit:[\s\S]{0,220}?bad\(/.test(server), true],
  ["打印当前最新生效通知（运维一眼看到内容）", /最新生效通知/.test(server), true],
  ["横幅问题给出一键下线链接（不用去翻后台）", /deactivate-notification\?pks=/.test(server), true],
  ["保留迁移补列检查（老库是否真 ALTER）", /pushed_at[\s\S]{0,200}?deleted_by/.test(server), true],
  ["保留 /app 子路径部署检查", /相对路径/.test(server), true],
];

// ── 3) 负向夹具：同一组选择器必须能识破坏代码 ──────────────────────────
const BAD_UNTRACKED = `
    frame_a, (status_a, res_a) = await asyncio.gather(
        wait_for(dana_ws, "broadcast", timeout=13),
        asyncio.to_thread(call, "/notifications/broadcast", "POST", {"title": "第 3 条"}, admin_token),
    )
    ok("第三条广播已发出")
`;
// 反向夹具：写法正确（单行调用 + 紧跟着记账）不能误报，否则守卫会被当成噪音删掉
const GOOD_TRACKED = `
    (status_c, res_c) = await asyncio.to_thread(call, "/notifications/broadcast", "POST", {"title": "第 3 条"}, admin_token)
    track_broadcast(res_c, (res_c or {}).get("broadcast") or {})
`;
const BAD_NO_FINALLY = `
if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        bad(f"E2E 中断：{exc}")
    cleanup_test_broadcasts(CREATED_BROADCAST_IDS)
`;
const BAD_SILENT_CLEANUP = `
def cleanup_test_broadcasts(ids: list[str]) -> None:
    opener = admin_login()
    if opener is None:
        return
    with opener.open(urllib.request.Request(url, method="GET"), timeout=30) as res:
        code = res.status
    ok(f"已下线 {len(ids)} 条")
`;
const BAD_SERVER_NO_HYGIENE = `
active = con.execute("select id, title from global_notifications where is_active = 1").fetchall()
for row in active:
    if "测试" in row[1]:
        print(f"  提示：{row[1]} 看起来像测试数据", flush=True)
if residue:
    print(f"  已停用的历史记录 = {residue} 条", flush=True)
`;

const fixtureChecks = [
  ["新增广播不记账（坏代码）", untrackedBroadcasts(BAD_UNTRACKED), 1],
  ["单行正确写法不误报（好代码）", untrackedBroadcasts(GOOD_TRACKED), 0],
  ["有 finally 但清理在外面（坏代码）", /finally:[\s\S]{0,400}?cleanup_test_broadcasts\(CREATED_BROADCAST_IDS\)/.test(BAD_NO_FINALLY), false],
  ["登录失败静默返回（坏代码）", /无法登录后台清理测试广播[\s\S]{0,300}?return/.test(BAD_SILENT_CLEANUP), false],
  ["清理后不复查最新通知（坏代码）", fnBody(BAD_SILENT_CLEANUP, "cleanup_test_broadcasts").includes("/notifications/latest"), false],
  ["横幅卫生只 print 不判失败（坏代码）", /if hit:[\s\S]{0,220}?bad\(/.test(BAD_SERVER_NO_HYGIENE), false],
];

// ── 输出 ─────────────────────────────────────────────────────────────────
let failed = 0;
console.log("\n=== 线上验证脚本守卫（跑一次不留一条测试横幅）===");
for (const [label, actual, expected] of [...e2eChecks, ...serverChecks, ...fixtureChecks]) {
  const pass = actual === expected;
  if (!pass) failed += 1;
  console.log(`  ${pass ? "[ok]" : "[!!]"} ${label} → ${JSON.stringify(actual)}（期望 ${JSON.stringify(expected)}）`);
}
console.log(failed ? `\n线上验证脚本守卫失败 ${failed} 项` : "\n线上验证脚本守卫通过");
process.exit(failed ? 1 : 0);
