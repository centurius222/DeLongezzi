import { useEffect, useState } from 'preact/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExpand } from '@fortawesome/free-solid-svg-icons/faExpand';
import { faCompress } from '@fortawesome/free-solid-svg-icons/faCompress';

// Full screen for phones and tablets (user 2026-10-01): one tap hides the browser's bars and the
// phone's status bar, another brings them back. Touch screens only (computers have F11), and only
// where the browser can do it (not iPhones). Works over plain http, unlike installing the page.
// A pack can place it with [data-part='fullscreen'].
const canFullscreen = () =>
  typeof document !== 'undefined' &&
  !!document.fullscreenEnabled &&
  window.matchMedia?.('(pointer: coarse)').matches;

export function FullscreenButton() {
  const [shown] = useState(canFullscreen);
  const [full, setFull] = useState(() => !!document.fullscreenElement);

  useEffect(() => {
    const update = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  if (!shown) return null;

  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  };

  return (
    <button
      type='button'
      data-part='fullscreen'
      onClick={toggle}
      aria-label={full ? 'Exit full screen' : 'Full screen'}
      title={full ? 'Exit full screen' : 'Full screen'}
      className='fixed top-2 right-2 z-[9000] flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white/85 shadow'
    >
      <FontAwesomeIcon icon={full ? faCompress : faExpand} />
    </button>
  );
}
