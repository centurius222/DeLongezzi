#ifndef MINIWIFIPAGE_H
#define MINIWIFIPAGE_H

// The hotspot's Wi-Fi page (MINI_WIFI_PAGE_PLAN.txt, 2026-10-14): one small file served at
// http://4.4.4.1/ while the machine is on its hotspot, instead of the full app (~1.8 MB over a
// slow link, blank when one file dropped). Saves through /api/settings like the app.
// Only the home Wi-Fi (name + password); the hotspot password stays in the full app (user
// 2026-10-14: an optional field here was confusing).
// Filled in by WebUIPlugin::serveWebAsset: %SSID%, %LASTIPLINE%, %FINDAT% (all HTML-escaped).
// Save sends wifiRetry, so it always restarts onto the router (5 s later, handleSettings).
static const char MINI_WIFI_PAGE[] = R"HTML(<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DeLongezzi Wi-Fi</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#111;color:#eee}
label{display:block;margin:14px 0 4px;font-size:14px;color:#aaa}
input{width:100%;box-sizing:border-box;padding:12px;font-size:17px;border-radius:8px;border:1px solid #444;background:#1c1c1c;color:#eee}
button{margin-top:18px;width:100%;padding:14px;font-size:17px;border:0;border-radius:8px;background:#e67e22;color:#111;font-weight:700}
button:disabled{background:#555;color:#ccc}
.note{margin-top:14px;font-size:14px;color:#aaa} a{color:#e67e22}
.big{font-size:18px;line-height:1.4;color:#eee}
.dots span{animation:blink 1.4s infinite both}
.dots span:nth-child(2){animation-delay:.2s} .dots span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:0}40%{opacity:1}}
</style></head><body>
<h2>Wi-Fi</h2>
<form id="f">
<label for="s">Network name</label>
<input id="s" name="wifiSsid" value="%SSID%" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
<label for="p">Password</label>
<input id="p" type="password" name="wifiPassword" placeholder="Saved - leave empty to keep" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false">
<label class="note"><input type="checkbox" id="show" style="width:auto"> Show password</label>
<p class="note">%LASTIPLINE%</p>
<p class="big">After the restart it's on your home Wi-Fi at %FINDAT%.</p>
<button id="b">Save &amp; restart</button>
</form>
<p class="big" id="msg"></p>
<p class="note"><a href="/settings/wifi">Open the full app</a></p>
<script>
document.getElementById('show').onchange = function (e) {
  document.getElementById('p').type = e.target.checked ? 'text' : 'password';
};
document.getElementById('f').onsubmit = async function (e) {
  e.preventDefault();
  var m = document.getElementById('msg'), btn = document.getElementById('b');
  var s = document.getElementById('s').value.trim();
  if (!s) { m.textContent = 'Enter the network name.'; return; }
  var b = new URLSearchParams();
  b.set('wifiSsid', s);
  var p = document.getElementById('p').value.trim();
  b.set('wifiPassword', p || '---unchanged---'); // empty = keep the saved one
  b.set('wifiRetry', '1'); // restart and try the router even when nothing changed
  btn.disabled = true;
  btn.innerHTML = 'Restarting<span class="dots"><span>.</span><span>.</span><span>.</span></span>';
  m.textContent = '';
  try {
    var r = await fetch('/api/settings', { method: 'POST', body: b });
    var d = await r.json();
    if (d.restarting) m.textContent = 'Saved - restarting onto ' + s + '.';
    else { btn.disabled = false; btn.textContent = 'Save & restart'; m.textContent = 'Saved.'; }
  } catch (x) {
    btn.disabled = false; btn.textContent = 'Save & restart';
    m.textContent = 'Not saved - check you are still on the DeLongezzi hotspot.';
  }
};
</script></body></html>)HTML";

#endif // MINIWIFIPAGE_H
