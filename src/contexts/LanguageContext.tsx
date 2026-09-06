import { createContext, useContext, useState, type ReactNode } from "react";
import { screenFade } from "../utils/screenFade";

export type Language = "EN" | "KZ" | "RU";
type TranslationKey =
  | "home" | "grades" | "schedule" | "services" | "back" | "settings" | "about"
  | "appearance" | "preferences" | "theme" | "chooseTheme" | "notifications" | "enabled"
  | "language" | "english" | "kazakh" | "russian" | "version" | "university"
  | "quickAccess" | "today" | "seeAll" | "academicRecord" | "semesters"
  | "exportPdf" | "radarChart" | "campusHub" | "refresh" | "libraryCard" | "showBarcode"
  | "aboutDescription" | "computerScience" | "year";
type ExtendedTranslationKey =
  | "week" | "fall" | "goodMorning" | "room" | "startsIn" | "endsIn" | "minutes" | "lecture" | "lab" | "exam" | "seminar" | "calendar" | "navigate"
  | "cumulativeGpa" | "top" | "thisSemester" | "nextDeadline" | "hoursLeft" | "assignment" | "dueToday"
  | "credits" | "of" | "track" | "whatIf" | "projectedGpa" | "ifAlgorithm" | "onTrack" | "allServices"
  | "allSystems" | "degradedCache" | "offlineCache" | "registration" | "hide" | "show" | "dormUtilities"
  | "balance" | "noIssues" | "uptime" | "topUp" | "courseRadar" | "liveMonitoring" | "watching" | "full"
  | "spots" | "present" | "noClasses" | "syncing" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"
  | "library" | "dorm" | "unicard" | "scholarship" | "cafeteria" | "medical" | "electricity" | "water" | "internet" | "on" | "off";
type NewsTranslationKey = "news" | "published" | "loadingNews" | "live" | "latestNews" | "viewAll" | "newsNotifications" | "muted" | "markAllRead" | "newMessages";
type ExtraTranslationKey =
  | "noMoreToday" | "degreePlan" | "targetStandard" | "justGraduate" | "magna" | "summa"
  | "futureAvg" | "ectsLeft" | "degreeProgress" | "avgPerSem" | "reachable" | "needsPerfect"
  | "perSemLabel" | "breakLabel" | "nextLabel" | "liveActivityHint"
  | "materials" | "courseMaterials" | "searchMaterials" | "download" | "downloaded" | "noMaterials"
  | "alarmCourses" | "alarmHint" | "payDorm" | "payWithKaspi" | "studentId" | "monthlyFee" | "openKaspi" | "cancel" | "dormBlock"
  | "daysLeft" | "overdue" | "paid" | "pleasePay"
  | "serviceAttestation" | "serviceJournal" | "servicePlan" | "serviceTranscript" | "serviceOnlineTest" | "serviceDebt" | "serviceFx" | "serviceStudentAnketa"
  | "statusPass" | "statusNotPass" | "statusInProgress" | "statusPlanned" | "statusOpen" | "statusDue" | "statusRetake"
  | "actionStart" | "actionRegister" | "comingSoon" | "univerNote"
  | "fullName" | "birthDate" | "iin" | "citizenship" | "faculty" | "specialty" | "groupName" | "address" | "phone" | "email"
  | "signIn" | "usernameLabel" | "passwordLabel" | "loginHint" | "logout"
  | "rememberMe" | "autoLoginNote" | "reverifyHint" | "themeLight" | "themeDark" | "themeAuto"
  | "loginError";
export type AllTranslationKey = TranslationKey | ExtendedTranslationKey | NewsTranslationKey | ExtraTranslationKey;

interface LanguageContextType {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: AllTranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const TRANSLATIONS: Record<Language, Record<string, string>> = {
  EN: {
    home: "Home", grades: "Grades", schedule: "Schedule", services: "Services", back: "Back", settings: "Settings", about: "About KazNU Helper",
    appearance: "Appearance", preferences: "Preferences", theme: "Theme", chooseTheme: "Choose how KazNU Helper looks", notifications: "Notifications", enabled: "Enabled",
    language: "Language", english: "English", kazakh: "Қазақша", russian: "Русский", version: "Version", university: "University",
    quickAccess: "Quick Access", today: "Today", seeAll: "See All", academicRecord: "Academic Record", semesters: "Semesters", exportPdf: "Export PDF", radarChart: "Radar Chart",
    campusHub: "Campus Hub", refresh: "Refresh", libraryCard: "Library Card", showBarcode: "Tap to show barcode", aboutDescription: "Built to keep your schedule, grades, campus services, and academic plans in one place.", computerScience: "Computer Science", year: "3rd year",
    week: "Week", fall: "Fall", goodMorning: "Good morning", room: "Room", startsIn: "Starts in", endsIn: "Ends in", minutes: "min", lecture: "Lecture", lab: "Lab", exam: "Exam", seminar: "Seminar", calendar: "Calendar", navigate: "Navigate", cumulativeGpa: "CUM. GPA", top: "TOP", thisSemester: "this sem", nextDeadline: "NEXT DEADLINE", hoursLeft: "h left", assignment: "Assignment", dueToday: "Due today", credits: "credits", of: "of", track: "track", whatIf: "What-If GPA Simulator", projectedGpa: "projected GPA", ifAlgorithm: "If Algorithm Analysis", onTrack: "On track for Summa Cum Laude", allServices: "All Services", allSystems: "All systems operational", degradedCache: "Degraded — using cache", offlineCache: "Offline — local cache active", registration: "Registration", hide: "Hide", show: "Show", dormUtilities: "Dorm Utilities", balance: "balance", noIssues: "no issues", uptime: "uptime", topUp: "Top Up Electricity", courseRadar: "Course Radar", liveMonitoring: "Live spot monitoring", watching: "Watching", full: "Full", spots: "spots", present: "Present", noClasses: "No classes scheduled", syncing: "Syncing schedule...", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", library: "Library", dorm: "Dorm", unicard: "Unicard", scholarship: "Scholarship", cafeteria: "Cafeteria", medical: "Medical", electricity: "Electricity", water: "Water", internet: "Internet", on: "On", off: "Off", news: "News", published: "Published", loadingNews: "Loading news...", live: "Live", latestNews: "Latest news", viewAll: "View all", newsNotifications: "News notifications", muted: "Muted", markAllRead: "Mark all as read", newMessages: "new messages",
  },
  KZ: {
    home: "Басты бет", grades: "Бағалар", schedule: "Кесте", services: "Қызметтер", back: "Артқа", settings: "Баптаулар", about: "KazNU Helper туралы",
    appearance: "Көрініс", preferences: "Параметрлер", theme: "Тақырып", chooseTheme: "KazNU Helper көрінісін таңдаңыз", notifications: "Хабарландырулар", enabled: "Қосулы",
    language: "Тіл", english: "English", kazakh: "Қазақша", russian: "Русский", version: "Нұсқа", university: "Университет",
    quickAccess: "Жылдам қолжетімділік", today: "Бүгін", seeAll: "Барлығын көру", academicRecord: "Оқу үлгерімі", semesters: "Семестрлер", exportPdf: "PDF экспорттау", radarChart: "Радар диаграммасы",
    campusHub: "Кампус орталығы", refresh: "Жаңарту", libraryCard: "Кітапхана картасы", showBarcode: "Штрихкодты көру үшін басыңыз", aboutDescription: "Кесте, бағалар және кампус қызметтері бір жерде.", computerScience: "Компьютерлік ғылымдар", year: "3 курс", news: "Жаңалықтар", published: "Жарияланды", loadingNews: "Жаңалықтар жүктелуде...", live: "Тікелей", latestNews: "Соңғы жаңалықтар", viewAll: "Барлығын көру", newsNotifications: "Жаңалық хабарламалары", muted: "Дыбыссыз", markAllRead: "Барлығын оқылды деп белгілеу", newMessages: "жаңа хабарлама",
    week: "Апта", fall: "Күз", goodMorning: "Қайырлы таң", room: "Бөлме", startsIn: "Басталуына", endsIn: "Аяқталуына", minutes: "мин", lecture: "Дәріс", lab: "Зертхана", exam: "Емтихан", seminar: "Семинар", calendar: "Күнтізбе", navigate: "Бағыт", cumulativeGpa: "ЖАЛПЫ GPA", top: "ТОП", thisSemester: "осы семестр", nextDeadline: "КЕЛЕСІ ДЕДЛАЙН", hoursLeft: "сағ қалды", assignment: "Тапсырма", dueToday: "Бүгін тапсыру", credits: "кредит", of: "ішінен", track: "бағыты", whatIf: "GPA болжамы", projectedGpa: "болжамды GPA", ifAlgorithm: "Алгоритмдер талдауы", onTrack: "Summa Cum Laude жолында", allServices: "Барлық қызметтер", allSystems: "Барлық жүйе жұмыс істеп тұр", degradedCache: "Баяу — кэш қолданылуда", offlineCache: "Желі жоқ — жергілікті кэш белсенді", registration: "Тіркелу", hide: "Жасыру", show: "Көрсету", dormUtilities: "Жатақхана қызметтері", balance: "баланс", noIssues: "мәселе жоқ", uptime: "жұмыс уақыты", topUp: "Электр балансын толтыру", courseRadar: "Курс радары", liveMonitoring: "Орындарды бақылау", watching: "Бақылауда", full: "Толық", spots: "орын", present: "Қатысты", noClasses: "Сабақ жоспарланбаған", syncing: "Кесте синхрондалуда...", mon: "Дс", tue: "Сс", wed: "Ср", thu: "Бс", fri: "Жм", sat: "Сб", library: "Кітапхана", dorm: "Жатақхана", unicard: "Unicard", scholarship: "Стипендия", cafeteria: "Асхана", medical: "Медицина", electricity: "Электр", water: "Су", internet: "Интернет", on: "Қосулы", off: "Өшірулі",
  },
  RU: {
    home: "Главная", grades: "Оценки", schedule: "Расписание", services: "Сервисы", back: "Назад", settings: "Настройки", about: "О приложении",
    appearance: "Внешний вид", preferences: "Параметры", theme: "Тема", chooseTheme: "Выберите оформление KazNU Helper", notifications: "Уведомления", enabled: "Включены",
    language: "Язык", english: "English", kazakh: "Қазақша", russian: "Русский", version: "Версия", university: "Университет",
    quickAccess: "Быстрый доступ", today: "Сегодня", seeAll: "Все", academicRecord: "Успеваемость", semesters: "Семестры", exportPdf: "Экспорт PDF", radarChart: "Радарная диаграмма",
    campusHub: "Кампус", refresh: "Обновить", libraryCard: "Библиотечная карта", showBarcode: "Нажмите, чтобы показать штрихкод", aboutDescription: "Расписание, оценки и сервисы кампуса в одном месте.", computerScience: "Компьютерные науки", year: "3 курс", news: "Новости", published: "Опубликовано", loadingNews: "Загрузка новостей...", live: "Онлайн", latestNews: "Последние новости", viewAll: "Все новости", newsNotifications: "Уведомления о новостях", muted: "Без звука", markAllRead: "Отметить все прочитанными", newMessages: "новых сообщений",
    week: "Неделя", fall: "Осень", goodMorning: "Доброе утро", room: "Аудитория", startsIn: "Начало через", endsIn: "До конца", minutes: "мин", lecture: "Лекция", lab: "Лаборатория", exam: "Экзамен", seminar: "Семинар", calendar: "Календарь", navigate: "Маршрут", cumulativeGpa: "ОБЩИЙ GPA", top: "ТОП", thisSemester: "в этом семестре", nextDeadline: "БЛИЖАЙШИЙ ДЕДЛАЙН", hoursLeft: "ч осталось", assignment: "Задание", dueToday: "Сдать сегодня", credits: "кредитов", of: "из", track: "курс", whatIf: "Прогноз GPA", projectedGpa: "прогноз GPA", ifAlgorithm: "Если анализ алгоритмов", onTrack: "Путь к Summa Cum Laude", allServices: "Все сервисы", allSystems: "Все системы работают", degradedCache: "Сбои — используется кэш", offlineCache: "Офлайн — активен локальный кэш", registration: "Регистрация", hide: "Скрыть", show: "Показать", dormUtilities: "Сервисы общежития", balance: "баланс", noIssues: "без проблем", uptime: "доступность", topUp: "Пополнить электричество", courseRadar: "Радар курсов", liveMonitoring: "Мониторинг мест", watching: "Наблюдение", full: "Заполнено", spots: "мест", present: "Присутствовал", noClasses: "Занятий нет", syncing: "Синхронизация расписания...", mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", library: "Библиотека", dorm: "Общежитие", unicard: "Unicard", scholarship: "Стипендия", cafeteria: "Столовая", medical: "Медицина", electricity: "Электричество", water: "Вода", internet: "Интернет", on: "Вкл.", off: "Выкл.",
  },
};

const ADDITIONAL_TRANSLATIONS: Record<Language, Record<ExtraTranslationKey, string>> = {
  EN: {
    noMoreToday: "No more classes today 🎉", degreePlan: "Graduation Plan", targetStandard: "Target",
    justGraduate: "Just Graduate", magna: "Magna Cum Laude", summa: "Summa Cum Laude",
    futureAvg: "avg GPA needed in remaining semesters", ectsLeft: "ECTS left", degreeProgress: "Degree progress",
    avgPerSem: "avg / sem.", reachable: "On track — keep the pace!", needsPerfect: "Needs near-perfect grades",
    perSemLabel: "per sem.", breakLabel: "Break", nextLabel: "Next", liveActivityHint: "Lock screen live activity",
    materials: "Materials", courseMaterials: "Course Materials", searchMaterials: "Search by course or file name", download: "Download", downloaded: "Saved", noMaterials: "No materials yet",
    alarmCourses: "All courses", alarmHint: "Bell on — I remind you 30 min before class", payDorm: "Pay dorm fee", payWithKaspi: "Pay via Kaspi", studentId: "Student ID", monthlyFee: "Monthly fee", openKaspi: "Open Kaspi", cancel: "Cancel", dormBlock: "Dorm",
    daysLeft: "days left", overdue: "Overdue", paid: "Fee paid", pleasePay: "Please pay the dorm fee",
    serviceAttestation: "Attestation", serviceJournal: "Attendance & progress journal", servicePlan: "Individual study plan", serviceTranscript: "Transcript (grade book)", serviceOnlineTest: "Online test", serviceDebt: "Academic debt", serviceFx: "FX retake",
    statusPass: "Passed", statusNotPass: "Not passed", statusInProgress: "In progress", statusPlanned: "Planned", statusOpen: "Open", statusDue: "Due", statusRetake: "Retake",
    actionStart: "Start test", actionRegister: "Register", comingSoon: "Coming soon", univerNote: "Live data will load from Univer.kz",
    serviceStudentAnketa: "Student questionnaire", fullName: "Full name", birthDate: "Date of birth", iin: "IIN", citizenship: "Citizenship", faculty: "Faculty", specialty: "Specialty", groupName: "Group", address: "Address", phone: "Phone", email: "Email",
    signIn: "Sign in", usernameLabel: "Username / student ID", passwordLabel: "Password", loginHint: "Demo: any username · password 123456", logout: "Log out",
    rememberMe: "Remember me & auto sign-in", autoLoginNote: "No password needed for the next 15 days", reverifyHint: "If off, you'll enter your password again next time", themeLight: "Light", themeDark: "Dark", themeAuto: "Auto", loginError: "Incorrect password — try again",
  },
  KZ: {
    noMoreToday: "Бүгінгі сабақтар аяқталды 🎉", degreePlan: "Бітіру жоспары", targetStandard: "Мақсат",
    justGraduate: "Дипломға жету", magna: "Magna Cum Laude", summa: "Summa Cum Laude",
    futureAvg: "қалған семестрлерде қажет GPA", ectsLeft: "ECTS қалды", degreeProgress: "Диплом барысы",
    avgPerSem: "сем./орташа", reachable: "Жолындасыз — солай жалғастырыңыз!", needsPerfect: "Өте жоғары баға қажет",
    perSemLabel: "сем./", breakLabel: "Үзіліс", nextLabel: "Келесі", liveActivityHint: "Құлыптау экранындағы белсенділік",
    materials: "Материалдар", courseMaterials: "Оқу материалдары", searchMaterials: "Курс немесе файл атымен іздеу", download: "Жүктеу", downloaded: "Сақталды", noMaterials: "Әзірге материал жоқ",
    alarmCourses: "Барлық пәндер", alarmHint: "Қоңырау — сабаққа 30 мин қалғанда еске саламын", payDorm: "Жатақхана ақысын төлеу", payWithKaspi: "Kaspi арқылы төлеу", studentId: "Студент ID", monthlyFee: "Айлық төлем", openKaspi: "Kaspi ашу", cancel: "Болдырмау", dormBlock: "Жатақхана",
    daysLeft: "күн қалды", overdue: "Мерзімі өтті", paid: "Төленді", pleasePay: "Жатақхана ақысын төлеңіз",
    serviceAttestation: "Аттестация", serviceJournal: "Қатысу және үлгерім журналы", servicePlan: "Жеке оқу жоспары", serviceTranscript: "Транскрипт (Сынақ кітапшасы)", serviceOnlineTest: "Онлайн тест", serviceDebt: "Оқу қарызы", serviceFx: "FX қайта тапсыру",
    statusPass: "Өтілді", statusNotPass: "Өтілмеді", statusInProgress: "Жүріп жатыр", statusPlanned: "Жоспарланған", statusOpen: "Ашық", statusDue: "Мерзімі өтті", statusRetake: "Қайта тапсыру",
    actionStart: "Тестті бастау", actionRegister: "Тіркелу", comingSoon: "Жақында", univerNote: "Тірі деректер Univer.kz-тен жүктеледі",
    serviceStudentAnketa: "Студент анкетасы", fullName: "Толық аты-жөні", birthDate: "Туған күні", iin: "ЖСН", citizenship: "Азаматтығы", faculty: "Факультет", specialty: "Мамандық", groupName: "Топ", address: "Мекенжайы", phone: "Телефон", email: "Email",
    signIn: "Кіру", usernameLabel: "Логин / студент ID", passwordLabel: "Құпиясөз", loginHint: "Демо: кез келген логин · құпиясөз 123456", logout: "Шығу",
    rememberMe: "Есте сақтау және автоматты кіру", autoLoginNote: "Келесі 15 күнде құпиясөз қажет емес", reverifyHint: "Өшірсеңіз, келесі жолы құпиясөзді қайта енгізесіз", themeLight: "Ашық", themeDark: "Қараңғы", themeAuto: "Авто", loginError: "Құпиясөз қате — қайта көріңіз",
  },
  RU: {
    noMoreToday: "На сегодня занятий больше нет 🎉", degreePlan: "План до диплома", targetStandard: "Цель",
    justGraduate: "Просто диплом", magna: "Magna Cum Laude", summa: "Summa Cum Laude",
    futureAvg: "нужный GPA в оставшихся семестрах", ectsLeft: "ECTS осталось", degreeProgress: "Прогресс диплома",
    avgPerSem: "средн./сем.", reachable: "Всё по плану — продолжайте!", needsPerfect: "Нужны почти отличные оценки",
    perSemLabel: "сем./", breakLabel: "Перемена", nextLabel: "Далее", liveActivityHint: "Активность на экране блокировки",
    materials: "Материалы", courseMaterials: "Учебные материалы", searchMaterials: "Поиск по курсу или файлу", download: "Скачать", downloaded: "Сохранено", noMaterials: "Материалов пока нет",
    alarmCourses: "Все предметы", alarmHint: "Колокольчик — напомню за 30 мин до пары", payDorm: "Оплатить общежитие", payWithKaspi: "Оплатить через Kaspi", studentId: "ID студента", monthlyFee: "Ежемесячная плата", openKaspi: "Открыть Kaspi", cancel: "Отмена", dormBlock: "Общежитие",
    daysLeft: "дней осталось", overdue: "Просрочено", paid: "Оплачено", pleasePay: "Оплатите общежитие",
    serviceAttestation: "Аттестация", serviceJournal: "Журнал посещаемости и успеваемости", servicePlan: "Индивидуальный учебный план", serviceTranscript: "Транскрипт (зачётка)", serviceOnlineTest: "Онлайн-тест", serviceDebt: "Академическая задолженность", serviceFx: "Пересдача FX",
    statusPass: "Зачтено", statusNotPass: "Не зачтено", statusInProgress: "В процессе", statusPlanned: "Запланировано", statusOpen: "Открыт", statusDue: "Просрочено", statusRetake: "Пересдача",
    actionStart: "Начать тест", actionRegister: "Записаться", comingSoon: "Скоро", univerNote: "Данные загрузятся с Univer.kz",
    serviceStudentAnketa: "Анкета студента", fullName: "ФИО", birthDate: "Дата рождения", iin: "ИИН", citizenship: "Гражданство", faculty: "Факультет", specialty: "Специальность", groupName: "Группа", address: "Адрес", phone: "Телефон", email: "Email",
    signIn: "Войти", usernameLabel: "Логин / ID студента", passwordLabel: "Пароль", loginHint: "Демо: любой логин · пароль 123456", logout: "Выйти",
    rememberMe: "Запомнить меня и входить автоматически", autoLoginNote: "Без пароля в течение следующих 15 дней", reverifyHint: "Если выключено, пароль придётся ввести снова в следующий раз", themeLight: "Светлая", themeDark: "Тёмная", themeAuto: "Авто", loginError: "Неверный пароль — попробуйте ещё раз",
  },
};

function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "EN";
  const savedLanguage = window.localStorage.getItem("language");
  return savedLanguage === "EN" || savedLanguage === "KZ" || savedLanguage === "RU" ? savedLanguage : "EN";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  function setLanguage(nextLanguage: Language) {
    // 任何入口切语言（登录页/设置页）都会先盖一层当前底色，再淡出揭开新文案
    screenFade();
    setLanguageState(nextLanguage);
    window.localStorage.setItem("language", nextLanguage);
  }

  const t = (key: TranslationKey | ExtendedTranslationKey | NewsTranslationKey | ExtraTranslationKey) =>
    ADDITIONAL_TRANSLATIONS[language][key as ExtraTranslationKey] ?? TRANSLATIONS[language][key];
  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const { t } = useLanguage();
  return t;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within a LanguageProvider");
  return context;
}
