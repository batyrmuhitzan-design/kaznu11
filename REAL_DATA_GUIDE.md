# KazNU Helper — 真实数据接线指南

> 目标：让 iPhone 上每个按钮/页面都显示**真实的 Univer 数据**。
> 核心思路：App（壳）→ 你部署的后端 API → 后端用你的 Univer 账号登录后抓真实数据。

## 现在的状态

| 页面/按钮 | 现在数据 | 需要做的 |
|---|---|---|
| News | 内置真实新闻 JSON + `/api/news` | ✅ 已完成，后端也在跑 |
| GPA / Grades | 内置 3.82 + `/api/gpa` | 后端接入 Univer 真实 GPA |
| Schedule | 内置课表 + `/api/schedule` | 后端接入 Univer 课表 |
| Materials | 纯前端演示 | 新增 `/api/materials` |
| Services(图书馆/宿舍等) | 演示 | 按需加接口 |
| 登录 | Demo 密码 `123456` | 换成 Univer 真实登录 |

## 前端如何改地址（不用改源码）

地址只有一个来源：`src/utils/config.ts`（默认即 `https://1losion.me`，无需任何配置）。
需要切换到别的环境时，在项目根目录 `.env`（复制 `.env.example`）覆盖：

```
VITE_API_URL=https://1losion.me
VITE_GPA_API_URL=          # 留空 = 与主后端同源
VITE_STUDENT_ID=20260001
```

改完执行 `npm run build` 再 `npx cap sync ios`。

### HTTPS 强制策略（重要）

- 任何 `http://` 的 API 地址都会被 `normalizeBaseUrl()` **自动升级成 https://** 并在控制台告警；
- `src/services/ProfReviewsService.ts` 的 `apiFetch()` 与版本检查都会先过 `blockInsecureRequest()`，
  生产包里明文请求**不会被发出去**（直接报错返回）；
- iOS `Info.plist` 已声明 ATS：`NSAllowsArbitraryLoads = false`、`NSAllowsLocalNetworking = false`，
  即 App 内只允许 HTTPS，不保留任何明文例外；
- 本机联调若后端只有 HTTP：设 `VITE_ALLOW_INSECURE_HTTP=1`（**仅 dev 构建生效**，真机包无效）。

### 本地联调（可选）

- Web 预览 + 本机后端：`.env` 里 `VITE_API_URL=http://127.0.0.1:8000` 且 `VITE_ALLOW_INSECURE_HTTP=1`
  （dev 下会被放行并打印警告；不加开关会被拦下）；
- 手机与电脑同一 WiFi：把 `127.0.0.1` 换成电脑局域网 IP，后端用
  `uvicorn main:app --host 0.0.0.0 --port 8000` 监听（同样需要上面的开关，且仅 dev 生效）；
- 线上/真机：保持默认，所有请求走 `https://1losion.me`。

## 后端要做的真实接口（backend/main.py）

Univer 的真实数据要用**你的账号**抓，已有一个爬虫骨架 `backend/scraper.py`。
你的 `univer11.py` 已经能登录并打印表格，把它解析出的 JSON 按下面的“契约”填进 main.py 即可：

1. `GET /api/gpa` →
```json
{ "gpa": 3.82, "change": 0.04, "rank": "top 5%", "history": [3.55, 3.62, 3.70, 3.75, 3.78, 3.82] }
```
2. `GET /api/schedule?student_id=...` → 按星期分组
```json
{
  "0": [ { "id": "c1", "name": "Linear Algebra", "room": "204", "prof": "Akhmetov N.T.", "type": "lecture", "startH": 9, "startM": 0, "endH": 10, "endM": 30 } ],
  "1": []
}
```
3. `GET /api/news` → 已实现（读取 `src/data/realNews.json`）

## 打通“每个按钮”的推荐顺序

1. 把 `univer11.py` 的登录会话保存/复用（cookie）
2. 先实现 **GPA + 课表**（首页信息量最大）
3. 再做 **成绩单/学分**（Grades）
4. 最后 Materials / Services 等按真实需求扩展

## 安全提醒

- 不要把 Univer 账号密码硬编码进前端；
- 后端把账号放在**环境变量**里；
- 如果后端放公网，务必加访问控制（Token），避免别人拿你的账号去抓数据。
