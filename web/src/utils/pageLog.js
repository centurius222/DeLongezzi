// Theme timing notes for the machine's permanent log (PAGE lines) were removed in build 967
// (2026-10-22, user: as little logging as possible). The functions stay, empty, so their callers
// (index.jsx, ThemePicker.jsx, Holiday.jsx) don't change.

export function setNoteLink(_api) {}

export function pageNote(_text) {}

export function notePick(_id) {}

export function noteShown(_id) {}
