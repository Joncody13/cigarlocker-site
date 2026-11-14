// What members send through Settings > Suggest an app fix, in the console's words (2026-11-14; his words:
// 'we also need a "Suggest an app Fix" Button somewhere'). The words and the sorting only, kept apart from the
// page so the app's tests can run them (test/suggestions.test.ts). The answer read here is
// console_suggestions's (supabase/sql/131_suggestions.sql).

(function (root) {
  const ZONE = 'America/New_York';
  const whenFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ZONE });

  const KIND = { broken: 'Not working', idea: 'An idea', '': 'A suggestion' };
  const STATUS = { new: 'New', seen: 'Seen', done: 'Done' };

  /** The line over the list: how many wait for him, of how many in all. */
  function summary(x) {
    if (!x) return 'The suggestions could not be read just now.';
    const all = Number(x.all) || 0;
    const waiting = Number(x.waiting) || 0;
    if (all === 0) return 'None yet. Members send them from Settings, Help and legal, Suggest an app fix.';
    if (waiting === 0) return `Nothing new. ${all} in all, every one looked at.`;
    return `${waiting} new, of ${all} in all.`;
  }

  /** Who sent it: their username and email when they were signed in. */
  function who(r) {
    if (!r.user_id) return 'Someone not signed in';
    return [r.username ? `@${r.username}` : '', r.email || ''].filter(Boolean).join(' · ') || 'A member';
  }

  /** What it was sent from: "1.4.0 (16) · iPhone 16 Pro · iOS 26.1". */
  function from(r) {
    const version = r.app_version ? `${r.app_version}${r.build ? ` (${r.build})` : ''}` : '';
    const system = r.platform ? `${r.platform === 'ios' ? 'iOS' : r.platform === 'android' ? 'Android' : r.platform === 'web' ? 'Web' : r.platform}${r.os ? ` ${r.os}` : ''}` : '';
    return [version, r.model || '', system].filter(Boolean).join(' · ');
  }

  function when(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : whenFmt.format(d);
  }

  /** The rows as the page shows them: the new ones first, then by time, newest first. */
  function rows(x) {
    const list = x && Array.isArray(x.rows) ? x.rows.slice() : [];
    list.sort((a, b) => (a.status === 'new' ? 0 : 1) - (b.status === 'new' ? 0 : 1) || String(b.created_at).localeCompare(String(a.created_at)));
    return list.map((r) => ({
      id: r.id,
      userId: r.user_id || null,
      // What a person's page is opened with.
      person: r.user_id ? { id: r.user_id, email: r.email || '', username: r.username || '' } : null,
      status: r.status,
      statusWords: STATUS[r.status] || r.status,
      kindWords: KIND[r.kind] || KIND[''],
      head: [when(r.created_at), who(r)].filter(Boolean).join(' · '),
      from: from(r),
      body: String(r.body || ''),
      note: String(r.note || ''),
    }));
  }

  /** The marks he can give one, each with the button's words; the one it has is left out. */
  function marks(status) {
    return [
      { status: 'seen', label: 'Mark as seen' },
      { status: 'done', label: 'Mark as done' },
      { status: 'new', label: 'Back to new' },
    ].filter((m) => m.status !== status);
  }

  const api = { summary, rows, marks, who, from, KIND, STATUS };
  root.CigarSuggestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
