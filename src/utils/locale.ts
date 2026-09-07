/**
 * 轻量三语工具：读取当前语言（与 LanguageContext 共用一个 localStorage key）。
 * 用于「非组件模块 / 临时补漏文案」也能给出 EN/KZ/RU 版本。
 * 组件内请优先使用 useI18n / useLanguage（带响应式）。
 */
export type Locale = "EN" | "KZ" | "RU";

export function currentLocale(): Locale {
  try {
    const saved = window.localStorage.getItem("language");
    return saved === "KZ" || saved === "RU" ? saved : "EN";
  } catch {
    return "EN";
  }
}

export type Translation = { en: string; kz: string; ru: string };

/**
 * 返回当前语言对应的文案；支持在任意语言文本里用 {x} 占位后自行 replace。
 */
export function tr(en: string, kz: string, ru: string): string {
  const locale = currentLocale();
  if (locale === "KZ") return kz;
  if (locale === "RU") return ru;
  return en;
}

/** 参数化版本：三个语言里都可用 {name} / {room} 等占位符。 */
export function trf(template: Translation, values: Record<string, string | number>): string {
  let text = tr(template.en, template.kz, template.ru);
  Object.entries(values).forEach(([key, value]) => {
    text = text.split(`{${key}}`).join(String(value));
  });
  return text;
}
