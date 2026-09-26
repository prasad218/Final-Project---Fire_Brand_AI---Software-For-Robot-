// ============================================================================
// ARYA WEB — PEOPLE DIRECTORY (Principal + HODs), hardcoded on the frontend.
//
// Why this exists as a SEPARATE, frontend-only copy of the same data the
// backend's campus_locations.py "People" sheet already has: the backend
// runs locally and is only reachable through a Tailscale tunnel, so every
// change there needs someone to `git pull` and manually restart the
// Python process on that machine. This file needs none of that -- it's
// plain data + a plain function, so a name change is just:
//   1. edit PEOPLE below
//   2. git commit + git push
// and Netlify auto-deploys it, same as any other frontend change.
//
// Trade-off, so it's obvious when NOT to use this: this only covers
// "who is the principal / HOD of X" -- it has no Gemini fallback, no
// room-location data, and won't know about anyone not listed here. The
// backend's version (campus_locations.py + the People sheet in
// Campus_Locations.xlsx) is still the richer, authoritative source and
// also grounds Gemini for phrasing this simple matcher misses. Keep the
// two in sync by hand if you update one -- there's no code sharing
// between a Python backend module and this frontend file.
// ============================================================================

export interface Person {
  role: "Principal" | "HOD";
  department?: string; // omitted for the Principal (no department to resolve)
  name: string;
  designation?: string;
  experience?: string;
  tenure?: string;
  qualification?: string;
  interest?: string;
  specialization?: string;
}

export const PEOPLE: Person[] = [
  {
    role: "Principal",
    name: "Dr. Mahesh Prasanna K.",
    designation: "Principal, Professor",
    experience: "20 years",
    tenure: "11 years",
    qualification: "B.E., M.Tech, Ph.D.",
    interest: "Artificial Intelligence",
    specialization: "Image Processing",
  },
  { role: "HOD", department: "Artificial Intelligence & Machine Learning (AIML)", name: "Dr. Radhika Shetty D. S." },
  { role: "HOD", department: "Civil Engineering", name: "Prof. Prashantha" },
  { role: "HOD", department: "Computer Science & Engineering (CSE)", name: "Mr. Pradeep Kumar K. G." },
  { role: "HOD", department: "Mechanical Engineering", name: "Dr. Deepak" },
  { role: "HOD", department: "CSE (Data Science)", name: "Prof. Roopa G. K." },
  { role: "HOD", department: "Electronics & Communication Engineering (ECE)", name: "Dr. Shrikanth Rao" },
];

// Department name -> alias words a spoken/typed question might use for
// it, so "HOD of AI and ML" / "HOD of AIML" / "artificial intelligence
// HOD" all resolve without needing every exact phrasing hand-typed.
const DEPARTMENT_ALIASES: Record<string, string[]> = {
  "Artificial Intelligence & Machine Learning (AIML)": ["aiml", "ai", "ml", "artificial", "intelligence", "machine", "learning"],
  "Civil Engineering": ["civil"],
  "Computer Science & Engineering (CSE)": ["cse", "computer", "science", "engineering"],
  "Mechanical Engineering": ["mechanical", "mech"],
  "CSE (Data Science)": ["data", "science", "ds"],
  "Electronics & Communication Engineering (ECE)": ["ece", "electronics", "communication", "e&c", "ec"],
};

/** text + '.', without ever producing a doubled '..' when text (an
 * abbreviation like 'Ph.D.', or a name ending in an initial like 'K.')
 * already ends with a period. */
function sentence(text: string): string {
  return text.replace(/\.+$/, "") + ".";
}

function describePerson(p: Person): string {
  const who = p.department ? `${p.role} of ${p.department}` : p.role;
  let text = sentence(`The ${who} is ${p.name}`);
  const details = [p.designation, p.experience && `${p.experience} of teaching experience`, p.tenure && `${p.tenure} with VCET`, p.qualification].filter(
    (v): v is string => Boolean(v),
  );
  if (details.length) text += " " + sentence(details.join(", "));
  if (p.interest) text += " " + sentence(`Area of interest: ${p.interest}`);
  if (p.specialization) text += " " + sentence(`Area of specialization: ${p.specialization}`);
  return text;
}

/**
 * Instant, local match for "who is the principal", "who is the HOD of
 * CSE", "principal's qualification", etc. Returns null if it doesn't
 * confidently match -- callers should fall through to the backend chat
 * call in that case, same "don't guess" contract as the backend's own
 * find_people_answer() in campus_locations.py.
 *
 * Deliberately narrow about WHEN it claims a query: requires an
 * explicit "who"/personal-detail signal, and backs off if the query
 * also reads like a room/location question ("where is the principal's
 * office") -- that should still go to the backend/Gemini, not get
 * shadowed by this hardcoded matcher.
 */
export function findPeopleAnswer(rawText: string): string | null {
  const text = rawText.toLowerCase();
  if (!text) return null;

  const soundsPersonal = /\bwho\b|qualification|experience|tenure|specialization|specialisation|designation/.test(text);
  const soundsLocational = /\bwhere\b|\broom\b|\bcabin\b|\boffice\b|\bfloor\b|\bblock\b/.test(text);
  if (!soundsPersonal || soundsLocational) return null;

  if (text.includes("principal")) {
    const principal = PEOPLE.find((p) => p.role === "Principal");
    if (principal) return describePerson(principal);
  }

  if (/\bhod\b/.test(text) || text.includes("head of department") || text.includes("head of the department")) {
    const queryWords = new Set(text.match(/[a-z0-9]+/g) ?? []);
    let bestDept: string | null = null;
    let bestScore = 0;
    for (const [dept, aliases] of Object.entries(DEPARTMENT_ALIASES)) {
      const score = aliases.filter((a) => queryWords.has(a)).length;
      if (score > bestScore) {
        bestDept = dept;
        bestScore = score;
      }
    }
    if (bestDept) {
      const hod = PEOPLE.find((p) => p.role === "HOD" && p.department === bestDept);
      if (hod) return describePerson(hod);
    }
  }

  return null;
}