/**
 * Prof Reviews — offline demo catalog (mirrors backend/app/seed.py).
 *
 * The schedule demo professors (Akhmetov / Bekova / Seitkali / Serikova /
 * Omarova / Semagulova / Suleimenov / Bateer) all exist here so the
 * "View Professor Rating" deep links resolve on-device without a backend.
 */
export interface RmpCourse {
  id: string;
  code: string;
  title: string;
  department: string;
  credits: number;
}

export interface RmpProfessor {
  id: string;
  name: string;
  department: string;
  color: string;
}

export interface RmpReview {
  id: string;
  professorId: string;
  courseCode: string | null;
  courseTitle: string | null;
  easy: number;
  quality: number;
  attendance: "not_mandatory" | "recommended" | "mandatory";
  comment: string | null;
  tags: string[];
  likes: number;
  dept: string;
  /** Server mode: createdAt ISO string; demo mode: relative age in days. */
  daysAgo?: number;
  createdAt?: string;
}

const P = [
  ["p1", "Nurzhan Akhmetov", "Mathematics", "#5E5CE6"],
  ["p2", "Assel Bekova", "Mathematics", "#007AFF"],
  ["p3", "Bauyrzhan Seitkali", "Computer Science", "#FF9F0A"],
  ["p4", "Gulnur Serikova", "Physics", "#30D158"],
  ["p5", "Dinara Omarova", "Foreign Languages", "#FF453A"],
  ["p6", "Aigerim Semagulova", "Computer Science", "#7B79F7"],
  ["p7", "Bekarys Suleimenov", "Computer Science", "#FF9F0A"],
  ["p8", "Alibek Bateer", "Computer Science", "#00C7BE"],
] as const;

// [code, title, department, credits]
const C = [
  ["MATH101", "Linear Algebra", "Mathematics", 5],
  ["MATH102", "Higher Mathematics II", "Mathematics", 5],
  ["CS201", "Data Structures & Algorithms", "Computer Science", 5],
  ["CS210", "Database Systems", "Computer Science", 4],
  ["CS350", "Machine Learning", "Computer Science", 5],
  ["PHYS101", "Physics II", "Physics", 5],
  ["LANG101", "English C1", "Foreign Languages", 3],
  ["WEB201", "Web Development", "Computer Science", 4],
] as const;

// [professorId, courseCode, easy, quality, attendance, comment, tags, dept, likes, daysAgo]
const R: Array<
  [string, string, number, number, "not_mandatory" | "recommended" | "mandatory", string, string[], string, number, number]
> = [
  ["p1", "MATH101", 4, 5, "mandatory", "Clear theorems, tough but fair exams. His proofs are a pleasure to follow.", ["Clear grading", "Inspirational"], "Applied Math Student", 3, 9],
  ["p1", "MATH101", 3, 4, "recommended", "Fast pace. Bring a notebook — he explains on the board and never re-uploads slides.", ["Tough grader"], "Math Student", 1, 30],
  ["p1", "MATH101", 5, 5, "recommended", "The best lecturer in the math block. Go to class, skip the textbook.", ["Inspirational"], "Data Science Student", 2, 45],
  ["p1", "MATH102", 3, 4, "recommended", "Solid follow-up to Linear Algebra. Office hours really help.", ["Clear grading"], "Physics Student", 0, 12],
  ["p2", "MATH102", 5, 5, "not_mandatory", "Kind, patient, and explains integrals like stories. Attestations are fair.", ["Caring", "Inspirational"], "Computer Science Student", 4, 5],
  ["p2", "MATH102", 4, 4, "recommended", "Attendance not forced but her practice sets are gold for the exam.", ["Clear grading"], "Applied Math Student", 1, 21],
  ["p3", "CS201", 5, 5, "recommended", "Incredible Data Structures lecturer. Every concept is visualized on the projector.", ["Inspirational", "Clear grading"], "Computer Science Student", 5, 2],
  ["p3", "CS201", 4, 5, "mandatory", "Tough labs but you actually learn how to code. Be ready for pop quizzes.", ["Tough grader"], "Data Science Student", 2, 14],
  ["p3", "CS201", 3, 4, "recommended", "Excellent content, grading a bit harsh on the final project.", ["Tough grader"], "Software Engineering Student", 0, 40],
  ["p4", "PHYS101", 4, 4, "mandatory", "Lab reports are strict — follow the template exactly. Lecture itself is engaging.", ["Tough grader"], "Physics Student", 2, 7],
  ["p4", "PHYS101", 3, 5, "recommended", "Physics II is hard but she explains everything twice if asked.", ["Caring"], "Engineering Student", 1, 18],
  ["p5", "LANG101", 5, 4, "mandatory", "English C1 done right — speaking every class, essays every week, real progress.", ["Caring", "Clear grading"], "International Relations Student", 3, 6],
  ["p5", "LANG101", 4, 5, "recommended", "Amazing energy. Small group means you can't hide, which is good.", ["Inspirational"], "Computer Science Student", 1, 25],
  ["p6", "CS350", 5, 5, "not_mandatory", "Machine Learning from scratch in NumPy — you finish the course actually understanding it.", ["Inspirational", "Caring"], "Data Science Student", 6, 1],
  ["p6", "CS350", 4, 5, "recommended", "Great theory depth; homework takes time but is worth it.", ["Clear grading"], "Computer Science Student", 2, 11],
  ["p7", "CS210", 3, 4, "mandatory", "Database Systems covers real SQL + indexing. Attendance via QR code every class.", ["Tough grader"], "Computer Science Student", 1, 16],
  ["p7", "CS210", 4, 4, "recommended", "Solid course. The final design project teaches you more than the lectures.", ["Clear grading"], "Data Science Student", 2, 22],
  ["p8", "WEB201", 4, 5, "recommended", "Web Development bootcamp style — two full-stack projects by the end.", ["Inspirational"], "Computer Science Student", 3, 4],
  ["p8", "WEB201", 5, 4, "not_mandatory", "Super practical, current stack. He answers Telegram questions at night too.", ["Caring"], "Software Engineering Student", 1, 19],
];


const courseByCode = new Map<string, RmpCourse>();
C.forEach(([code, title, department, credits]) => {
  courseByCode.set(code, { id: code, code, title, department, credits });
});

export const PROFESSORS: RmpProfessor[] = P.map(([id, name, department, color]) => ({
  id,
  name,
  department,
  color,
}));

export const COURSES: RmpCourse[] = [...courseByCode.values()];

export const REVIEWS: RmpReview[] = R.map(
  ([professorId, courseCode, easy, quality, attendance, comment, tags, dept, likes, daysAgo], i) => ({
    id: `r${i + 1}`,
    professorId,
    courseCode,
    courseTitle: courseByCode.get(courseCode)?.title ?? null,
    easy,
    quality,
    attendance,
    comment,
    tags,
    likes,
    dept,
    daysAgo,
  }),
);

export function professorById(id: string): RmpProfessor | undefined {
  return PROFESSORS.find((p) => p.id === id);
}

export function courseByCodeOf(code: string | null): RmpCourse | null {
  if (!code) return null;
  return courseByCode.get(code) ?? null;
}

export function reviewsForProfessor(professorId: string): RmpReview[] {
  return REVIEWS.filter((r) => r.professorId === professorId).sort((a, b) => (a.daysAgo ?? 0) - (b.daysAgo ?? 0));
}

export function reviewsForCourse(code: string): RmpReview[] {
  return REVIEWS.filter((r) => r.courseCode === code);
}

/** "Akhmetov N.T." / "Dr. Akhmetov" → "Nurzhan Akhmetov" by surname. */
export function matchProfessor(query: string): RmpProfessor | null {
  const q = query.trim();
  if (!q) return null;
  const direct = PROFESSORS.find((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  if (direct) return direct;
  const surnameToken = q.split(" ").map((w) => w.replace(/\./g, "")).find((w) => /^[A-Za-zА-Яа-яЁё]+$/.test(w))?.toLowerCase();
  if (surnameToken) {
    const hit = PROFESSORS.find((p) =>
      p.name.toLowerCase().split(" ").some((part) => part.startsWith(surnameToken) && part.length > 1),
    );
    if (hit) return hit;
  }
  return null;
}

