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

// ----------------------------------------------------------------------
// Library -- hardcoded as a frontend-only answer by request, so it never
// needs the backend/tunnel running at all.
//
// IMPORTANT TRADE-OFF (spelled out, since this differs from the VCET
// address above): this ALWAYS wins over the backend's own
// Campus_Locations.xlsx answer for "where is the library", even when
// the backend IS running and reachable -- TalkWithArya.tsx checks this
// before ever calling the backend, unconditionally. The VCET address
// is safe to hardcode because it basically never changes; room/floor
// data is not -- if the Excel sheet's library rows are ever edited
// (room moved, a library added/removed), THIS file also needs to be
// updated by hand, or this will keep giving a stale answer forever
// with no way for the backend to override it. Source data as of this
// writing (backend/AURA_Windows/data/Campus_Locations.xlsx, "Library"
// rows): E001 (1st Floor, Krishna Chethana Block), E006 (1st Floor,
// Krishna Chethana Block, noted "Another library"), A304 (MCA/MBA
// Floor, Sudarshana Building).
// ----------------------------------------------------------------------

const LIBRARY_ANSWER =
  "There are 3 libraries on campus: Room E001 (1st Floor, Krishna Chethana Block), " +
  "Room E006 (1st Floor, Krishna Chethana Block), and Room A304 (MCA/MBA Floor, Sudarshana Building).";

/**
 * Instant, local match for "where is the library", "library location",
 * "which floor is the library on", etc. Returns null if it doesn't
 * confidently match -- same "don't guess" contract as every other
 * matcher in this file.
 */
export function findLibraryAnswer(rawText: string): string | null {
  const text = rawText.toLowerCase();
  if (!text) return null;

  if (!/\blibrar(y|ies)\b/.test(text)) return null;

  const asksLocation = /\bwhere\b|\blocation\b|\blocated\b|\bsituated\b|\bfloor\b|\broom\b|\bblock\b|\bbuilding\b/.test(text);
  if (!asksLocation) return null;

  return LIBRARY_ANSWER;
}
