import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import {
  ROASTS,
  SPECIES,
  ORIGINS,
  PROCESSES,
  ROASTERS,
  BAG_DEFAULTS,
  bagLine,
  daysOffRoast,
  offRoastText,
  loadBeans,
  saveBeans,
  newBagId,
  ymd,
} from '../utils/beans.js';

// Shot Notes' bean pop-up (user 2026-10-09, from the bean picker mockup): your saved bags first
// (one dropdown, latest or most used), Done to use the picked one; "+ New bag" swaps the list
// for the new-bag form (taps and dropdowns, the roaster optional), and Save bag uses it at once.
//   current  the bag in the shot's notes (preselected)
//   onPick   (bag) -> the card puts it in the notes
//   onClose  closed without a change
export function BeanPicker({ current, onPick, onClose }) {
  const [beans, setBeans] = useState(null); // null while loading
  const [sortBy, setSortBy] = useState('latest');
  const [pickedId, setPickedId] = useState(current?.id || '');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    ...BAG_DEFAULTS,
    roasterPick: '',
    roaster: '',
    date: '',
    decaf: false,
  });
  const [error, setError] = useState('');

  useEffect(() => {
    loadBeans().then(list => {
      setBeans(list);
      if (!list.length) setAdding(true);
      else if (!list.some(b => b.id === pickedId)) setPickedId(latest(list)[0]?.id || '');
      // a new bag starts on the last bag's choices (they are usually alike)
      const last = latest(list)[0];
      if (last)
        setForm(f => ({
          ...f,
          roast: last.roast,
          species: last.species,
          origin: last.origin,
          process: last.process,
        }));
    });
  }, []);

  useEffect(() => {
    const esc = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const latest = list =>
    [...list].sort((x, y) => String(y.savedAt).localeCompare(String(x.savedAt)));
  const sorted = beans
    ? sortBy === 'used'
      ? [...beans].sort((x, y) => (y.uses || 0) - (x.uses || 0))
      : latest(beans)
    : [];
  const picked = beans?.find(b => b.id === pickedId) || null;

  const store = async list => {
    setBeans(list);
    try {
      await saveBeans(list);
      setError('');
    } catch (e) {
      setError(`Not saved on the machine: ${e.message}`);
    }
  };
  const use = async (bag, base = beans) => {
    // count a use when the shot gets a different bag than it had
    const list = base.map(b =>
      b.id === bag.id && b.id !== current?.id ? { ...b, uses: (b.uses || 0) + 1 } : b,
    );
    await store(list);
    onPick(list.find(b => b.id === bag.id));
  };
  const remove = async () => {
    if (!picked) return;
    const list = beans.filter(b => b.id !== picked.id);
    setPickedId(latest(list)[0]?.id || '');
    await store(list);
    if (!list.length) setAdding(true);
  };
  const saveBag = async () => {
    const roaster = form.roasterPick === '__other' ? form.roaster.trim() : form.roasterPick;
    const bag = {
      id: newBagId(),
      roaster,
      roast: form.roast,
      species: form.species,
      origin: form.origin,
      process: form.process,
      decaf: form.decaf,
      date: form.date,
      savedAt: ymd(new Date()),
      uses: 0,
    };
    await use(bag, [bag, ...(beans || [])]); // saves the list (with this bag's first use) and puts it in the notes
  };

  const set = patch => setForm(f => ({ ...f, ...patch }));
  const select = (label, key, list, extra) => (
    <label className='grid min-w-0 gap-1'>
      <span className='text-base-content/60 text-xs font-semibold'>{label}</span>
      <select
        className='select select-bordered w-full'
        value={form[key]}
        onChange={e => set({ [key]: e.target.value })}
      >
        {list.map(x => (
          <option key={x}>{x}</option>
        ))}
      </select>
      {extra}
    </label>
  );

  return createPortal(
    <div
      className='fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 p-3'
      onPointerDown={e => e.target === e.currentTarget && onClose()}
    >
      <div
        role='dialog'
        aria-label='Pick the bean'
        className='bg-base-100 border-base-content/10 grid max-h-[calc(100%-8px)] w-[min(96vw,520px)] gap-3.5 overflow-y-auto rounded-2xl border p-4 shadow-2xl'
      >
        <div className='text-base-content/60 text-center text-sm font-bold tracking-wide uppercase'>
          Bean
        </div>

        {beans === null ? (
          <div className='text-base-content/60 py-6 text-center text-sm'>Loading your beans…</div>
        ) : !adding ? (
          <div className='grid gap-3'>
            <div className='text-base-content/60 text-xs font-bold tracking-wide uppercase'>
              My beans
            </div>
            <div className='grid grid-cols-2 gap-1'>
              {[
                ['latest', 'Latest'],
                ['used', 'Most used'],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type='button'
                  aria-pressed={sortBy === k}
                  onClick={() => setSortBy(k)}
                  className={`cursor-pointer rounded-lg border py-2 text-sm font-semibold ${sortBy === k ? 'border-transparent bg-orange-500 text-[#1a1209]' : 'border-base-content/15 bg-base-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className='grid grid-cols-[1fr_auto] gap-2'>
              <select
                className='select select-bordered w-full'
                aria-label='My beans'
                value={pickedId}
                onChange={e => setPickedId(e.target.value)}
              >
                {sorted.map(b => (
                  <option key={b.id} value={b.id}>
                    {bagLine(b)}
                  </option>
                ))}
              </select>
              <button
                type='button'
                className='btn btn-outline btn-error'
                onClick={remove}
                disabled={!picked}
              >
                Remove
              </button>
            </div>
            {picked && (
              <div className='text-base-content/60 text-sm'>
                {[
                  picked.species,
                  offRoastText(daysOffRoast(picked)),
                  picked.uses ? `used ${picked.uses}×` : 'not used yet',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
            <div className='flex flex-wrap justify-center gap-2.5'>
              <button
                type='button'
                className='btn btn-primary px-8'
                onClick={() => picked && use(picked)}
                disabled={!picked}
              >
                Done
              </button>
              <button
                type='button'
                className='btn btn-outline'
                style={{ borderColor: '#22c55e', color: '#22c55e' }}
                onClick={() => setAdding(true)}
              >
                + New bag
              </button>
            </div>
          </div>
        ) : (
          <div className='grid gap-3'>
            <div className='text-base-content/60 text-xs font-bold tracking-wide uppercase'>
              New bag
            </div>
            <div className='grid gap-1'>
              <span className='text-base-content/60 text-xs font-semibold'>Roast</span>
              <div className='grid grid-cols-3 gap-1 sm:grid-cols-5'>
                {ROASTS.map(r => (
                  <button
                    key={r}
                    type='button'
                    aria-pressed={form.roast === r}
                    onClick={() => set({ roast: r })}
                    className={`cursor-pointer rounded-lg border px-1 py-2 text-[13px] font-semibold ${form.roast === r ? 'border-transparent bg-orange-500 text-[#1a1209]' : 'border-base-content/15 bg-base-200'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className='grid grid-cols-1 gap-2.5 sm:grid-cols-2'>
              {select('Species', 'species', SPECIES)}
              {select('Origin', 'origin', ORIGINS)}
              {select('Process', 'process', PROCESSES)}
              <label className='grid min-w-0 gap-1'>
                <span className='text-base-content/60 text-xs font-semibold'>
                  Roast date (optional)
                </span>
                <input
                  type='date'
                  className='input input-bordered w-full'
                  value={form.date}
                  onInput={e => set({ date: e.target.value })}
                />
              </label>
              <label className='grid min-w-0 gap-1'>
                <span className='text-base-content/60 text-xs font-semibold'>
                  Roaster (optional)
                </span>
                {/* "Other (type it)" at the top and the bottom, so it's never a scroll away */}
                <select
                  className='select select-bordered w-full'
                  value={form.roasterPick}
                  onChange={e => set({ roasterPick: e.target.value })}
                >
                  <option value=''>None</option>
                  <option value='__other'>Other (type it)</option>
                  {ROASTERS.map(x => (
                    <option key={x}>{x}</option>
                  ))}
                  <option value='__other'>Other (type it)</option>
                </select>
              </label>
              {form.roasterPick === '__other' && (
                <label className='grid min-w-0 gap-1'>
                  <span className='text-base-content/60 text-xs font-semibold'>Roaster name</span>
                  <input
                    type='text'
                    className='input input-bordered w-full'
                    maxLength={30}
                    placeholder='e.g. Clumb'
                    value={form.roaster}
                    autoFocus
                    onInput={e => set({ roaster: e.target.value })}
                  />
                </label>
              )}
            </div>
            <label className='flex cursor-pointer items-center gap-2.5 text-sm'>
              <input
                type='checkbox'
                className='checkbox checkbox-primary'
                checked={form.decaf}
                onChange={e => set({ decaf: e.target.checked })}
              />
              Decaf
            </label>
            <div className='flex flex-wrap justify-center gap-2.5'>
              <button type='button' className='btn btn-primary px-8' onClick={saveBag}>
                Save bag
              </button>
              {beans.length > 0 && (
                <button type='button' className='btn btn-outline' onClick={() => setAdding(false)}>
                  Back to my beans
                </button>
              )}
            </div>
          </div>
        )}
        {error && <div className='text-error text-center text-sm'>{error}</div>}
      </div>
    </div>,
    document.body,
  );
}
