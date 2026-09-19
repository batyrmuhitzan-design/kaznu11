/**
 * 社区论坛入口卡片（NodeBB 免密跳转）。
 *
 * 行为与后端 `backend/app/routers/community.py` 对齐：
 *  · 挂载时问 `GET /community/status`；**只有服务端配置齐全（enabled=true）才渲染**，
 *    否则整块不显示 —— 避免"点了没反应"或跳到一个不存在的域名；
 *  · 点击 → `POST /community/launch-token` 换一次性码 → 打开跳转 URL，
 *    后端 302 到论坛并顺手种下共享会话 cookie，NodeBB 侧免密登录/自动建号；
 *  · 取码失败（断网/未登录）时按钮回到可点状态并提示一次，不静默吞掉。
 */
import { useEffect, useState } from "react";
import { useI18n } from "../contexts/LanguageContext";
import { loadCommunityStatus, openCommunityForum } from "../services/CommunityService";

export default function CommunityEntry() {
  const t = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [forumUrl, setForumUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadCommunityStatus().then((status) => {
      if (cancelled || !status) return;
      setEnabled(status.enabled);
      setForumUrl(status.forumUrl);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;

  const onOpen = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await openCommunityForum();
    if (!ok) {
      setFailed(true);
      setBusy(false);
    }
    // 成功时页面会跳走（网页端）或停在原地（原生端开了应用内 Safari），无需复位
  };

  return (
    <div className="glass squircle-lg p-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">💬</span>
        <p className="text-sm font-semibold">{t("communityTitle")}</p>
      </div>
      <p className="text-[11px] leading-relaxed text-[color:var(--tx-3)]">
        {failed ? t("communityFailed") : t("communityBody")}
      </p>
      <button
        type="button"
        onClick={() => void onOpen()}
        disabled={busy}
        aria-busy={busy}
        className="haptic-action w-full py-3 squircle-lg text-sm font-bold disabled:opacity-60"
        style={{ background: "var(--accent)", color: "var(--accent-contrast, #fff)" }}
      >
        {busy ? t("communityOpening") : t("communityOpen")}
      </button>
      {forumUrl ? (
        <p className="text-[10px] leading-snug text-[color:var(--tx-5)]">
          {t("communityAccountNote")}
        </p>
      ) : null}
    </div>
  );
}
