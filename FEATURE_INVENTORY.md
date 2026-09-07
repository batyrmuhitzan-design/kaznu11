# KazNU Helper — 页面功能清单 & 真实数据接线矩阵

> 目的：把 App 里「每个页面 / 每个按钮」先盘点全，再决定接哪些真实数据。
>
> 图例：
> - 🟢 已接/有真实数据
> - 🟡 已有后端占位接口（返回 mock）
> - 🔴 纯前端演示，还没有接口
>
> 数据来源分三类：
> A = 学生个人数据（课表/成绩/学籍，需用账号登录 Univer 抓）
> B = 公共数据（新闻/公告/文件，可直接抓）
> C = 本地数据（主题、语言、已读、登录态，无需后端）

---

## 0. 登录（入口页）

| 按钮/功能 | 现在的数据 | 真实方案 | 后端 | 状态 |
|---|---|---|---|---|
| 学号/密码登录 | Demo：任意用户名 + `123456` | 调 Univer 登录，成功后返回 token + 学生信息 | `POST /api/auth/login` | 🔴 |
| 记住账号/自动登录 | localStorage 存 15 天 | 换成后端 token（JWT），过期重登 | token 校验 `GET /api/auth/me` | 🟡 |
| 密码错误提示/震动 | 本地模拟 | 后端返回 401 即触发 | — | 🔴 |

接真实登录后，展示的姓名/学号/头像都来自 `GET /api/auth/me`。

---

## 1. 首页 Dashboard

| 区块/按钮 | 功能 | 现在数据 | 真实方案 | 接口 | 状态 |
|---|---|---|---|---|---|
| 顶部日期/问候 | 学期周数 + 问候 | 写死 | 从真实校历/开学日算 | `GET /api/semester` | 🔴 |
| 🔔 铃铛 | 跳通知中心 + 未读数 | 本地算 | Univer 站内信/公告未读 | `GET /api/notifications?unread=1` | 🔴 |
| 头像 AB | 进个人页 | 写死 Aisha | 真实账号头像/姓名 | `GET /api/auth/me` | 🔴 |
| 主课程卡+倒计时 | 下一节课开始/结束倒计时 | 内置 4 节课 + 本地时钟 | 真实今天课表实时算 | `GET /api/schedule`（按天） | 🟡 |
| 🏠 房间导航 Navigate | 跳 2GIS 搜楼栋地址 | 楼栋地址表写死 | 课程表里给真实楼栋→地址/2GIS id | 来自课表数据 | 🔴 |
| GPA 卡片 | 累计 GPA + 红橙绿进度 | `/api/gpa`（本地 mock） | Univer GPA 真实值 | `GET /api/gpa` | 🟡 |
| 快捷入口 | Materials / Calendar / Services | 本地跳转 | —（纯导航） | — | ✅ 无需后端 |
| See All | 跳完整课表 | — | — | — | ✅ |
| 课表提醒(闹钟) | 课前 30 分钟提醒/响铃 | 本地定时 | 原生本地通知 | 来自课表数据 | 🔴 |

---

## 2. 新闻 News

| 按钮/功能 | 现在的数据 | 真实方案 | 接口 | 状态 |
|---|---|---|---|---|
| 新闻列表 | 内置真实 JSON（univer 抓取快照） | Univer「Жаңалықтар」页实时抓 | `GET /api/news` | 🟢（内容真实，频率=快照） |
| 点进详情 | 同 JSON | 完整正文 + 附件/链接 | `GET /api/news/{id}` | 🟢 |
| 通知开关 | 本地偏好 | — | — | ✅ |
| Web 外链(如 Coursera) | 静态文本链接 | 可点击跳转 | 前端处理 | 🔴 |

> 新闻想要"每天都最新"，只需把后台定时抓取跑起来（你的 univer11.py 思路），App 端不用改。

---

## 3. 课表 Schedule

| 按钮/功能 | 现在的数据 | 真实方案 | 接口 | 状态 |
|---|---|---|---|---|
| 星期条 Mon~Sat | 本地切换 | 真实周课表 | `GET /api/schedule?week=...` | 🟡 |
| 课程卡片（可展开） | 内置 4 门课 | Univer 课表 | 同上 | 🟡 |
| 教室/老师/起止时间 | 写死 | 课表含 room/prof/时间 | 同上 | 🟡 |
| 当前时间红线 NOW | 本地时钟 | 真实当前时间 | — | ✅ |
| 点名/考勤 ✓ | 演示 | Univer 考勤页 | `GET /api/attendance` | 🔴 |
| 在线测试/МООDLE | 入口文本 | 跳 Univer/Moodle 链接 | 前端外链 | 🔴 |
---

## 4. 成绩 Grades

| 按钮/功能 | 现在的数据 | 真实方案 | 接口 | 状态 |
|---|---|---|---|---|
| 累计 GPA 大数字 | 内置 3.82 | Univer GPA | `GET /api/gpa` | 🟡 |
| GPA 历史折线 | 内置数组 | 各学期 GPA | `GET /api/gpa/history` | 🔴 |
| 学位目标/还差多少 | 前端算法 | 真实学分+GPA 算 | `GET /api/gpa/plan` | 🔴 |
| 各学期手风琴 | 内置 3 学期 | Univer 成绩/Журнал | `GET /api/semesters` | 🔴 |
| 课程成绩/学分/老师 | 内置 | 同上 | `GET /api/semesters/{id}` | 🔴 |
| ECTS/剩余学分 | 内置 | 教学计划数据 | `GET /api/degree-plan` | 🔴 |
| What-If 模拟 | 本地算法 | 本地即可（输入真实 GPA） | — | ✅ |
| 导出 PDF / 雷达图 | 占位 | 原生 PDF 导出 | 前端+后端数据 | 🟢 PDF 已接入 jsPDF+Share；雷达图仍为占位 |

---

## 5. 学习资料 Materials

| 按钮/功能 | 现在的数据 | 真实方案 | 接口 | 状态 |
|---|---|---|---|---|
| 课程资料分组 | 内置静态 | Moodle / Univer 课程文件 | `GET /api/materials?course=...` | 🔴 |
| 搜索框 | 本地过滤 | 本地过滤（数据来自后端） | — | ✅ |
| 下载按钮 | 本地打勾“已保存” | 真实下载存 iPhone(Filesystem) | `GET /api/materials/{id}/file` | 🟢 iOS：jsPDF 生成真实文件写入 Documents + 系统分享 |

> 文件下载 + 存到 iPhone 是原生能力，需要 `@capacitor/filesystem`，工作量中。

---

## 6. 服务 Services（Campus Hub）

### 6.1 Univer 系统面板
| 按钮/功能 | 现在的数据 | 真实方案 | 接口 | 状态 |
|---|---|---|---|---|
| 系统状态/同步时间 | 本地计时 | 后端存活状态 | `GET /health` | 🔴 |
| 注册/Journal/成绩单/在线测试/债务等瓷片 | 本地文本 | Univer 各模块 | 各独立 `GET /api/univer/{module}` | 🔴 |
| 刷新按钮 | 模拟转圈 | 真拉取 | — | 🔴 |

### 6.2 宿舍
| 按钮/功能 | 现在的数据 | 真实方案 | 接口 | 状态 |
|---|---|---|---|---|
| 宿舍/房间/水电 | 写死 | 物业系统（无公开 API 较难） | `GET /api/dorm` | 🔴 |
| 宿舍费余额/到期日 | 写死 30 天 | Univer/财务缴费单 | `GET /api/dorm/fee` | 🔴 |
| 缴费跳 Kaspi | 占位 | Kaspi 深链+缴费单号 | 后端生成 | 🔴 |
| 楼栋 2GIS 导航 | 短链 | 宿舍真实地址 | 同 2GIS | 🔴 |

### 6.3 上课闹钟（Course Radar）
| 按钮/功能 | 现在的数据 | 真实方案 | 接口 | 状态 |
|---|---|---|---|---|
| 每门课闹钟开关 | localStorage | 真实课表+原生通知 | 来自课表数据 | 🟡 |

### 6.4 全部服务格子
| 服务 | 状态 | 建议真实来源 |
|---|---|---|
| Library / 借书证 | 🔴 | 图书馆系统 |
| Scholarship | 🔴 | Univer 奖学金模块 |
| Unicard | 🔴 | 校园卡余额 |
| Cafeteria / Medical | 🔴 | 多为信息/导航 |
| Electricity / Water / Internet | 🔴 | 宿舍物业 |
| 学生 анкета | 🔴 | Univer 学籍个人信息 |


---

## 7. 通知 Notifications

| 按钮/功能 | 现在的数据 | 真实方案 | 接口 | 状态 |
|---|---|---|---|---|
| 通知列表/未读红点 | 内置 3 条 | Univer「Хабарламалар/Жаңалықтар」 | `GET /api/notifications` | 🔴 |
| 全部已读 | 本地 id | 后端标记已读 | `POST /api/notifications/read-all` | 🔴 |
| 点通知跳页 | 本地跳转 | 通知带目标路由 | payload 带 route | 🔴 |

---

## 8. 个人 / 设置 / 关于

| 功能 | 现在的数据 | 真实方案 | 接口 | 状态 |
|---|---|---|---|---|
| 姓名/学号/专业/年级 | 写死 Aisha | 真实账号信息 | `GET /api/auth/me` | 🔴 |
| 外观/语言/通知偏好 | localStorage | 本地 | — | ✅ |
| 主题切换 | 本地 | 本地 | — | ✅ |
| 退出登录 | 清本地会话 | 后端使 token 失效 | `POST /api/auth/logout` | 🔴 |

---

## 9. 原生能力（iOS 包相关）

| 能力 | 用途 | 依赖 | 状态 |
|---|---|---|---|
| 触感震动 | 按钮/错误反馈 | Web Vibration → UIImpactFeedback | 🟡 web 版已有 |
| 本地通知 | 课前 30 分钟提醒 | `@capacitor/local-notifications` | 🔴 |
| Live Activity | 锁屏倒计时 | ActivityKit（复杂） | 🔴 占位 |
| 闹钟声音 | 提醒 | Capacitor Audio | 🔴 |
| 2GIS/Kaspi 深链 | 外部跳转 | `@capacitor/app-launcher` | 🔴 |
| PDF 导出 | 成绩单 | Filesystem + Sharing | 🟢 jsPDF 生成 + Share Sheet |

---

## 建议接线优先级

1. 🥇 **真实登录**（`/api/auth/login`）——所有个人数据的前提
2. 🥈 **GPA / 成绩单**（接口少、效果直观）
3. 🥉 **课表**（首页倒计时 + Schedule 联动）
4. **新闻定时刷新**（已 90%，只差把抓取挂定时任务）
5. 通知 / 学籍 анкета
6. Materials 下载（原生文件系统单独排期）
7. 宿舍水电（物业若无 API 只能演示/外链）

> 步骤 1–4：只要把 `univer11.py` 的登录+解析逻辑搬进 `backend/`，App 端 UI 基本不用再改——它已经按上面这些接口契约去请求了。

