import { useEffect, useState } from 'preact/hooks';
import { Spinner } from '../../components/Spinner.jsx';
import { machine } from '../../services/ApiService.js';

// The storage walk (build 955/956): it holds storage ~5 s, so a save meanwhile waits. From the live status:
// the time until the next timed walk (standby only), or that one is running now.
function StorageWalk() {
  const { storageWalking, storageNextWalk } = machine.value.status;
  let text;
  if (storageWalking) text = 'Storage walk running';
  else if (storageNextWalk === -2) text = 'Next storage walk: in standby';
  else if (Number.isFinite(storageNextWalk) && storageNextWalk >= 0) {
    // counts down live: the status arrives every 0.5 s
    const h = Math.floor(storageNextWalk / 3600);
    const m = Math.floor((storageNextWalk % 3600) / 60);
    const s = storageNextWalk % 60;
    const left = h ? `${h} h ${m} min ${s} s` : m ? `${m} min ${s} s` : `${s} s`;
    text = storageNextWalk === 0 ? 'Storage walk due now' : `Next storage walk in ${left}`;
  } else return null;
  return (
    <div
      className={`${storageWalking ? 'text-warning' : 'text-base-content/50'} text-[11px] tabular-nums whitespace-nowrap`}
      title='The machine counts its storage only in standby: 15 min after entering standby, then every 15 min'
    >
      {text}
    </div>
  );
}

// How long the machine has been running (from /api/diagnostics), refreshed every minute.
function Uptime() {
  const [secs, setSecs] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/diagnostics')
        .then(r => (r.ok ? r.json() : null))
        .then(d => alive && Number.isFinite(d?.uptime) && setSecs(d.uptime))
        .catch(() => {});
    load();
    const t = setInterval(load, 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (secs === null) return null;
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return (
    <div className='text-base-content/50 ml-auto text-[11px] tabular-nums whitespace-nowrap' title='Time since the machine last started'>
      Up {d ? `${d}d ` : ''}{h}h {m}m
    </div>
  );
}

export function StickyFormFooter({
  submitting,
  onRestart,
  dirty = false,
  disabled = false,
  status = null,
}) {
  return (
    <div className='border-base-content/10 bg-base-300/95 sticky bottom-0 z-40 mt-6 border-t pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-start sm:gap-4'>
        <div className='flex w-full items-center gap-2 sm:w-auto'>
          <button
            type='submit'
            className='btn btn-primary btn-sm flex-1 sm:flex-none'
            disabled={submitting || disabled}
          >
            {submitting && <Spinner size={4} className='mr-2' />}
            Save Settings
          </button>
          <button
            type='submit'
            name='restart'
            className='btn btn-secondary btn-sm flex-1 sm:flex-none'
            disabled={submitting || disabled}
            onClick={onRestart}
          >
            Save & Restart
          </button>
        </div>
        {status === 'failed' && (
          <div className='text-error text-sm font-semibold'>
            Save failed: check the connection and press Save again
          </div>
        )}
        {status === 'unnamed' && (
          <div className='text-error text-sm font-semibold'>
            Not saved: the theme you're making needs a name
          </div>
        )}
        {status === 'restarting' && (
          <div className='text-success text-sm font-semibold'>Saved. The machine is restarting</div>
        )}
        {status === 'saved' && !dirty && (
          <div className='text-success text-sm font-semibold'>Saved</div>
        )}
        {dirty && status !== 'failed' && status !== 'unnamed' && (
          <div className='text-warning text-sm font-semibold'>
            Unsaved changes: press Save Settings
          </div>
        )}
        <div className='text-base-content/60 hidden text-[11px] leading-tight sm:block sm:max-w-xs'>
          * Restart required for Wi-Fi, Timezone, or Plugin changes.
        </div>
        <div className='text-base-content/60 text-center text-[11px] leading-tight sm:hidden'>
          * Restart required for Wi-Fi, Timezone, or Plugin changes.
        </div>
        <StorageWalk />
        <Uptime />
      </div>
    </div>
  );
}
