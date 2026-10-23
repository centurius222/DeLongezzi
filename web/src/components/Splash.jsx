import { useEffect, useRef, useState } from 'preact/hooks';

// No picture after this long (a phone on slow Wi-Fi, or none on the machine): the splash closes
// itself rather than stay a plain coloured screen that needs a tap.
const PICTURE_WAIT_MS = 2500;

// Full-screen logo splash shown on page load. Tap/click anywhere to dismiss
// (fades out, then unmounts). Whether it appears is controlled by the
// per-browser preference in utils/splashManager.js.
export function Splash({ onDismiss }) {
  const [leaving, setLeaving] = useState(false);
  // The custom picture uploaded in Settings, else the built-in one.
  const [src, setSrc] = useState('/api/splash');
  // Hidden until a picture has loaded: with no custom splash the first try
  // 404s, and a broken image would flash its alt text before the fallback.
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

  const dismiss = () => {
    setLeaving(true);
    setTimeout(onDismiss, 300); // let the fade-out finish before unmounting
  };

  useEffect(() => {
    const t = setTimeout(() => loadedRef.current || dismiss(), PICTURE_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`bg-base-100 fixed inset-0 z-[10000] flex cursor-pointer items-center justify-center transition-opacity duration-300 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
      onClick={dismiss}
      role='button'
      aria-label='Dismiss splash screen'
    >
      <img
        src={src}
        onLoad={() => {
          loadedRef.current = true;
          setLoaded(true);
        }}
        onError={() => (src !== '/splash.webp' ? setSrc('/splash.webp') : dismiss())}
        alt=''
        className={`max-h-[70%] max-w-[80%] object-contain ${loaded ? '' : 'opacity-0'}`}
      />
    </div>
  );
}
