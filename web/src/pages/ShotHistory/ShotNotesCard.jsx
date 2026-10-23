import { useState, useEffect, useContext, useCallback, useRef } from 'preact/hooks';
import { ApiServiceContext } from '../../services/ApiService.js';
import { TurnDial } from '../../components/TurnDial.jsx';
import {
  GRINDERS,
  GRINDER_BRANDS,
  splitGrinder,
  joinGrinder,
  grinderName,
} from '../../utils/grinders.js';
import {
  BASKET_BRANDS,
  BASKET_SIZES_MM,
  BASKET_GRAMS,
  splitBasket,
  joinBasket,
  basketName,
} from '../../utils/baskets.js';
import { createPortal } from 'preact/compat';
import { FlavorWheel, FlavorWheelIcon } from '../../components/FlavorWheel.jsx';
import { BeanPicker } from '../../components/BeanPicker.jsx';
import { bagLine, daysOffRoast, offRoastText } from '../../utils/beans.js';
import { flavorsFromNotes, notesWithFlavors, FLAVOR_COLOR } from '../../utils/flavors.js';

// Notes are kept by "Save as profile" (HistoryCard), which gets every edit through onNotesEdit.
export default function ShotNotesCard({ shot, onNotesLoaded, onNotesEdit }) {
  const apiService = useContext(ApiServiceContext);

  // Which number the turn dial is setting: 'doseIn', 'doseOut', 'grindSetting' or null.
  const [dial, setDial] = useState(null);
  const [basketOpen, setBasketOpen] = useState(false);
  const [flavorOpen, setFlavorOpen] = useState(false);
  const [beanOpen, setBeanOpen] = useState(false);
  const notesBox = useRef(null);
  const saveLast = (key, value) =>
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ [key]: value }).toString(),
    }).catch(() => {});
  const DIALS = {
    doseIn: { label: 'Dose In', unit: 'g', steps: [0.1, 1], defaultStep: 0.1, start: 18, max: 100 },
    doseOut: {
      label: 'Dose Out',
      unit: 'g',
      steps: [0.1, 1],
      defaultStep: 0.1,
      start: 36,
      max: 1000,
    },
    grindSetting: {
      label: 'Grind Setting',
      unit: '',
      steps: [0.5, 1],
      defaultStep: 1,
      start: 0,
      max: 999,
    },
  };
  // A field that opens the dial instead of the keyboard (one finger on a tablet).
  const dialField = (key, placeholder) => (
    <button
      type='button'
      data-dial-field
      className={`input input-bordered w-full cursor-pointer text-left tabular-nums ${dial === key ? 'border-primary ring-primary ring-1' : ''}`}
      aria-expanded={dial === key}
      onClick={() => {
        setDial(open => (open === key ? null : key));
        // The grinder dropdown always starts on the last grinder used (kept on the machine).
        if (key === 'grindSetting' && !notes.grinder) {
          fetch('/api/settings')
            .then(r => (r.ok ? r.json() : null))
            .then(s => s?.lastGrinder && handleInputChange('grinder', s.lastGrinder))
            .catch(() => {});
        }
      }}
    >
      {notes[key] || <span className='text-base-content/40'>{placeholder}</span>}
    </button>
  );
  const [notes, setNotes] = useState({
    id: shot.id,
    rating: 0,
    beanType: '',
    doseIn: '',
    doseOut: '',
    ratio: '',
    grindSetting: '',
    grinder: '',
    basket: '',
    flavors: [],
    bean: null,
    balanceTaste: 'balanced',
    notes: '',
  });

  // Always editable when the shot is open; stored by "Save as profile".
  const isEditing = true;
  const [initialLoaded, setInitialLoaded] = useState(false);

  // Calculate ratio function
  const calculateRatio = useCallback((doseIn, doseOut) => {
    if (doseIn && doseOut && parseFloat(doseIn) > 0 && parseFloat(doseOut) > 0) {
      return (parseFloat(doseOut) / parseFloat(doseIn)).toFixed(2);
    }
    return '';
  }, []);

  // Load notes ONLY on component mount
  useEffect(() => {
    if (initialLoaded) return; // Prevent reloading

    const loadNotes = async () => {
      try {
        const response = await apiService.request({
          tp: 'req:history:notes:get',
          id: shot.id,
        });

        let loadedNotes = {
          id: shot.id,
          rating: 0,
          beanType: '',
          doseIn: '',
          doseOut: '',
          ratio: '',
          grindSetting: '',
          grinder: '',
          basket: '',
          flavors: [],
          bean: null,
          balanceTaste: 'balanced',
          notes: '',
        };

        if (response.notes && Object.keys(response.notes).length > 0) {
          // Parse response.notes if it's a string
          let parsedNotes = response.notes;
          if (typeof response.notes === 'string') {
            try {
              parsedNotes = JSON.parse(response.notes);
            } catch (e) {
              console.warn('Failed to parse notes JSON:', e);
              parsedNotes = {};
            }
          }

          // Merge loaded notes with defaults
          loadedNotes = { ...loadedNotes, ...parsedNotes };
          // Flavours live in their own list; older notes kept them as a "Flavours: ..." line.
          if (!Array.isArray(loadedNotes.flavors) || !loadedNotes.flavors.length) {
            loadedNotes.flavors = flavorsFromNotes(loadedNotes.notes);
          }
          loadedNotes.notes = notesWithFlavors(loadedNotes.notes, []);
        }

        // Pre-populate doseOut with shot.volume if it's empty and shot.volume exists
        if (!loadedNotes.doseOut && shot.volume) {
          loadedNotes.doseOut = shot.volume.toFixed(1);
        }

        // Calculate ratio from loaded data
        if (loadedNotes.doseIn && loadedNotes.doseOut) {
          loadedNotes.ratio = calculateRatio(loadedNotes.doseIn, loadedNotes.doseOut);
        }

        setNotes(loadedNotes);
        setInitialLoaded(true);
        // Pass loaded notes to parent
        if (onNotesLoaded) {
          onNotesLoaded(loadedNotes);
        }
      } catch (error) {
        console.error('Failed to load notes:', error);

        // Even if loading fails, set up defaults
        const defaultNotes = {
          id: shot.id,
          rating: 0,
          beanType: '',
          doseIn: '',
          doseOut: shot.volume ? shot.volume.toFixed(1) : '',
          ratio: '',
          grindSetting: '',
          grinder: '',
          basket: '',
          flavors: [],
          bean: null,
          balanceTaste: 'balanced',
          notes: '',
        };

        setNotes(defaultNotes);
        setInitialLoaded(true);
        if (onNotesLoaded) {
          onNotesLoaded(defaultNotes);
        }
      }
    };

    loadNotes();
  }, []); // No dependencies - only run once

  // Reset if shot changes
  useEffect(() => {
    if (notes.id !== shot.id) {
      setInitialLoaded(false);
    }
  }, [shot.id, notes.id]);

  // Hand your edits (not the loaded values) to the card, which saves them with "Save as profile".
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    if (edited && onNotesEdit) onNotesEdit(notes);
  }, [notes, edited]);

  const handleInputChange = (field, value) => {
    setEdited(true);
    setNotes(prev => {
      const newNotes = { ...prev, [field]: value };

      // Only recalculate ratio if we're changing doseIn or doseOut
      if ((field === 'doseIn' || field === 'doseOut') && initialLoaded) {
        const doseIn = field === 'doseIn' ? value : prev.doseIn;
        const doseOut = field === 'doseOut' ? value : prev.doseOut;
        newNotes.ratio = calculateRatio(doseIn, doseOut);
      }

      return newNotes;
    });
  };

  const renderStars = (rating, editable = false) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <button
          key={i}
          type='button'
          disabled={!editable}
          onClick={() => editable && handleInputChange('rating', i)}
          className={`text-lg ${i <= rating ? 'text-yellow-400' : 'text-gray-300'} ${
            editable ? 'cursor-pointer hover:text-yellow-300' : 'cursor-default'
          }`}
        >
          ★
        </button>,
      );
    }
    return stars;
  };

  const getTasteColor = taste => {
    switch (taste) {
      case 'bitter':
        return 'text-orange-600';
      case 'sour':
        return 'text-yellow-600';
      case 'balanced':
        return 'text-green-600';
      default:
        return '';
    }
  };

  const picked = Array.isArray(notes.flavors) ? notes.flavors : [];
  // the shot's own time, for "N days off roast" (the bag's roast date to this shot)
  const shotTime = shot.timestamp ? new Date(shot.timestamp * 1000) : new Date();

  // Don't render until initial load is complete
  if (!initialLoaded) {
    return (
      <div className='mt-6 border-t pt-6'>
        <div className='flex items-center justify-center py-8'>
          <span className='loading loading-spinner loading-md'></span>
        </div>
      </div>
    );
  }

  return (
    <div className='border-t-base-content/10 accent mt-6 border-t-2 pt-6'>
      <div className='mb-4 flex items-center justify-between'>
        <h3 className='text-lg font-semibold'>Shot Notes</h3>
        <span className='text-base-content/60 text-sm'>Saved with Save as profile</span>
      </div>

      <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4'>
        {/* Rating */}
        <div className='form-control'>
          <label className='mb-2 block text-sm font-medium'>Rating</label>
          <div className='flex gap-1'>{renderStars(notes.rating, isEditing)}</div>
        </div>

        {/* Bean Type */}
        <div className='form-control'>
          <label className='mb-2 block text-sm font-medium'>Bean</label>
          {isEditing ? (
            // Opens the bean pop-up: your saved bags, or a new one (no typing needed).
            <button
              type='button'
              className={`input input-bordered h-auto min-h-12 w-full cursor-pointer py-2 text-left ${beanOpen ? 'border-primary ring-primary ring-1' : ''}`}
              onClick={() => setBeanOpen(true)}
            >
              {notes.bean ? (
                <span className='block min-w-0'>
                  <span className='block truncate'>{bagLine(notes.bean)}</span>
                  <span className='text-base-content/60 block truncate text-xs'>
                    {[notes.bean.species, offRoastText(daysOffRoast(notes.bean, shotTime))]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              ) : notes.beanType ? (
                <span className='block truncate'>{notes.beanType}</span>
              ) : (
                <span className='text-base-content/40'>Tap to pick the bean</span>
              )}
            </button>
          ) : (
            <div className='input input-bordered bg-base-200 w-full cursor-default'>
              {notes.bean ? bagLine(notes.bean) : notes.beanType || '—'}
            </div>
          )}
        </div>

        {/* Dose In */}
        <div className='form-control'>
          <label className='mb-2 block text-sm font-medium'>Dose In (g)</label>
          {isEditing ? (
            dialField('doseIn', 'Tap to set')
          ) : (
            <div className='input input-bordered bg-base-200 w-full cursor-default'>
              {notes.doseIn || '—'}
            </div>
          )}
        </div>

        {/* Dose Out */}
        <div className='form-control'>
          <label className='mb-2 block text-sm font-medium'>Dose Out (g)</label>
          {isEditing ? (
            dialField('doseOut', 'Tap to set')
          ) : (
            <div className='input input-bordered bg-base-200 w-full cursor-default'>
              {notes.doseOut || '—'}
            </div>
          )}
        </div>

        {/* Ratio */}
        <div className='form-control'>
          <label className='mb-2 block text-sm font-medium'>Ratio (1:{notes.ratio || '—'})</label>
          <div className='input input-bordered bg-base-200 w-full cursor-default'>
            {notes.ratio ? `1:${notes.ratio}` : '—'}
          </div>
        </div>

        {/* Grind Setting */}
        <div className='form-control'>
          <label className='mb-2 block text-sm font-medium'>Grind Setting</label>
          {isEditing ? (
            <>
              {dialField('grindSetting', 'Tap to set')}
              {notes.grinder && (
                <span className='text-base-content/60 mt-1 block text-xs'>
                  {grinderName(notes.grinder)}
                </span>
              )}
            </>
          ) : (
            <div className='input input-bordered bg-base-200 w-full cursor-default'>
              {notes.grindSetting || '—'}
            </div>
          )}
        </div>

        {/* Basket: opens a pop-up on the last basket used */}
        <div className='form-control'>
          <label className='mb-2 block text-sm font-medium'>Basket</label>
          {isEditing ? (
            <button
              type='button'
              className={`input input-bordered w-full cursor-pointer truncate text-left ${basketOpen ? 'border-primary ring-primary ring-1' : ''}`}
              aria-expanded={basketOpen}
              onClick={() => {
                setBasketOpen(true);
                if (!notes.basket) {
                  fetch('/api/settings')
                    .then(r => (r.ok ? r.json() : null))
                    .then(s => s?.lastBasket && handleInputChange('basket', s.lastBasket))
                    .catch(() => {});
                }
              }}
            >
              {basketName(notes.basket) || <span className='text-base-content/40'>Tap to set</span>}
            </button>
          ) : (
            <div className='input input-bordered bg-base-200 w-full cursor-default'>
              {basketName(notes.basket) || '—'}
            </div>
          )}
        </div>

        {/* Balance/Taste */}
        <div className='form-control'>
          <label className='mb-2 block text-sm font-medium'>Balance/Taste</label>
          {isEditing ? (
            <select
              className='select select-bordered w-full'
              value={notes.balanceTaste}
              onChange={e => handleInputChange('balanceTaste', e.target.value)}
            >
              <option value='bitter'>Bitter</option>
              <option value='balanced'>Balanced</option>
              <option value='sour'>Sour</option>
            </select>
          ) : (
            <div
              className={`input input-bordered bg-base-200 w-full cursor-default capitalize ${getTasteColor(notes.balanceTaste)}`}
            >
              {notes.balanceTaste}
            </div>
          )}
        </div>
      </div>

      {isEditing && beanOpen && (
        <BeanPicker
          current={notes.bean}
          onClose={() => setBeanOpen(false)}
          onPick={bag => {
            setBeanOpen(false);
            handleInputChange('bean', bag);
            // the readable line too: older readers (description, visualizer) use beanType
            handleInputChange('beanType', bagLine(bag));
          }}
        />
      )}

      {isEditing && flavorOpen && (
        <FlavorWheel
          initial={picked}
          onClose={() => setFlavorOpen(false)}
          onDone={(list, typeMore) => {
            setFlavorOpen(false);
            handleInputChange('flavors', list);
            if (typeMore) {
              // Back on the card, the cursor at the end of Notes to type more.
              setTimeout(() => {
                const box = notesBox.current;
                if (!box) return;
                box.focus();
                box.setSelectionRange(box.value.length, box.value.length);
              }, 50);
            }
          }}
        />
      )}

      {isEditing && basketOpen && (
        <BasketPicker
          value={notes.basket}
          onChange={b => {
            handleInputChange('basket', b);
            saveLast('lastBasket', b);
          }}
          onDone={() => setBasketOpen(false)}
        />
      )}

      {isEditing && dial && (
        <TurnDial
          key={dial}
          label={DIALS[dial].label}
          unit={DIALS[dial].unit}
          value={parseFloat(notes[dial]) || DIALS[dial].start}
          steps={DIALS[dial].steps}
          defaultStep={DIALS[dial].defaultStep}
          perTurn={10}
          min={0}
          max={DIALS[dial].max}
          // doses keep one decimal (18.0), like the shot's own weight
          onChange={v => handleInputChange(dial, DIALS[dial].unit ? v.toFixed(1) : String(v))}
          onDone={() => setDial(null)}
        >
          {dial === 'grindSetting' && (
            <GrinderPicker
              value={notes.grinder}
              onChange={g => {
                handleInputChange('grinder', g);
                fetch('/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({ lastGrinder: g }).toString(),
                }).catch(() => {});
              }}
            />
          )}
        </TurnDial>
      )}

      {/* Flavours (the wheel and its chips) on the left, Notes on the right; on a phone they stack. */}
      <div className='mt-6 grid grid-cols-1 gap-4 md:grid-cols-2'>
        <div className='form-control'>
          <label className='mb-2 block text-sm font-medium'>Flavours</label>
          {/* The whole box opens the wheel, with the 1 px orange hover outline the shot rows use. */}
          <div
            role={isEditing ? 'button' : undefined}
            tabIndex={isEditing ? 0 : undefined}
            onClick={isEditing ? () => setFlavorOpen(true) : undefined}
            onKeyDown={
              isEditing
                ? e =>
                    (e.key === 'Enter' || e.key === ' ') &&
                    (e.preventDefault(), setFlavorOpen(true))
                : undefined
            }
            className={`bg-base-200 border-base-content/10 flex min-h-[6rem] flex-wrap items-center gap-4 rounded-xl border p-4 ${isEditing ? 'cursor-pointer transition-colors hover:ring-1 hover:ring-orange-500' : ''}`}
          >
            {isEditing ? (
              <button
                type='button'
                onClick={() => setFlavorOpen(true)}
                className='group flex cursor-pointer flex-col items-center gap-2'
                aria-label='Coffee flavour wheel'
              >
                <span className='transition-transform group-hover:rotate-12 group-active:scale-95'>
                  <FlavorWheelIcon size={104} />
                </span>
                <span className='text-sm font-bold'>Coffee flavour wheel</span>
              </button>
            ) : null}
            <div className='flex min-w-0 flex-1 flex-wrap items-center gap-1.5'>
              {picked.length ? (
                picked.map(f => (
                  <button
                    key={f}
                    type='button'
                    disabled={!isEditing}
                    onClick={() => setFlavorOpen(true)}
                    className='cursor-pointer rounded-full px-2.5 py-1.5 text-[13px] font-semibold text-[#160f0a]'
                    style={{ backgroundColor: FLAVOR_COLOR[f] }}
                  >
                    {f}
                  </button>
                ))
              ) : (
                <span className='text-base-content/60 text-sm'>
                  {isEditing ? 'Tap the wheel to pick what you taste.' : 'No flavours picked'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className='form-control'>
          <label className='mb-2 block text-sm font-medium'>
            Notes{' '}
            {isEditing && <span className='text-xs text-gray-500'>({notes.notes.length}/400)</span>}
          </label>
          {isEditing ? (
            <textarea
              ref={notesBox}
              className='textarea textarea-bordered min-h-[6rem] w-full'
              rows='4'
              value={notes.notes}
              maxLength={400}
              onChange={e => handleInputChange('notes', e.target.value)}
              placeholder='Tasting notes, brewing observations, etc...'
            />
          ) : (
            <div className='textarea textarea-bordered bg-base-200 min-h-[6rem] w-full cursor-default'>
              {notes.notes || 'No notes added'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Brand, then model (about 230 grinders); "Brand|Model" in the notes and on the machine.
function GrinderPicker({ value, onChange }) {
  const { brand, model } = splitGrinder(value);
  return (
    <div className='grid w-full grid-cols-2 gap-2'>
      <select
        className='select select-bordered select-sm w-full'
        aria-label='Grinder brand'
        value={brand}
        onChange={e => {
          const b = e.target.value;
          const models = GRINDERS[b] || [];
          onChange(joinGrinder(b, models.length === 1 ? models[0] : ''));
        }}
      >
        <option value=''>Grinder brand</option>
        {GRINDER_BRANDS.map(b => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      <select
        className='select select-bordered select-sm w-full'
        aria-label='Grinder model'
        value={model}
        disabled={!brand}
        onChange={e => onChange(joinGrinder(brand, e.target.value))}
      >
        <option value=''>Model</option>
        {(GRINDERS[brand] || []).map(m => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}

// Basket pop-up: manufacturer, size, rated dose, pressurized. Floats over the dimmed page like
// the turn dial; a tap outside, Done or Escape closes it.
function BasketPicker({ value, onChange, onDone }) {
  const b = splitBasket(value);
  const set = patch => onChange(joinBasket({ ...b, ...patch }));
  useEffect(() => {
    const esc = e => e.key === 'Escape' && onDone();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onDone]);
  return createPortal(
    <div
      className='fixed inset-0 z-[10001] flex items-center justify-center bg-black/55 p-4'
      onPointerDown={e => e.target === e.currentTarget && onDone()}
    >
      <div
        role='dialog'
        aria-label='Set basket'
        className='bg-base-100 border-base-content/10 grid w-[min(92vw,360px)] gap-3 rounded-2xl border p-5 shadow-2xl'
      >
        <div className='text-base-content/60 text-center text-sm font-semibold tracking-wide uppercase'>
          Basket
        </div>
        <select
          className='select select-bordered w-full'
          aria-label='Basket manufacturer'
          value={b.brand}
          onChange={e => set({ brand: e.target.value })}
        >
          <option value=''>Manufacturer</option>
          {BASKET_BRANDS.map(x => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <div className='grid grid-cols-2 gap-2'>
          <select
            className='select select-bordered w-full'
            aria-label='Basket size'
            value={b.mm}
            onChange={e => set({ mm: Number(e.target.value) || '' })}
          >
            <option value=''>Size</option>
            {BASKET_SIZES_MM.map(x => (
              <option key={x} value={x}>
                {x} mm
              </option>
            ))}
          </select>
          <select
            className='select select-bordered w-full'
            aria-label='Basket dose'
            value={b.g}
            onChange={e => set({ g: Number(e.target.value) || '' })}
          >
            <option value=''>Grams</option>
            {BASKET_GRAMS.map(x => (
              <option key={x} value={x}>
                {x} g
              </option>
            ))}
          </select>
        </div>
        <label className='flex cursor-pointer items-center gap-3 py-1'>
          <input
            type='checkbox'
            className='checkbox checkbox-primary'
            checked={b.pressurized}
            onChange={e => set({ pressurized: e.target.checked })}
          />
          <span>Pressurized (double-wall)</span>
        </label>
        <button type='button' className='btn btn-primary justify-self-center px-8' onClick={onDone}>
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}
