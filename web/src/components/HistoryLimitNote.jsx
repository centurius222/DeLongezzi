import { useEffect, useState } from 'preact/hooks';

// "Keeping the last 50 shots · change" under Shot History and Statistics (user 2026-10-02):
// the machine's Settings > Shot History choice, with a link to it. Shot History also gets
// the "Save Manual shots" switch right after it (same setting as Settings > General), saved at once.
export function HistoryLimitNote({ manualSwitch = false } = {}) {
  const [limit, setLimit] = useState(null);
  const [saveManual, setSaveManual] = useState(false);
  useEffect(() => {
    fetch('/api/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(s => {
        if (!s) return;
        setLimit(s.shotHistoryLimit ?? 50);
        setSaveManual(!!s.saveManualShots);
      })
      .catch(() => {});
  }, []);
  if (limit === null) return null;
  const onManual = e => {
    const on = e.target.checked;
    setSaveManual(on);
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `saveManualShots=${on ? 1 : 0}`,
    }).catch(() => setSaveManual(!on));
  };
  return (
    <div className='text-base-content/60 mb-4 flex flex-row flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
      <span>
        {limit > 0
          ? `Keeping the last ${limit} shots.`
          : 'Keeping all shots, until the storage is nearly full.'}{' '}
        <a href='/settings' className='link link-primary'>
          Change
        </a>
      </span>
      {manualSwitch && (
        // fixed red while off, green while on (not the theme's colours), so the state reads at a glance
        <label
          className='flex cursor-pointer items-center gap-2 font-medium'
          style={{ color: saveManual ? '#16a34a' : '#dc2626' }}
        >
          <input
            type='checkbox'
            className='toggle toggle-sm'
            style={{
              '--input-color': saveManual ? '#16a34a' : '#dc2626',
              color: saveManual ? '#16a34a' : '#dc2626',
              borderColor: saveManual ? '#16a34a' : '#dc2626',
            }}
            checked={saveManual}
            onChange={onManual}
          />
          Save Manual shots: {saveManual ? 'On' : 'Off'}
        </label>
      )}
      {manualSwitch && (
        // "Rebuild Shot History" right after the sentence, like "Change" above: it opens Settings >
        // System, where that button clears the entries deleted shots leave in the index (user 2026-10-22).
        <span>
          Only shots over 15 s are saved.{' '}
          <a href='/settings/system' className='link link-primary'>
            Rebuild Shot History
          </a>
        </span>
      )}
    </div>
  );
}
