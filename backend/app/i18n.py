"""管理后台多语言（EN / RU / ZH）。

为什么需要这个模块
==================

SQLAdmin 0.31.1 自带 gettext catalog 只有 ``en / de / az / ru / tr`` 五种语言：

    sqladmin/i18n.py:  SUPPORTED_LOCALES = ["en", "de", "az", "ru", "tr"]

也就是说 **没有中文**（也没有哈萨克语）。但它把语言列表和已加载的 catalog 放在两个
模块级可变对象里，中间件与 ``set_locale()`` 都是在**调用时**读取这两个对象的：

    sqladmin/i18n.py:  set_locale(locale)  →  locale if locale in translations else "en"
    sqladmin/i18n.py:  LocaleMiddleware    →  if requested in SUPPORTED_LOCALES: ...

所以只要在 ``Admin(...)`` 构造之前把 ``zh`` 追加进去（本模块 ``register_catalogs()``），
``?lang=zh`` 就会生效，而且不用 fork / 打补丁 SQLAdmin 的源码。

本模块提供两样东西：

1. ``register_catalogs()``
   把仓库自带的中文 catalog（``backend/locales/translations/zh/LC_MESSAGES/admin.mo``）
   注册进 SQLAdmin 的 i18n 运行时。

2. ``L("...")`` 惰性文案
   ModelView 的名称 / 分类 / 动作按钮 / 列标题这些**业务文案**不在 SQLAdmin 的
   catalog 里，用一张小字典 + 惰性字符串翻译；渲染到模板时才解析当前语言。

语言切换器由 SQLAdmin 内置实现（``I18nConfig(language_switcher=[...])`` 会在导航栏
渲染下拉框，链接形如 ``?lang=zh``），由 ``LocaleMiddleware`` 写入 cookie 持久化。
"""
from __future__ import annotations

from pathlib import Path

from sqladmin import i18n as _sqladmin_i18n

# ---------------------------------------------------------------------------
# 基本配置
# ---------------------------------------------------------------------------

#: 对外提供的语言（顺序 = 切换器里的展示顺序）。EN 是默认语言，也是 msgid 的语言。
ADMIN_LOCALES: tuple[str, ...] = ("en", "ru", "zh")

DEFAULT_LOCALE: str = "en"

#: 语言偏好的持久化 cookie 名（与 SQLAdmin 的登录 session cookie 区分开）。
LANGUAGE_COOKIE_NAME: str = "kaznu_admin_lang"

#: 需要本仓库自己提供 catalog 的语言（SQLAdmin 内置的 en / ru 直接用）。
CUSTOM_CATALOG_LOCALES: tuple[str, ...] = ("zh",)

#: gettext domain，必须与 SQLAdmin 保持一致（sqladmin/i18n.py 用的是 "admin"）。
CATALOG_DOMAIN: str = "admin"

#: backend/locales/translations/<locale>/LC_MESSAGES/admin.mo
LOCALES_DIR: Path = Path(__file__).resolve().parents[1] / "locales" / "translations"


# ---------------------------------------------------------------------------
# 1) 把自带 catalog 注册进 SQLAdmin 的 i18n 运行时
# ---------------------------------------------------------------------------


def register_catalogs() -> list[str]:
    """把 ``CUSTOM_CATALOG_LOCALES`` 的 catalog 注册进 SQLAdmin。

    返回实际注册成功的语言列表（例如 ``["zh"]``）。以下情况会安静跳过，不影响启动：

    * 没装 babel（``BABEL_INSTALLED = False``）——此时 SQLAdmin 本身也不做翻译；
    * 找不到 ``.mo`` 文件（未执行 ``scripts/compile_admin_i18n.py``）。
    """
    registered: list[str] = []
    if not _sqladmin_i18n.BABEL_INSTALLED:
        return registered

    # babel 缺席时 sqladmin.i18n 里根本没有 translations 这个属性，故用 getattr。
    translations = getattr(_sqladmin_i18n, "translations", None)
    if translations is None:
        return registered

    from babel.support import Translations

    for locale in CUSTOM_CATALOG_LOCALES:
        try:
            catalog = Translations.load(
                dirname=LOCALES_DIR,
                locales=[locale],
                domain=CATALOG_DOMAIN,
            )
        except Exception as exc:  # pragma: no cover - 取决于部署环境
            print(f"[kaznu] ⚠️ 无法加载 {locale} 语言包: {type(exc).__name__}: {exc}")
            continue

        # 找不到 .mo 时 babel 返回 NullTranslations（没有 _catalog）；空 catalog 也跳过。
        if not getattr(catalog, "_catalog", None):
            print(
                f"[kaznu] ⚠️ 未找到 {locale} 语言包（{LOCALES_DIR}），"
                "该语言将回退到英文"
            )
            continue

        translations[locale] = catalog
        if locale not in _sqladmin_i18n.SUPPORTED_LOCALES:
            _sqladmin_i18n.SUPPORTED_LOCALES.append(locale)
        registered.append(locale)

    return registered


def current_locale() -> str:
    """返回当前请求生效的语言；不在请求上下文里时返回默认语言。"""
    getter = getattr(_sqladmin_i18n, "get_locale", None)
    if getter is None:  # babel 缺席
        return DEFAULT_LOCALE
    try:
        locale = getter()
    except Exception:  # pragma: no cover - 取决于部署环境
        return DEFAULT_LOCALE
    return locale if locale in ADMIN_LOCALES else DEFAULT_LOCALE


def build_i18n_config():
    """构造传给 ``Admin(...)`` 的 ``I18nConfig``。

    ``language_switcher`` 长度 > 1 时 SQLAdmin 会自动在导航栏渲染语言下拉框
    （``sqladmin/templates/sqladmin/layout.html`` 的 topbar 块）。
    """
    from sqladmin.i18n import I18nConfig

    return I18nConfig(
        default_locale=DEFAULT_LOCALE,
        language_cookie_name=LANGUAGE_COOKIE_NAME,
        language_header_name="Accept-Language",
        language_switcher=list(ADMIN_LOCALES),
    )


# ---------------------------------------------------------------------------
# 2) 业务文案（ModelView 名称 / 分类 / 动作按钮 / 列标题）
# ---------------------------------------------------------------------------

#: 英文原文 → 各语言译文。英文不在表里：gettext 语义下没有译文时直接用 msgid 本身。
APP_STRINGS: dict[str, dict[str, str]] = {
    "zh": {
        # ---- 导航菜单：分类 ----
        "Super Admin": "超级管理",
        "Content": "内容管理",
        # ---- 菜单项 / 页面标题（单数 + 复数）----
        "User": "用户",
        "Users": "用户",
        "Admin Application": "管理员申请",
        "Admin Applications": "管理员申请",
        "Professor": "教授",
        "Professors": "教授",
        "Course": "课程",
        "Courses": "课程",
        "Review": "评价",
        "Reviews": "评价",
        "Report": "举报",
        "Reports": "举报",
        # ---- 批量动作按钮 ----
        "🚫 Ban": "🚫 封禁",
        "✅ Unban": "✅ 解封",
        "✅ Approve": "✅ 通过",
        "❌ Reject": "❌ 驳回",
        # ---- 动作确认弹窗 ----
        "Ban the selected users?": "确定要封禁选中的用户吗？",
        "Unban the selected users?": "确定要解封选中的用户吗？",
        "Approve: promote the applicants to admin?": "确定通过？申请人将被提升为管理员。",
        "Reject the selected applications?": "确定要驳回选中的申请吗？",
        # ---- 列标题 ----
        "ID": "ID",
        "Univer Username": "校园账号",
        "Display Name": "显示名",
        "Department Tag": "院系标签",
        "Role": "角色",
        "Banned": "是否封禁",
        "Created At": "创建时间",
        "Applicant": "申请人",
        "Reason": "原因",
        "Status": "状态",
        "Name": "姓名",
        "Department": "院系",
        "Easy Rating": "轻松度",
        "Quality Rating": "教学质量",
        "Code": "课程代码",
        "Title": "课程名称",
        "Credits": "学分",
        "Comment": "评价内容",
        "Quality": "质量分",
        "Easy": "轻松分",
        "Attendance": "考勤严格度",
        "Likes": "点赞数",
        "Review ID": "评价 ID",
        "Tags": "标签",
    },
    "ru": {
        # ---- меню: категории ----
        "Super Admin": "Супер-админ",
        "Content": "Контент",
        # ---- пункты меню / заголовки страниц ----
        "User": "Пользователь",
        "Users": "Пользователи",
        "Admin Application": "Заявка администратора",
        "Admin Applications": "Заявки администраторов",
        "Professor": "Преподаватель",
        "Professors": "Преподаватели",
        "Course": "Курс",
        "Courses": "Курсы",
        "Review": "Отзыв",
        "Reviews": "Отзывы",
        "Report": "Жалоба",
        "Reports": "Жалобы",
        # ---- массовые действия ----
        "🚫 Ban": "🚫 Заблокировать",
        "✅ Unban": "✅ Разблокировать",
        "✅ Approve": "✅ Одобрить",
        "❌ Reject": "❌ Отклонить",
        # ---- подтверждения ----
        "Ban the selected users?": "Заблокировать выбранных пользователей?",
        "Unban the selected users?": "Разблокировать выбранных пользователей?",
        "Approve: promote the applicants to admin?": "Одобрить и назначить заявителей администраторами?",
        "Reject the selected applications?": "Отклонить выбранные заявки?",
        # ---- заголовки колонок ----
        "ID": "ID",
        "Univer Username": "Логин Univer",
        "Display Name": "Отображаемое имя",
        "Department Tag": "Тег факультета",
        "Role": "Роль",
        "Banned": "Заблокирован",
        "Created At": "Создано",
        "Applicant": "Заявитель",
        "Reason": "Причина",
        "Status": "Статус",
        "Name": "Имя",
        "Department": "Факультет",
        "Easy Rating": "Лёгкость",
        "Quality Rating": "Качество",
        "Code": "Код",
        "Title": "Название",
        "Credits": "Кредиты",
        "Comment": "Комментарий",
        "Quality": "Качество",
        "Easy": "Лёгкость",
        "Attendance": "Строгость посещаемости",
        "Likes": "Лайки",
        "Review ID": "ID отзыва",
        "Tags": "Теги",
    },
}


def translate(message: str) -> str:
    """把英文原文翻译成当前请求的语言（没有译文时原样返回）。"""
    return APP_STRINGS.get(current_locale(), {}).get(message, message)


class LazyAdminString(str):
    """既是普通英文 ``str``、又能在渲染时翻译的字符串。

    为什么必须**继承 str**（而不是写一个纯代理对象）：
    SQLAdmin 有些地方会把标签当**真 str** 用，最典型的是 ``models.py`` 的
    ``search_placeholder()``：

        return ", ".join(self._column_labels.get(field, field) for field in self._search_fields)

    ``str.join`` 只接受真正的 str 实例，纯代理对象会直接抛
    ``TypeError: sequence item 0: expected str instance, LazyAdminString found``
    （这是实测踩到的坑，见 backend/tests/check_admin_i18n.py）。

    继承 str 之后语义很清晰：

    * **原始值 = 英文原文**：``join`` / ``==`` / ``hash`` / 切片 / ``startswith`` 等
      一律按英文工作 —— 不会崩，也不会算错。SQLAdmin 的
      ``_column_labels_value_by_key = {v: k for k, v in ...}``（把标签当字典键）和
      ``Menu.add()`` 的 ``root.name == item.name``（合并同一分类菜单）都依赖这一点；
    * **渲染时翻译**：Jinja 的 ``{{ label }}`` 走 ``__html__()``（markupsafe 的
      ``escape()`` 优先用它），``str()`` / f-string 走 ``__str__`` / ``__format__``，
      这些都返回当前语言的译文。
    """

    __slots__ = ()

    def __new__(cls, message: str) -> "LazyAdminString":
        return super().__new__(cls, message)

    def _english(self) -> str:
        """未翻译的英文原文。

        ``str.__add__`` 返回**普通 str**，用来绕开本类覆写的 ``__str__``。
        """
        return str.__add__(self, "")

    @property
    def message(self) -> str:
        """英文原文（msgid）。"""
        return self._english()

    def __str__(self) -> str:
        return translate(self._english())

    def __repr__(self) -> str:
        return f"LazyAdminString({self._english()!r} → {str(self)!r})"

    def __html__(self) -> str:
        """Jinja / markupsafe 的渲染入口（autoescape 开启时优先于 __str__）。"""
        return translate(self._english())

    def __format__(self, format_spec: str) -> str:
        return format(translate(self._english()), format_spec)

    # 其余方法（__eq__ / __hash__ / __len__ / __add__ / startswith…）全部继承 str，
    # 行为 == 把英文原文当普通字符串用。


#: 同一原文复用**同一个实例** —— SQLAdmin 合并分类菜单用的是 ``==``，
#: 返回同一对象还能顺带保证身份比较也成立。
_LAZY_CACHE: dict[str, LazyAdminString] = {}


def L(message: str) -> LazyAdminString:
    """把一个英文文案包成惰性翻译字符串（同一文案返回同一实例）。"""
    cached = _LAZY_CACHE.get(message)
    if cached is None:
        cached = LazyAdminString(message)
        _LAZY_CACHE[message] = cached
    return cached


def make_column_labels(mapping: dict) -> dict:
    """把 ``{Model.attr: "English label"}`` 批量转成惰性标签。

    显式给出英文标签有两个好处：列标题完全由我们掌控（不依赖 SQLAdmin 的属性名
    美化规则），同时英文原文就是翻译用的 msgid。
    """
    return {attr: L(label) for attr, label in mapping.items()}
