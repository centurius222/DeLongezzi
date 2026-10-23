import { useEffect, useRef, useState } from 'preact/hooks';
import {
  addVideo,
  deleteVideo,
  loadVideos,
  renameVideo,
  setVideoLoop,
  videoLibrary,
  videoUrl,
} from '../utils/brewVideos.js';
import { customThemes } from '../utils/customThemes.js';
import { brewVideoId, loadBrewState, refreshBrewState, resetBrewArt } from '../utils/brewArt.js';
import { OriginalCupPreview } from '../pages/Home/cards/ManualCard.jsx';

const MB = n => (n / 1048576).toFixed(1);

// One video in the library: its still (tap: plays it right there; a still picture has nothing
// to play), name (tap: rename), size, which themes use it, Loop (MP4/WebM: off plays it once and
// holds the last frame) and a delete button.
function VideoTile({ video, chosen, showing, usedBy, onChosen, onDeleted }) {
  const [playing, setPlaying] = useState(false);
  // A busy machine turns pictures away (503, more than 6 requests open) and an <img> never asks
  // again, so the tile stayed broken until a refresh (log 2026-10-17): try again every 1 s, 10 times.
  const [stillTry, setStillTry] = useState(0);
  const remove = async () => {
    const uses = [
      chosen && 'it is the video Settings plays',
      usedBy.length &&
        `${usedBy.length} theme${usedBy.length === 1 ? '' : 's'} use it (${usedBy.join(', ')})`,
    ].filter(Boolean);
    const msg = `Delete the video "${video.name}"?${uses.length ? `\n\n${uses.join('; ')}: they go back to the default.` : ''}`;
    if (!confirm(msg)) return;
    await deleteVideo(video.id);
    onDeleted(video.id);
  };
  const rename = async () => {
    const name = prompt('Name of this video', video.name);
    if (name && name.trim() && name.trim() !== video.name) await renameVideo(video.id, name.trim());
  };
  return (
    <div
      className={`border-base-content/10 relative rounded-lg border-2 p-2 ${
        showing
          ? 'bg-green-500/35 shadow-[0_0_18px_rgba(74,222,128,0.85)] ring-4 ring-green-400'
          : ''
      }`}
    >
      <button
        type='button'
        className='bg-base-300 relative block aspect-square w-full overflow-hidden rounded-md'
        onClick={() => !video.picture && setPlaying(p => !p)}
        title={video.picture ? video.name : playing ? 'Stop' : 'Play'}
      >
        {playing ? (
          <video
            src={videoUrl(video, 'video')}
            autoPlay
            loop={!video.once}
            muted
            playsInline
            className='h-full w-full object-cover'
          />
        ) : (
          <img
            key={stillTry}
            src={stillTry ? `${videoUrl(video, 'still')}&r=${stillTry}` : videoUrl(video, 'still')}
            alt=''
            loading='lazy'
            onError={() => stillTry < 10 && setTimeout(() => setStillTry(n => n + 1), 1000)}
            className='h-full w-full object-cover'
          />
        )}
        {!playing && !video.picture && (
          <span className='absolute inset-0 flex items-center justify-center text-3xl text-white/80 drop-shadow'>
            ▶
          </span>
        )}
      </button>
      <button
        type='button'
        className='mt-1 block w-full truncate text-left text-sm font-medium'
        onClick={rename}
      >
        {video.name}
      </button>
      <div className='text-base-content/60 text-xs'>
        {MB(video.size)} MB
        {usedBy.length ? ` · ${usedBy.length} theme${usedBy.length === 1 ? '' : 's'}` : ''}
      </div>
      <div className='mt-1 flex flex-wrap items-center gap-2'>
        <button
          type='button'
          className={`btn btn-xs ${chosen ? 'btn-primary' : ''}`}
          onClick={() => onChosen(video.id)}
        >
          {chosen ? 'In use' : 'Use'}
        </button>
        {(video.type || '').startsWith('video/') && (
          <label
            className='flex cursor-pointer items-center gap-1 text-xs'
            title='Off: plays once, then holds its last frame'
          >
            <input
              type='checkbox'
              className='checkbox checkbox-xs'
              checked={!video.once}
              onChange={async e => {
                const loop = e.currentTarget.checked;
                setPlaying(false);
                await setVideoLoop(video.id, loop).catch(() => {});
                refreshBrewState();
              }}
            />
            Loop
          </label>
        )}
      </div>
      <button
        type='button'
        className='btn btn-circle btn-xs btn-error absolute top-1 right-1'
        aria-label={`Delete ${video.name}`}
        title='Delete'
        onClick={remove}
      >
        ✕
      </button>
    </div>
  );
}

// The original cup: always first in the library, drawn live (its colours follow the boiler's
// heat), no storage, can't be deleted or renamed. Use = no video (user 2026-10-08).
function OriginalTile({ chosen, showing, onUse }) {
  return (
    <div
      className={`border-base-content/10 relative rounded-lg border-2 p-2 ${
        showing
          ? 'bg-green-500/35 shadow-[0_0_18px_rgba(74,222,128,0.85)] ring-4 ring-green-400'
          : ''
      }`}
    >
      <div className='bg-base-300 flex aspect-square w-full items-center justify-center overflow-hidden rounded-md'>
        <OriginalCupPreview size='7rem' />
      </div>
      <div className='mt-1 truncate text-sm font-medium'>Original cup</div>
      <div className='text-base-content/60 text-xs'>live, colours follow the heat</div>
      <div className='mt-1 flex flex-wrap items-center gap-2'>
        <button
          type='button'
          className={`btn btn-xs ${chosen ? 'btn-primary' : ''}`}
          onClick={onUse}
        >
          {chosen ? 'In use' : 'Use'}
        </button>
      </div>
    </div>
  );
}

// Settings > Pictures: every brew button video (also those added from a theme's editor), how
// they play (one, or another each shot), and the space they take (3 MB together).
export function BrewVideoLibrary({ chosen, mode, onChange }) {
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState('');
  const input = useRef(null);
  useEffect(() => {
    loadVideos();
    loadBrewState(); // which one the button shows now (showingId)
  }, []);
  const { videos, used, budget } = videoLibrary.value;
  const usedBy = id => customThemes.value.filter(t => t.brewVideo === id).map(t => t.name);
  // The one the brew button shows right now (a picture theme's own pick, the Settings choice, the
  // shuffled one): its tile glows bright green, whatever the colour theme (user 2026-10-08).
  // '' = Original cup.
  const showingId = brewVideoId.value;

  const add = async file => {
    if (!file) return;
    setMessage('');
    setProgress(0);
    try {
      const id = await addVideo(file, setProgress);
      if (!videos.length) onChange('brewVideo', id); // the first video plays straight away
      resetBrewArt();
      setMessage(
        file.size > 450 * 1024
          ? 'Added. Tip: about 0.3 MB is plenty (230 x 230, H.264, CRF 28).'
          : 'Added.',
      );
    } catch (e) {
      setMessage(e.message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div>
      <div className='flex flex-wrap items-center gap-3'>
        <span className='font-semibold tabular-nums'>
          {MB(used)} MB of {MB(budget)} MB
        </span>
        <progress
          className={`progress w-40 ${used > budget * 0.9 ? 'progress-warning' : 'progress-primary'}`}
          value={used}
          max={budget}
          aria-label='Video space used'
        />
        <input
          ref={input}
          type='file'
          accept='video/mp4,video/webm,image/*'
          className='hidden'
          onChange={e => {
            add(e.currentTarget.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
        {/* While adding, the button keeps its colour (a disabled button turned dark and vanished
            against the page) and only ignores clicks; after 100 % the still picture and the
            name are still being saved, so it says so (user 2026-10-17). */}
        <button
          type='button'
          className={`btn btn-primary btn-sm ${progress !== null ? 'pointer-events-none' : ''}`}
          aria-disabled={progress !== null}
          onClick={() => progress === null && input.current?.click()}
        >
          {progress !== null ? (
            <>
              <span className='loading loading-spinner loading-sm' aria-hidden='true' />{' '}
              {progress >= 100 ? 'Saving…' : `${progress}%`}
            </>
          ) : (
            '+ Add video or picture'
          )}
        </button>
      </div>
      {message && <p className='text-base-content/80 mt-2 text-sm'>{message}</p>}
      <div className='mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5'>
        <OriginalTile
          chosen={!chosen && mode !== 'shuffle'}
          showing={!showingId}
          onUse={() => {
            onChange('brewVideo', '');
            if (mode === 'shuffle') onChange('brewVideoMode', 'fixed');
          }}
        />
        {videos.map(v => (
          <VideoTile
            key={v.id}
            video={v}
            chosen={chosen === v.id}
            showing={showingId === v.id}
            usedBy={usedBy(v.id)}
            onChosen={id => {
              onChange('brewVideo', id);
              if (mode === 'shuffle') onChange('brewVideoMode', 'fixed');
            }}
            onDeleted={id => {
              if (chosen === id) onChange('brewVideo', '');
              resetBrewArt();
            }}
          />
        ))}
      </div>
      <div className='mt-3 flex flex-wrap items-center gap-3'>
        <span>Plays</span>
        <select
          className='select select-bordered select-sm'
          value={mode === 'shuffle' ? 'shuffle' : chosen || ''}
          onChange={e => {
            const v = e.currentTarget.value;
            if (v === 'shuffle') onChange('brewVideoMode', 'shuffle');
            else {
              onChange('brewVideoMode', 'fixed');
              onChange('brewVideo', v);
            }
          }}
        >
          <option value=''>Original cup</option>
          {videos.map(v => (
            <option key={v.id} value={v.id}>
              Always: {v.name}
            </option>
          ))}
          {videos.length > 1 && <option value='shuffle'>Shuffle: another video each shot</option>}
        </select>
        <span className='text-base-content/60 text-sm'>
          A theme can pick its own in its editor.
        </span>
      </div>
    </div>
  );
}
