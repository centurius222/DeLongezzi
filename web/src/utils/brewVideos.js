import { signal } from '@preact/signals';

// The brew button video library (Settings > Pictures, user 2026-10-02): every brew button video in
// one place on the machine (/api/videos), up to 3 MB together. Settings picks one or shuffles them;
// a theme can pick its own (customThemes meta brewVideo). Videos added from a theme's editor land
// here too, so there is one place to see and delete them.

// { videos: [{ id, name, size, tag, type, picture, once }], used, budget, free }; picture: a still
// picture; type: its content type; once: plays once and holds the last frame (MP4/WebM)
export const videoLibrary = signal({ videos: [], used: 0, budget: 3 * 1048576, free: 0 });

// The library from the machine, or null when it is away. 503: the machine is still reading it
// (just after a restart or a change, well under a second), so ask again.
export async function fetchVideoList() {
  try {
    let r = await fetch('/api/videos', { cache: 'no-store' });
    for (let i = 0; r.status === 503 && i < 15; i++) {
      await new Promise(resolve => setTimeout(resolve, 300));
      r = await fetch('/api/videos', { cache: 'no-store' });
    }
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function loadVideos() {
  const lib = await fetchVideoList();
  if (lib) videoLibrary.value = lib;
  return videoLibrary.value;
}

export const videoUrl = (v, part) => `/vid/${v.id}/${part}?v=${encodeURIComponent(v.tag || '')}`;

const newId = () =>
  'v' + Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

// The first frame, small, for when the button is idle. A video the browser can't play (an
// iPhone's HEVC in Chrome, say) fails here: the upload stops with a clear message.
async function firstFrame(file, maxSide = 320) {
  const url = URL.createObjectURL(file);
  try {
    let source;
    let w;
    let h;
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = url;
      await new Promise((resolve, reject) => {
        v.onloadeddata = resolve;
        v.onerror = reject;
      });
      v.currentTime = 0;
      await new Promise(resolve => {
        v.onseeked = resolve;
        setTimeout(resolve, 500); // already at 0: no seeked event
      });
      [source, w, h] = [v, v.videoWidth, v.videoHeight];
    } else {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      [source, w, h] = [img, img.naturalWidth, img.naturalHeight];
    }
    if (!w || !h) throw new Error('no picture');
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    const encode = type => new Promise(resolve => canvas.toBlob(resolve, type, 0.85));
    const webp = await encode('image/webp');
    return webp && webp.type === 'image/webp' ? webp : await encode('image/jpeg');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function upload(url, file, name, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file, name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let left = null;
      try {
        left = JSON.parse(xhr.responseText).left;
      } catch {
        // not JSON
      }
      reject(
        xhr.status === 413
          ? new Error(
              `Not enough video space: ${((left || 0) / 1048576).toFixed(1)} MB left of 3 MB. Delete a video first.`,
            )
          : new Error(`upload failed (${xhr.status})`),
      );
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(form);
  });
}

// Animated WebP has an ANIM chunk, animated PNG an acTL chunk near the start; a GIF with more than
// one frame more than one graphic control block. Those go up as they are (shrinking keeps one frame).
async function isAnimated(file) {
  const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64 * 1024));
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return head.includes('ANIM');
  if (bytes[0] === 0x89 && head.slice(1, 4) === 'PNG') return head.includes('acTL');
  if (head.startsWith('GIF8')) {
    let frames = 0;
    for (let i = 0; i + 2 < bytes.length && frames < 2; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++;
    }
    return frames > 1;
  }
  return false;
}

// Adds a video (MP4/WebM, animated WebP/GIF) or a still picture to the library; returns its id. A
// still picture is shrunk to 230 x 230 WebP (~10 KB, the button's size on screen) and shown as it
// is, idle and while brewing.
export async function addVideo(file, onProgress) {
  const lib = videoLibrary.value;
  if (file.type.startsWith('image/') && !(await isAnimated(file))) {
    let picture;
    try {
      picture = await firstFrame(file, 230);
    } catch {
      throw new Error('That file could not be read as a picture.');
    }
    if (lib.used + picture.size > lib.budget)
      throw new Error('Not enough space for videos and pictures. Delete one first.');
    const id = newId();
    await upload(`/api/video-file?id=${id}&part=video`, picture, 'video', onProgress);
    await upload(`/api/video-file?id=${id}&part=still`, picture, 'still');
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 32) || 'Picture';
    await fetch(`/api/video-name?id=${id}`, { method: 'POST', body: new URLSearchParams({ name }) });
    await loadVideos();
    return id;
  }
  if (lib.used + file.size > lib.budget) {
    throw new Error(
      `Not enough video space: ${((lib.budget - lib.used) / 1048576).toFixed(1)} MB left of 3 MB, this one is ${(file.size / 1048576).toFixed(1)} MB. Delete a video first.`,
    );
  }
  let still;
  try {
    still = await firstFrame(file);
  } catch {
    throw new Error("This video won't play in the browser. Export it as an H.264 MP4 (230 x 230).");
  }
  const id = newId();
  await upload(`/api/video-file?id=${id}&part=video`, file, 'video', onProgress);
  await upload(`/api/video-file?id=${id}&part=still`, still, 'still');
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 32) || 'Video';
  await fetch(`/api/video-name?id=${id}`, { method: 'POST', body: new URLSearchParams({ name }) });
  await loadVideos();
  return id;
}

export async function renameVideo(id, name) {
  await fetch(`/api/video-name?id=${id}`, { method: 'POST', body: new URLSearchParams({ name }) });
  await loadVideos();
}

// Loop while brewing (the default), or play once and hold the last frame.
export async function setVideoLoop(id, loop) {
  const r = await fetch(`/api/video-loop?id=${id}`, {
    method: 'POST',
    body: new URLSearchParams({ loop: loop ? '1' : '0' }),
  });
  if (!r.ok) throw new Error(`loop setting failed (${r.status})`);
  await loadVideos();
}

export async function deleteVideo(id) {
  const r = await fetch(`/api/video-delete?id=${id}`, { method: 'POST' });
  if (!r.ok) throw new Error(`delete failed (${r.status})`);
  await loadVideos();
}
