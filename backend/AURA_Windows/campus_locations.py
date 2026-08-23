"""
================================================================================
 AURA WEB — CAMPUS LOCATIONS (from the Campus_Locations.xlsx directory)
 Loads backend/AURA_Windows/data/Campus_Locations.xlsx once at import
 time and turns it into two things chat_service.py uses:

   1. find_location_answer(text) -- an INSTANT (no AI call) lookup, the
      same idea as Config.LOCATION_QA in vivek_common.py, just built
      from every row of the spreadsheet instead of hand-typed phrase
      lists. Tried by chat_service.match_location_qa() only AFTER the
      existing hand-authored Config.LOCATION_QA entries -- so nothing
      already working changes; this only adds coverage for facilities/
      rooms that weren't in that hand-typed list (e.g. "where is the
      library", "where is the placement office", "what's in room
      E210", "where is the HOD of data science").

   2. CAMPUS_LOCATION_FACTS_TEXT -- a compact block appended to
      Config.CAMPUS_LOCATION_FACTS (see vivek_common.py), so Gemini
      itself is grounded in the FULL spreadsheet for open-ended phrasing
      that doesn't hit the instant lookup either ("which floor is the
      HOD of AI and ML on", "is there a library on the MBA floor").

 If openpyxl isn't installed or the spreadsheet is missing, this module
 degrades to empty results (find_location_answer always returns None,
 CAMPUS_LOCATION_FACTS_TEXT is "") instead of crashing the backend --
 same fail-open philosophy as the rest of this codebase (see
 AuraChatEngine.__init__'s GENAI_AVAILABLE handling).
================================================================================
"""

import os
import re
from typing import Dict, List, Optional

_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "Campus_Locations.xlsx")

try:
    import openpyxl
    OPENPYXL_AVAILABLE = True
except ImportError:
    OPENPYXL_AVAILABLE = False
    openpyxl = None


def _clean(value) -> str:
    return str(value).strip() if value not in (None, "") else ""


def _split_room_codes(room_no: str) -> List[str]:
    """'A109 & A110' -> ['A109', 'A110']; 'E001' -> ['E001']; '' -> []."""
    if not room_no:
        return []
    parts = re.split(r"\s*(?:&|,|/|\band\b)\s*", room_no, flags=re.IGNORECASE)
    return [p.strip() for p in parts if p.strip()]


def _normalize_code(code: str) -> str:
    """'A 018' / 'a018' / 'A-018' -> 'a018', for matching against free text."""
    return re.sub(r"[\s\-]", "", code).lower()


def _load_rows() -> List[Dict[str, str]]:
    if not OPENPYXL_AVAILABLE or not os.path.exists(_DATA_PATH):
        return []
    try:
        wb = openpyxl.load_workbook(_DATA_PATH, data_only=True, read_only=True)
        ws = wb.worksheets[0]
        rows_iter = ws.iter_rows(values_only=True)
        header = [(_clean(h)).lower() for h in next(rows_iter, [])]

        def col(name: str) -> Optional[int]:
            for i, h in enumerate(header):
                if name in h:
                    return i
            return None

        i_block, i_floor, i_room = col("block"), col("floor"), col("room")
        i_facility, i_notes = col("facility"), col("notes")

        rows = []
        for raw in rows_iter:
            def at(i):
                return _clean(raw[i]) if i is not None and i < len(raw) else ""
            facility = at(i_facility)
            if not facility:
                continue
            rows.append({
                "block": at(i_block),
                "floor": at(i_floor),
                "room": at(i_room),
                "facility": facility,
                "notes": at(i_notes),
            })
        return rows
    except Exception as e:
        print(f"[CampusLocations] failed to load {_DATA_PATH}: {e}")
        return []


def _describe(row: Dict[str, str]) -> str:
    bits = []
    if row["room"]:
        bits.append(f"room {row['room']}")
    if row["floor"]:
        bits.append(row["floor"] if row["floor"].lower().startswith(("ground", "1st", "2nd", "3rd")) or "floor" in row["floor"].lower() else f"{row['floor']} floor")
    if row["block"]:
        bits.append(row["block"])
    location = ", ".join(bits) if bits else "an unspecified location"
    sentence = f"{row['facility']} is at {location}."
    if row["notes"]:
        sentence += f" ({row['notes']})"
    return sentence


_ROWS = _load_rows()

# ── instant lookup: facility name (lowercased) -> combined answer ──────
_BY_FACILITY: Dict[str, List[Dict[str, str]]] = {}
# ── instant lookup: normalized room code -> combined answer ────────────
_BY_ROOM_CODE: Dict[str, List[Dict[str, str]]] = {}

for _row in _ROWS:
    _BY_FACILITY.setdefault(_row["facility"].lower(), []).append(_row)
    for _code in _split_room_codes(_row["room"]):
        _BY_ROOM_CODE.setdefault(_normalize_code(_code), []).append(_row)

_STOPWORDS = {"where", "is", "the", "a", "an", "in", "at", "on", "of", "which", "floor",
              "room", "can", "i", "find", "you", "tell", "me", "whats", "what's", "what"}


def _combined_answer(rows: List[Dict[str, str]]) -> str:
    if len(rows) == 1:
        return _describe(rows[0])
    return " ".join(_describe(r) for r in rows[:3])


def find_location_answer(text: str) -> Optional[str]:
    """Best-effort instant match against the spreadsheet. `text` should
    already be lowercased (chat_service passes the same `working` string
    it uses for Config.LOCATION_QA). Returns None if nothing matches
    confidently -- callers should fall through to Gemini (which also has
    CAMPUS_LOCATION_FACTS_TEXT below for grounding) rather than guess."""
    if not text or not _ROWS:
        return None

    # 1) room-code match ("where is a018", "where is a 018", "room e210")
    #    -- most specific and least ambiguous, so checked first. Codes are
    #    split into their alpha prefix + digit suffix so an optional
    #    space/hyphen between them (as typed OR as a speech-recognizer
    #    might transcribe it spoken aloud) still matches, without losing
    #    the word boundary the way blindly stripping all whitespace from
    #    `text` first would (that would let "a018" wrongly match inside
    #    an unrelated word ending in "...a018"-like adjacency).
    for code, rows in _BY_ROOM_CODE.items():
        m = re.match(r"^([a-z]+)(\d+.*)$", code)
        if not m:
            continue
        prefix, digits = m.group(1), re.escape(m.group(2))
        pattern = rf"\b{re.escape(prefix)}[\s\-]*{digits}\b"
        if re.search(pattern, text):
            return _combined_answer(rows)

    # 2) exact facility-name substring match ("where is the library")
    for facility, rows in _BY_FACILITY.items():
        if facility in text:
            return _combined_answer(rows)

    # 3) loose word-overlap match for short queries like "hod data science"
    #    or "dbms lab" that don't exactly match a stored facility string
    #    word-for-word (e.g. the sheet says "DBMS/DAA Lab", someone asks
    #    "where is dbms lab" without "daa"). Requires at least 2 shared
    #    significant words AND at least half of the facility's own words
    #    to be present, so a short query can't loosely match an unrelated
    #    long facility name off a single incidental shared word.
    query_words = {w for w in re.findall(r"[a-z0-9]+", text) if w not in _STOPWORDS}
    if len(query_words) < 2:
        return None
    best_rows, best_score = None, 0
    for facility, rows in _BY_FACILITY.items():
        facility_words = {w for w in re.findall(r"[a-z0-9]+", facility) if w not in _STOPWORDS}
        if not facility_words:
            continue
        overlap = query_words & facility_words
        if len(overlap) >= 2 and len(overlap) >= len(facility_words) / 2 and len(overlap) > best_score:
            best_rows, best_score = rows, len(overlap)
    if best_rows:
        return _combined_answer(best_rows)
    return None


def _build_facts_text() -> str:
    if not _ROWS:
        return ""
    by_block: Dict[str, List[Dict[str, str]]] = {}
    for row in _ROWS:
        by_block.setdefault(row["block"] or "Campus", []).append(row)

    lines = [
        "You also have this FULL campus room/facility directory. Use ONLY "
        "this information (plus anything above) when asked where a block, "
        "class, lab, room, office, or department is -- never guess a room "
        "number or block that isn't listed:"
    ]
    for block, rows in by_block.items():
        entries = []
        for row in rows:
            piece = row["facility"]
            details = []
            if row["room"]:
                details.append(row["room"])
            if row["floor"]:
                details.append(row["floor"])
            if details:
                piece += f" ({', '.join(details)})"
            entries.append(piece)
        lines.append(f"{block}: " + "; ".join(entries) + ".")
    return "\n".join(lines)


CAMPUS_LOCATION_FACTS_TEXT = _build_facts_text()

if _ROWS:
    print(f"[CampusLocations] loaded {len(_ROWS)} rows from {_DATA_PATH}")
elif OPENPYXL_AVAILABLE:
    print(f"[CampusLocations] no rows loaded -- check {_DATA_PATH} exists and has data")
else:
    print("[CampusLocations] `openpyxl` not installed -- pip install openpyxl to enable "
          "Excel-grounded campus location answers. The hand-authored Config.LOCATION_QA "
          "list in vivek_common.py still works without it.")
