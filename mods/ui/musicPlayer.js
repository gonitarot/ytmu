// YouTube Music player overlay: big square art on the left, synced lyrics on the right.
// Shown only for music tracks (videoDetails.musicVideoType / category "Music").

const tracks = {};
let lastId = null;
const lyricsCache = {};

const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  try {
    const d = r && r.videoDetails;
    if (d && d.videoId) {
      const mf = r.microformat && r.microformat.playerMicroformatRenderer;
      const isMusic = !!d.musicVideoType || (mf && mf.category === 'Music');
      lastId = d.videoId;
      tracks[d.videoId] = {
        id: d.videoId,
        keys: Object.keys(d).join(',') + '|' + Object.keys(mf || {}).join(','),
        title: d.title || (mf && mf.title && (mf.title.simpleText || (mf.title.runs && mf.title.runs[0].text))),
        artist: (d.author || (mf && mf.ownerChannelName) || '').replace(/ - Topic$/, ''),
        duration: parseInt(d.lengthSeconds, 10) || 0,
        isMusic,
        isSong: d.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV',
        thumbs: (d.thumbnail && d.thumbnail.thumbnails) || []
      };
    }
  } catch (e) { }
  return r;
};

const ST = {
  root: 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483000;background:#0b0b0b;color:#fff;font-family:Roboto,Arial,sans-serif;overflow:hidden;display:none',
  bg: 'position:absolute;left:-10vw;top:-10vh;width:120vw;height:120vh;background-size:cover;background-position:center;opacity:.55',
  shade: 'position:absolute;left:0;top:0;width:100%;height:100%;background:linear-gradient(90deg,rgba(0,0,0,.55),rgba(0,0,0,.75))',
  art: 'position:absolute;left:5vw;top:11vh;width:62vh;height:62vh;border-radius:1.6vh;overflow:hidden;background-color:#222;background-size:cover;background-position:center;background-repeat:no-repeat;box-shadow:0 3vh 8vh rgba(0,0,0,.6)',
  meta: 'position:absolute;left:5vw;top:76vh;width:62vh',
  title: 'font-size:3.6vh;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
  artist: 'font-size:2.8vh;color:rgba(255,255,255,.65);margin-top:.8vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
  lyr: 'position:absolute;left:46vw;top:0;width:48vw;height:84vh;overflow:hidden',
  lines: 'position:absolute;left:0;top:0;width:100%;transition:transform .45s ease-out',
  line: 'font-size:5vh;font-weight:700;line-height:1.25;margin:2.6vh 0;transition:color .3s',
  none: 'position:absolute;left:46vw;top:40vh;width:48vw;font-size:3.4vh;color:rgba(255,255,255,.5);display:none',
  bar: 'position:absolute;left:5vw;right:5vw;top:93vh;height:.7vh;background:rgba(255,255,255,.22);border-radius:1vh',
  fill: 'height:100%;width:0;background:#fff;border-radius:1vh',
  t0: 'position:absolute;top:94.6vh;font-size:2.2vh;color:rgba(255,255,255,.7);left:5vw',
  t1: 'position:absolute;top:94.6vh;font-size:2.2vh;color:rgba(255,255,255,.7);right:5vw',
  st: 'position:absolute;right:5vw;top:4vh;font-size:2.4vh;color:rgba(255,255,255,.6)'
};
const COL = { cur: '#fff', past: 'rgba(255,255,255,.4)', next: 'rgba(255,255,255,.3)' };

const U = {};
let curId = null;
let curTitle = null;
let lrc = null;
let curIdx = -1;
let step = '';

function build() {
  if (U.root) return;
  U.root = document.createElement('div');
  U.root.id = 'ytm-player';
  const mk = function (id, parent, text) {
    const e = document.createElement('div');
    e.id = id;
    e.style.cssText = ST[id.slice(4)] || '';
    if (text) e.textContent = text;
    parent.appendChild(e);
    return e;
  };
  U.bg = mk('ytm-bg', U.root);
  mk('ytm-shade', U.root);
  U.art = mk('ytm-art', U.root);
  const meta = mk('ytm-meta', U.root);
  U.titleEl = mk('ytm-title', meta);
  U.artistEl = mk('ytm-artist', meta);
  U.lyr = mk('ytm-lyr', U.root);
  U.lines = mk('ytm-lines', U.lyr);
  U.none = mk('ytm-none', U.root);
  const bar = mk('ytm-bar', U.root);
  U.fill = mk('ytm-fill', bar);
  U.t0 = mk('ytm-t0', U.root, '0:00');
  U.t1 = mk('ytm-t1', U.root, '0:00');
  U.st = mk('ytm-st', U.root);
  U.root.style.cssText = ST.root;
  document.body.appendChild(U.root);
}

function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60);
  const x = s % 60;
  return m + ':' + (x < 10 ? '0' : '') + x;
}

// Square, high-res art. Songs ship a square googleusercontent thumb; videos fall back to a center-cropped ytimg frame.
function artUrl(t, size) {
  const last = t.thumbs[t.thumbs.length - 1];
  if (last && /googleusercontent|ggpht/.test(last.url)) {
    return last.url.replace(/=w\d+-h\d+/, '=w' + size + '-h' + size).replace(/=s\d+/, '=s' + size);
  }
  return 'https://i.ytimg.com/vi/' + t.id + '/maxresdefault.jpg';
}

function parseLrc(text) {
  const out = [];
  text.split('\n').forEach(function (ln) {
    const re = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
    const stamps = [];
    let m;
    while ((m = re.exec(ln))) stamps.push(parseInt(m[1], 10) * 60 + parseFloat(m[2]));
    const txt = ln.replace(/\[[^\]]*\]/g, '').trim();
    stamps.forEach(function (s) { out.push({ t: s, s: txt }); });
  });
  out.sort(function (a, b) { return a.t - b.t; });
  return out;
}

function lrclib(url) {
  return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
}

function cleanTitle(s) {
  return (s || '').replace(/\s*[\(\[][^\)\]]*(official|video|lyric|audio|mv|m\/v|visualizer)[^\)\]]*[\)\]]/ig, '').trim();
}

function getLyrics(t) {
  if (lyricsCache[t.id] !== undefined) return Promise.resolve(lyricsCache[t.id]);
  const title = cleanTitle(t.title);
  const q = 'artist_name=' + encodeURIComponent(t.artist) + '&track_name=' + encodeURIComponent(title);
  return lrclib('https://lrclib.net/api/get?' + q + (t.duration ? '&duration=' + t.duration : ''))
    .then(function (r) { return r && r.syncedLyrics ? r : lrclib('https://lrclib.net/api/get?' + q); })
    .then(function (r) {
      if (r && r.syncedLyrics) return r;
      return lrclib('https://lrclib.net/api/search?q=' + encodeURIComponent(t.artist + ' ' + title)).then(function (list) {
        if (!list || !list.length) return null;
        let best = null;
        for (let i = 0; i < list.length; i++) {
          if (list[i].syncedLyrics && (!best || Math.abs(list[i].duration - t.duration) < Math.abs(best.duration - t.duration))) best = list[i];
        }
        return best && (!t.duration || Math.abs(best.duration - t.duration) < 8) ? best : null;
      });
    })
    .then(function (r) {
      const res = r && r.syncedLyrics ? parseLrc(r.syncedLyrics) : null;
      lyricsCache[t.id] = res && res.length ? res : null;
      return lyricsCache[t.id];
    });
}

function loadMeta(t) {
  if (t.title || t.metaTried) return Promise.resolve();
  t.metaTried = true;
  return fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + t.id))
    .then(function (r) { return r.json(); })
    .then(function (j) {
      t.title = j.title;
      t.artist = (j.author_name || '').replace(/ - Topic$/, '');
    })
    .catch(function (e) { t.metaErr = String(e && e.message); });
}

function showTrack(t) {
  curId = t.id;
  curTitle = t.title;
  lrc = null;
  curIdx = -1;
  U.lines.innerHTML = '';
  step = 's1'; U.lines.style.transform = 'translateY(0)';
  step = 's2'; U.none.style.display = 'none';
  U.titleEl.textContent = t.title;
  U.artistEl.textContent = t.artist;
  step = 's3';
  U.art.style.backgroundImage = 'url("' + artUrl(t, 1920) + '")';
  step = 's4';
  U.bg.style.backgroundImage = 'url("' + artUrl(t, 64) + '")';
  getLyrics(t).then(function (res) {
    if (curId !== t.id) return;
    if (!res) {
      U.none.textContent = 'Sin letra sincronizada';
      U.none.style.display = 'block';
      return;
    }
    lrc = res;
    const frag = document.createDocumentFragment();
    res.forEach(function (l) {
      const d = document.createElement('div');
      d.style.cssText = ST.line + ';color:' + COL.next;
      d.textContent = l.s || '♪';
      frag.appendChild(d);
    });
    U.lines.appendChild(frag);
  });
}

function currentVideoId() {
  const m = /[?&]v=([\w-]{11})/.exec(location.hash + location.search);
  return m ? m[1] : null;
}

function dbg(txt) {
  let d = document.getElementById('ytm-dbg');
  if (!d) {
    d = document.createElement('div');
    d.id = 'ytm-dbg';
    d.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;font:18px monospace;color:#0f0;background:rgba(0,0,0,.6);padding:4px 8px;white-space:pre';
    document.body.appendChild(d);
  }
  d.textContent = txt;
}

function tick() {
  try { tick2(); } catch (e) { dbg('ERR@' + step + ' ' + e.message + ' [' + [typeof U.root, typeof U.bg, typeof U.art, typeof U.lyr, typeof U.lines, typeof U.none, typeof U.fill, typeof U.t0, typeof U.t1, typeof U.st].join(',') + ']' + '\n' + String(e.stack).slice(0, 300)); }
}

function tick2() {
  const v = document.querySelector('video');
  const id = lastId;
  const t = id && tracks[id];
  let rect = v ? v.getBoundingClientRect() : null;
  const full = !!rect && rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;
  try {
    const wp = document.querySelector('ytlr-watch-page');
    dbg('ytm v2 hash=' + location.hash.slice(0, 50) + '\nid=' + id + ' music=' + (t && t.isMusic) + ' full=' + full + ' paused=' + (v && v.paused) +
      '\nrect=' + (rect ? Math.round(rect.width) + 'x' + Math.round(rect.height) : '-') + ' wp=' + !!wp + ' inner=' + window.innerWidth + 'x' + window.innerHeight);
  } catch (e) { }
  const watching = v && t && t.isMusic && full;
  if (!watching) {
    if (U.root && U.root.style.display !== 'none') U.root.style.display = 'none';
    return;
  }
  step = 'build';
  build();
  step = 'on';
  if (U.root.style.display !== 'block') U.root.style.display = 'block';
  step = 'show';
  if (!t.title && !t.metaTried) loadMeta(t);
  if (curId !== id || (t.title && curTitle !== t.title)) showTrack(t);
  step = 'upd';

  dbg('ytm v5 cur=' + curId + ' id=' + id + ' title=' + t.title + ' th=' + t.thumbs.length + ' ' + (t.thumbs[0] && t.thumbs[0].url.slice(0, 60)) + ' err=' + t.metaErr + '\nDOM=' + String(window.__ytmDom()).replace(/\n/g, ' | ').slice(0, 300) + '\n' + t.keys + ' on=' + U.root.style.display + ' lrc=' + (lrc ? lrc.length : lrc) + ' art=' + U.art.style.backgroundImage.slice(0, 60) + ' inDom=' + document.body.contains(U.root));
  const cur = v.currentTime || 0;
  const dur = v.duration || t.duration || 0;
  U.fill.style.width = dur ? Math.min(100, (cur / dur) * 100) + '%' : '0';
  U.t0.textContent = fmt(cur);
  U.t1.textContent = fmt(dur);
  U.st.textContent = v.paused ? '❚❚  Pausa' : '';

  if (lrc) {
    let idx = -1;
    for (let i = 0; i < lrc.length; i++) { if (lrc[i].t <= cur + 0.25) idx = i; else break; }
    if (idx !== curIdx) {
      curIdx = idx;
      const els = U.lines.children;
      for (let i = 0; i < els.length; i++) els[i].style.color = i === idx ? COL.cur : i < idx ? COL.past : COL.next;
      if (idx >= 0 && els[idx]) {
        const target = U.lyr.clientHeight * 0.4 - (els[idx].offsetTop + els[idx].offsetHeight / 2);
        U.lines.style.transform = 'translateY(' + Math.round(target) + 'px)';
      }
    }
  }
}

setInterval(tick, 250);

// debug: expose native player text
window.__ytmDom = function () {
  const wp = document.querySelector('ytlr-watch-page');
  return wp ? wp.innerText : 'no wp';
};
