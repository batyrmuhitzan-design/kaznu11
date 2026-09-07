/**
 * Prof Reviews — module-local strings (EN / KZ / RU).
 *
 * Kept next to the feature instead of editing the giant LanguageContext
 * dictionaries, but uses the same LanguageProvider so it reacts live to the
 * global language switch.
 */
import { useLanguage, type Language } from "../contexts/LanguageContext";

export type RmpTextKey =
  | "title" | "blurb" | "anonymousTag" | "professors" | "courses"
  | "searchProfessors" | "searchCourses" | "quality" | "easiness" | "reviewsWord"
  | "writeReview" | "ratedNote" | "noRatingsYet" | "noResults" | "noResultsHint"
  | "attendance" | "attOptional" | "attRecommended" | "attMandatory"
  | "comment" | "commentPlaceholder" | "tags" | "submit" | "submitting"
  | "communityProfile" | "displayName" | "deptTag" | "save" | "savedOk"
  | "nameDefaultNote" | "hiddenNameNote" | "cancel" | "demoData" | "live"
  | "viewProfessorRating" | "likes" | "fromYourSchedule" | "rateThisProfessor"
  | "teachesCourses" | "relToday" | "xDaysAgo" | "howTitle" | "howBody"
  | "reviewsCount" | "of" | "quickAccessLabel" | "serviceCardTitle" | "serviceCardSub"
  | "startReview" | "commentCharLimit";

export const RMP: Record<Language, Record<RmpTextKey, string>> = {
  EN: {
    title: "Prof Reviews",
    blurb: "Choose professors and courses by honest anonymous ratings.",
    anonymousTag: "100% anonymous · only your department is shown",
    professors: "Professors",
    courses: "Courses",
    searchProfessors: "Search professor…",
    searchCourses: "Search course or code…",
    quality: "Quality",
    easiness: "Easiness",
    reviewsWord: "reviews",
    writeReview: "Write a review",
    ratedNote: "You already rated this professor",
    noRatingsYet: "No reviews yet — be the first!",
    noResults: "Nothing found",
    noResultsHint: "Try a different name, department or course code.",
    attendance: "Attendance",
    attOptional: "Not mandatory",
    attRecommended: "Recommended",
    attMandatory: "Strict / Mandatory",
    comment: "Comment",
    commentPlaceholder: "How were the lectures, exams, and the professor?",
    tags: "Tags",
    submit: "Submit anonymously",
    submitting: "Submitting…",
    communityProfile: "Community profile",
    displayName: "Display name",
    deptTag: "Department tag",
    save: "Save",
    savedOk: "Saved",
    nameDefaultNote: "On first login we generate a random name (e.g. user1234567). You can change it here — it is never shown on reviews.",
    hiddenNameNote: "Your display name is only for future community features. Reviews stay anonymous.",
    cancel: "Cancel",
    demoData: "Demo data",
    live: "Live",
    viewProfessorRating: "View Professor Rating",
    likes: "helpful",
    fromYourSchedule: "From your schedule",
    rateThisProfessor: "Rate this professor",
    teachesCourses: "Courses",
    relToday: "Today",
    xDaysAgo: "{d}d ago",
    howTitle: "How anonymity works",
    howBody: "Ratings show only a department label (e.g. “Data Science Student”). Never your display name, login or e-mail. One rating per professor per account.",
    reviewsCount: "{count} ratings",
    of: "of",
    quickAccessLabel: "Prof Reviews",
    serviceCardTitle: "Course & Professor Ratings",
    serviceCardSub: "Rate your professors anonymously — insights from real students.",
    startReview: "Start a review",
    commentCharLimit: "1,200 characters max",
  },
  KZ: {
    title: "Оқытушы бағалары",
    blurb: "Анонимді пікірлер арқылы оқытушылар мен курстарды таңдаңыз.",
    anonymousTag: "100% анонимді · тек факультетіңіз көрсетіледі",
    professors: "Оқытушылар",
    courses: "Курстар",
    searchProfessors: "Оқытушыны іздеу…",
    searchCourses: "Курсты немесе кодты іздеу…",
    quality: "Сапа",
    easiness: "Жеңілдік",
    reviewsWord: "пікір",
    writeReview: "Пікір жазу",
    ratedNote: "Сіз бұл оқытушыны бағаладыңыз",
    noRatingsYet: "Әзірге пікір жоқ — бірінші болыңыз!",
    noResults: "Ештеңе табылмады",
    noResultsHint: "Атын, факультетін немесе курс кодын басқаша іздеп көріңіз.",
    attendance: "Қатысу",
    attOptional: "Міндетті емес",
    attRecommended: "Ұсынылады",
    attMandatory: "Қатаң / міндетті",
    comment: "Пікір",
    commentPlaceholder: "Дәрістер, емтихан және оқытушы туралы не ойлайсыз?",
    tags: "Тегтер",
    submit: "Анонимді жіберу",
    submitting: "Жіберілуде…",
    communityProfile: "Қоғамдық профиль",
    displayName: "Жаһандық атау",
    deptTag: "Факультет белгісі",
    save: "Сақтау",
    savedOk: "Сақталды",
    nameDefaultNote: "Алғашқы кіруде кездейсоқ атау беріледі (мысалы, user1234567). Мұнда өзгерте аласыз — ол пікірлерде ешқашан көрсетілмейді.",
    hiddenNameNote: "Атау тек болашақ қауымдастық функцияларына арналған. Пікірлер анонимді қалады.",
    cancel: "Болдырмау",
    demoData: "Демо-дерек",
    live: "Live",
    viewProfessorRating: "Оқытушы рейтингін қарау",
    likes: "пайдалы",
    fromYourSchedule: "Кестеңіздегі сабақ",
    rateThisProfessor: "Осы оқытушыны бағалау",
    teachesCourses: "Курстары",
    relToday: "Бүгін",
    xDaysAgo: "{d} күн бұрын",
    howTitle: "Анонимділік қалай жұмыс істейді",
    howBody: "Бағаларда тек факультет белгісі көрсетіледі (мысалы, «Data Science Student»). Атыңыз, логиніңіз немесе поштаңыз ешқашан көрсетілмейді. Әр оқытушыға бір аккаунттан бір баға.",
    reviewsCount: "{count} баға",
    of: "ішінен",
    quickAccessLabel: "Оқытушы бағасы",
    serviceCardTitle: "Курс және оқытушы рейтингі",
    serviceCardSub: "Оқытушыларды анонимді бағалаңыз — нақты студенттердің пікірі.",
    startReview: "Пікір жазу",
    commentCharLimit: "Ең көбі 1 200 таңба",
  },

  RU: {
    title: "Рейтинги преподавателей",
    blurb: "Выбирайте преподавателей и курсы по честным анонимным отзывам.",
    anonymousTag: "100% анонимно · виден только ваш факультет",
    professors: "Преподаватели",
    courses: "Курсы",
    searchProfessors: "Поиск преподавателя…",
    searchCourses: "Поиск курса или кода…",
    quality: "Качество",
    easiness: "Лёгкость",
    reviewsWord: "отзыв",
    writeReview: "Написать отзыв",
    ratedNote: "Вы уже оценили этого преподавателя",
    noRatingsYet: "Отзывов пока нет — станьте первым!",
    noResults: "Ничего не найдено",
    noResultsHint: "Попробуйте другое имя, факультет или код курса.",
    attendance: "Посещаемость",
    attOptional: "Необязательна",
    attRecommended: "Желательна",
    attMandatory: "Строгая / обязательная",
    comment: "Комментарий",
    commentPlaceholder: "Как проходили лекции, экзамены и как вёл преподаватель?",
    tags: "Теги",
    submit: "Отправить анонимно",
    submitting: "Отправка…",
    communityProfile: "Общий профиль",
    displayName: "Отображаемое имя",
    deptTag: "Метка факультета",
    save: "Сохранить",
    savedOk: "Сохранено",
    nameDefaultNote: "При первом входе мы выдаём случайное имя (например, user1234567). Его можно изменить — в отзывах оно никогда не показывается.",
    hiddenNameNote: "Имя нужно только для будущих функций сообщества. Отзывы остаются анонимными.",
    cancel: "Отмена",
    demoData: "Демо-данные",
    live: "Live",
    viewProfessorRating: "Рейтинг преподавателя",
    likes: "полезно",
    fromYourSchedule: "Занятие из расписания",
    rateThisProfessor: "Оценить этого преподавателя",
    teachesCourses: "Курсы",
    relToday: "Сегодня",
    xDaysAgo: "{d} дн. назад",
    howTitle: "Как работает анонимность",
    howBody: "В отзывах видна только метка факультета (например, «Data Science Student»). Ваше имя, логин и почта никогда не показываются. Один отзыв на преподавателя с одного аккаунта.",
    reviewsCount: "{count} оценок",
    of: "из",
    quickAccessLabel: "Отзывы о преп.",
    serviceCardTitle: "Рейтинги курсов и преподавателей",
    serviceCardSub: "Анонимно оценивайте преподавателей — мнения реальных студентов.",
    startReview: "Написать отзыв",
    commentCharLimit: "Максимум 1 200 символов",
  },

};

/** Live strings for the active UI language (re-renders when the user switches language). */
export function useRmpStrings(): Record<RmpTextKey, string> {
  const { language } = useLanguage();
  return RMP[language];
}

/** Format helpers reused by list/detail/feed UI. */
export function rmpAgeLabel(s: Record<RmpTextKey, string>, days: number): string {
  if (days <= 0) return s.relToday;
  return s.xDaysAgo.replace("{d}", String(days));
}

export function rmpCountLabel(s: Record<RmpTextKey, string>, count: number): string {
  return s.reviewsCount.replace("{count}", String(count));
}

