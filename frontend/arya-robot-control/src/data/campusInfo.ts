// ============================================================================
// ARYA WEB — CAMPUS ADDRESS, hardcoded on the frontend.
//
// Same reasoning as src/data/people.ts: "where is VCET" is asking about
// the college itself (its street address), not about a room/facility
// INSIDE VCET -- the backend's Campus_Locations.xlsx only has rows for
// facilities within the campus (library, HOD cabins, labs, ...), so it
// has never had an answer for "where is VCET" itself. Rather than add a
// synthetic row there (and depend on the backend/tunnel being up),
// this is answered instantly on the frontend, exactly like the
// Principal/HOD lookup.
// ============================================================================

const CAMPUS_ADDRESS =
  "Vivekananda College of Engineering and Technology (VCET) is located in " +
  "Nehru Nagar, Puttur, Dakshina Kannada district, Karnataka (PIN 574203). " +
  "The 25-acre campus sits right along the Mangalore-Madikeri highway.";

/**
 * Instant, local match for "where is VCET", "VCET address", "what is
 * VCET's location", etc. Returns null if it doesn't confidently match
 * -- callers should fall through to the backend in that case (e.g. for
 * "where is the library", which IS a facility inside VCET and belongs
 * to the backend's room directory, not here).
 *
 * Deliberately narrow: requires a word for VCET/the college itself
 * AND a location-style question word, and backs off if the query also
 * names a specific facility/department -- those should still go to the
 * backend's room directory, not get shadowed by this campus-level
 * answer.
 */
export function findCampusAddressAnswer(rawText: string): string | null {
  const text = rawText.toLowerCase();
  if (!text) return null;

  const mentionsCollege = /\bvcet\b|\bvivekananda\b|\bthe college\b|\bour college\b|\bthis college\b|\bcampus\b/.test(text);
  if (!mentionsCollege) return null;

  const asksLocation = /\bwhere\b|\baddress\b|\blocation\b|\blocated\b|\bsituated\b|\bpin\s*code\b|\bpincode\b/.test(text);
  if (!asksLocation) return null;

  // If a specific facility/department is also named, this is a
  // "where is X inside VCET" question -- let the backend's room
  // directory answer that instead.
  const namesFacility =
    /\blibrary\b|\bblock\b|\bfloor\b|\bcabin\b|\boffice\b|\blab\b|\bcanteen\b|\bhostel\b|\bparking\b|\bhod\b|\bprincipal\b|\bdepartment\b|\bauditorium\b|\bground\b|\bplayground\b/.test(
      text,
    );
  if (namesFacility) return null;

  return CAMPUS_ADDRESS;
}
