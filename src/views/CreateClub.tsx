/**
 * CreateClubScreen —— 申请创建社团 / 组织（Campus Hub → Clubs & Events）。
 *
 * 对接：`POST /api/v1/clubs/apply`（multipart/form-data：字段 + 社团 Logo 文件）
 *
 * 设计要点
 * --------
 * 1. **头像走系统相册**（`<input type="file" accept="image/*">` 在 iOS WebView 里
 *    直接唤起原生相册），选完立刻本地预览，提交时才异步上传 —— 复用 UploadService
 *    的 canvas 压缩（iPhone 原图 3-8 MB → ~400 KB），不是第二套上传实现；
 * 2. 负责人信息默认自动关联当前登录学生（后端在 contact_name 为空时回填显示名），
 *    这里只做"可覆盖"的可选输入；
 * 3. 提交后**不会**立刻出现在公开列表 —— 后端默认 status=pending，由管理员在
 *    /admin 审核。所以成功态文案必须说清"等待审核"，不能让用户以为没生效。
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import { hapticTap, hapticSuccess } from "../utils/haptics";
import { useKeyboardOpen } from "../utils/keyboard";
import { compressImage } from "../services/UploadService";
import {
  CLUB_CATEGORIES,
  CLUB_CATEGORY_EMOJI,
  CLUB_CATEGORY_KEY,
  applyForClub,
  type ClubCategory,
} from "../services/ClubService";

const MAX_NAME = 160;
const MAX_DESC = 2000;

export default function CreateClub({
  onBack,
  onSubmitted,
}: {
  onBack: () => void;
  onSubmitted?: () => void;
}) {
  const t = useI18n();
  const toast = useToast();
  const kbOpen = useKeyboardOpen();

  const [name, setName] = useState("");
  const [category, setCategory] = useState<ClubCategory>("academic");
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [phone, setPhone] = useState("");

  /** 本地预览 URL（objectURL，选图后立刻显示，不等上传） */
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  /** 压缩后的 Logo Blob（提交时才上传） */
  const avatarBlobRef = useRef<Blob | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);

  // 键盘弹出时把描述输入框滚到视野中间（与写评价页同一套处理）
  useEffect(() => {
    if (kbOpen) descRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [kbOpen]);

  // objectURL 必须显式释放，否则反复换图会一直占内存
  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  const pickAvatar = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    hapticTap();
    const blob = await compressImage(file);
    avatarBlobRef.current = blob ?? file;
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(URL.createObjectURL(avatarBlobRef.current));
  };

  const canSubmit = name.trim().length >= 2 && description.trim().length >= 10 && !sending;

  const submit = async () => {
    if (!canSubmit) return;
    setSending(true);
    const result = await applyForClub({
      clubName: name,
      category,
      description,
      contactName,
      contactTelegram: telegram,
      contactPhone: phone,
      avatar: avatarBlobRef.current,
    });
    setSending(false);

    if (result.ok) {
      void hapticSuccess();
      setDone(true);
      onSubmitted?.();
      return;
    }
    if (result.reason === "unauth") toast.push(t("clubApplyUnauth"), "error");
    else if (result.reason === "duplicate") toast.push(t("clubApplyDuplicate"), "error");
    else if (result.reason === "invalid") toast.push(t("clubApplyInvalid"), "error");
    else toast.push(t("clubApplyFailed"), "error");
  };

  // ---- 成功态：必须说清"等待审核"，否则用户会以为按钮没用 ----
  if (done) {
    return (
      <div className="app-surface h-full flex flex-col overflow-hidden">
        <div className="screen-pin px-4 pt-1 shrink-0 flex items-center">
          <button
            type="button"
            onClick={onBack}
            className="haptic-action text-sm font-semibold"
            style={{ color: "var(--accent-soft-text)" }}
          >
            ‹ {t("back")}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-10 pb-28">
          <div className="glass squircle-lg p-7 flex flex-col items-center text-center gap-3">
            <span className="text-4xl">🎉</span>
            <p className="text-lg font-bold text-white">{t("clubSubmittedTitle")}</p>
            <p className="theme-muted text-sm leading-relaxed">{t("clubSubmittedHint")}</p>
            <div
              className="mt-1 px-3 py-1.5 rounded-full text-[11px] font-bold"
              style={{ background: "var(--warm-soft-bg)", color: "var(--warm-soft-text)" }}
            >
              {t("clubStatusPending")}
            </div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="haptic-action btn-accent w-full mt-5 py-3.5 squircle-sm text-sm font-bold"
          >
            {t("done")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      {/* 顶栏：与全局一致的吸顶结构（滚动容器之外） */}
      <div className="screen-pin px-4 pt-1 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            className="haptic-action text-sm font-semibold"
            style={{ color: "var(--accent-soft-text)" }}
          >
            ‹ {t("back")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="haptic-action px-3.5 py-2 squircle-sm text-xs font-bold disabled:opacity-40"
            style={{ background: "var(--accent)", color: "var(--on-accent)" }}
          >
            {sending ? "…" : t("clubSubmit")}
          </button>
        </div>
      </div>

      <div className="kb-pad flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-24 space-y-4">
        {/* 社团 Logo：相册选图 + 实时预览 */}
        <div className="glass squircle-lg p-4 flex items-center gap-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void pickAvatar(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="haptic-action w-20 h-20 squircle-md flex items-center justify-center overflow-hidden shrink-0"
            style={{ background: "var(--field-2)", border: "1px solid var(--hairline)" }}
            aria-label={t("clubAvatar")}
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl">🖼️</span>
            )}
          </button>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">{t("clubAvatar")}</p>
            <p className="text-xs mt-1" style={{ color: "var(--tx-5)" }}>
              {t("clubAvatarHint")}
            </p>
            {avatarPreview && (
              <button
                type="button"
                onClick={() => {
                  hapticTap();
                  if (avatarPreview) URL.revokeObjectURL(avatarPreview);
                  setAvatarPreview(null);
                  avatarBlobRef.current = null;
                }}
                className="haptic-action text-xs font-semibold mt-1.5"
                style={{ color: "var(--danger)" }}
              >
                {t("removePhoto")}
              </button>
            )}
          </div>
        </div>

        {/* 社团名称 */}
        <div>
          <p className="theme-section-title text-xs font-semibold mb-1.5">{t("clubName")}</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME}
            placeholder={t("clubNamePlaceholder")}
            className="field-surface w-full squircle-md px-3.5 py-3 text-sm text-white outline-none placeholder:text-[color:var(--tx-7)]"
          />
        </div>

        {/* 分类（Chip 选择，横向可滚动） */}
        <div>
          <p className="theme-section-title text-xs font-semibold mb-1.5">{t("clubCategory")}</p>
          <div className="chip-scroller flex gap-1.5 overflow-x-auto pb-1">
            {CLUB_CATEGORIES.map((id) => {
              const active = category === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    hapticTap();
                    setCategory(id);
                  }}
                  className="haptic-action pill-chip shrink-0"
                  style={{
                    background: active ? "var(--accent)" : "var(--field-2)",
                    color: active ? "var(--on-accent)" : "var(--tx-3)",
                  }}
                >
                  {CLUB_CATEGORY_EMOJI[id]} {t(CLUB_CATEGORY_KEY[id] as never)}
                </button>
              );
            })}
          </div>
        </div>

        {/* 简介 / 招新宣言 */}
        <div>
          <p className="theme-section-title text-xs font-semibold mb-1.5">{t("clubDescription")}</p>
          <textarea
            ref={descRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={MAX_DESC}
            placeholder={t("clubDescriptionPlaceholder")}
            className="field-surface w-full squircle-md p-3.5 text-sm text-white outline-none placeholder:text-[color:var(--tx-7)] resize-none leading-relaxed"
          />
          <p className="text-[10px] text-right mt-1" style={{ color: "var(--tx-7)", fontFamily: "JetBrains Mono" }}>
            {description.length}/{MAX_DESC}
          </p>
        </div>

        {/* 联系人 / 负责人（留空 = 自动用当前登录学生） */}
        <div className="space-y-2.5">
          <p className="theme-section-title text-xs font-semibold">{t("clubContact")}</p>
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder={t("clubContactNamePlaceholder")}
            className="field-surface w-full squircle-md px-3.5 py-3 text-sm text-white outline-none placeholder:text-[color:var(--tx-7)]"
          />
          <div className="flex gap-2.5">
            <input
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder={t("clubTelegramPlaceholder")}
              className="field-surface flex-1 min-w-0 squircle-md px-3.5 py-3 text-sm text-white outline-none placeholder:text-[color:var(--tx-7)]"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder={t("phone")}
              className="field-surface flex-1 min-w-0 squircle-md px-3.5 py-3 text-sm text-white outline-none placeholder:text-[color:var(--tx-7)]"
            />
          </div>
          <p className="text-[10px] leading-relaxed" style={{ color: "var(--tx-6)" }}>
            {t("clubContactHint")}
          </p>
        </div>

        {/* 提交（键盘弹起时会被 .kb-pad 顶起，不被输入法压住） */}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="haptic-action btn-accent w-full py-3.5 squircle-md text-sm font-bold disabled:opacity-40"
        >
          {sending ? t("clubSubmitting") : t("clubSubmit")}
        </button>
        <p className="text-[10px] text-center leading-relaxed" style={{ color: "var(--tx-6)" }}>
          {t("clubReviewHint")}
        </p>
      </div>
    </div>
  );
}
