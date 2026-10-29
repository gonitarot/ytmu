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
        title: d.title,
        artist: (d.author || '').replace(/ - Topic$/, ''),
        duration: parseInt(d.lengthSeconds, 10) || 0,
        isMusic,
        isSong: d.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV',
        thumbs: (d.thumbnail && d.thumbnail.thumbnails) || []
      };
    }
  } catch (e) { }
  return r;
};

const CSS = `
#ytm-player{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:9998;background:#0b0b0b;color:#fff;font-family:Roboto,Arial,sans-serif;overflow:hidden;display:none}
#ytm-player.on{display:block}
#ytm-bg{position:absolute;left:-10vw;top:-10vh;width:120vw;height:120vh;background-size:cover;background-position:center;opacity:.55}
#ytm-shade{position:absolute;left:0;top:0;width:100%;height:100%;background:linear-gradient(90deg,rgba(0,0,0,.55),rgba(0,0,0,.75))}
#ytm-art{position:absolute;left:5vw;top:11vh;width:62vh;height:62vh;border-radius:1.6vh;overflow:hidden;background:#222 center/cover no-repeat;box-shadow:0 3vh 8vh rgba(0,0,0,.6)}
#ytm-cv{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;display:none}
#ytm-meta{position:absolute;left:5vw;top:76vh;width:62vh}
#ytm-title{font-size:3.6vh;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ytm-artist{font-size:2.8vh;color:rgba(255,255,255,.65);margin-top:.8vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ytm-lyr{position:absolute;left:46vw;top:0;width:48vw;height:84vh;overflow:hidden;-webkit-mask-image:linear-gradient(transparent,#000 18%,#000 82%,transparent);mask-image:linear-gradient(transparent,#000 18%,#000 82%,transparent)}
#ytm-lines{position:absolute;left:0;top:0;width:100%;transition:transform .45s ease-out}
.ytm-l{font-size:5vh;font-weight:700;line-height:1.25;margin:2.6vh 0;color:rgba(255,255,255,.3);transition:color .3s,opacity .3s}
.ytm-l.cur{color:#fff}
.ytm-l.past{color:rgba(255,255,255,.4)}
#ytm-none{position:absolute;left:46vw;top:40vh;width:48vw;font-size:3.4vh;color:rgba(255,255,255,.5);display:none}
#ytm-bar{position:absolute;left:5vw;right:5vw;top:93vh;height:.7vh;background:rgba(255,255,255,.22);border-radius:1vh}
#ytm-fill{height:100%;width:0;background:#fff;border-radius:1vh}
#ytm-t0,#ytm-t1{position:absolute;top:94.6vh;font-size:2.2vh;color:rgba(255,255,255,.7)}
#ytm-t0{left:5vw}#ytm-t1{right:5vw}
#ytm-st{position:absolute;right:5vw;top:4vh;font-size:2.4vh;color:rgba(255,255,255,.6)}
`;

let root, bg, art, cv, titleEl, artistEl, lyr, lines, none, fill, t0, t1, st;
let curId = null;
let lrc = null;
let curIdx = -1;

function build() {
  if (root) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  root = document.createElement('div');
  root.id = 'ytm-player';
  root.innerHTML = '<div id="ytm-bg"></div><div id="ytm-shade"></div><div id="ytm-art"></div>' +
    '<div id="ytm-meta"><div id="ytm-title"></div><div id="ytm-artist"></div></div>' +
    '<div id="ytm-lyr"><div id="ytm-lines"></div></div><div id="ytm-none"></div>' +
    '<div id="ytm-bar"><div id="ytm-fill"></div></div><div id="ytm-t0">0:00</div><div id="ytm-t1">0:00</div><div id="ytm-st"></div>';
  document.body.appendChild(root);
  bg = root.querySelector('#ytm-bg');
  art = root.querySelector('#ytm-art');
  titleEl = root.querySelector('#ytm-title');
  artistEl = root.querySelector('#ytm-artist');
  lyr = root.querySelector('#ytm-lyr');
  lines = root.querySelector('#ytm-lines');
  none = root.querySelector('#ytm-none');
  fill = root.querySelector('#ytm-fill');
  t0 = root.querySelector('#ytm-t0');
  t1 = root.querySelector('#ytm-t1');
  st = root.querySelector('#ytm-st');
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

function showTrack(t) {
  curId = t.id;
  lrc = null;
  curIdx = -1;
  lines.innerHTML = '';
  lines.style.transform = 'translateY(0)';
  none.style.display = 'none';
  titleEl.textContent = t.title;
  artistEl.textContent = t.artist;
  art.style.backgroundImage = 'url(' + artUrl(t, 1920) + ')';
  bg.style.backgroundImage = 'url(' + artUrl(t, 64) + ')';
  getLyrics(t).then(function (res) {
    if (curId !== t.id) return;
    if (!res) {
      none.textContent = 'Sin letra sincronizada';
      none.style.display = 'block';
      return;
    }
    lrc = res;
    const frag = document.createDocumentFragment();
    res.forEach(function (l) {
      const d = document.createElement('div');
      d.className = 'ytm-l';
      d.textContent = l.s || '♪';
      frag.appendChild(d);
    });
    lines.appendChild(frag);
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
    d.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;font:18px monospace;color:#0f0;background:rgba(0,0,0,.6);padding:4px 8px;white-space:pre';
    document.body.appendChild(d);
  }
  d.textContent = txt;
}

function tick() {
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
    if (root && root.className === 'on') root.className = '';
    return;
  }
  build();
  if (root.className !== 'on') root.className = 'on';
  if (curId !== id) showTrack(t);

  const cur = v.currentTime || 0;
  const dur = v.duration || t.duration || 0;
  fill.style.width = dur ? Math.min(100, (cur / dur) * 100) + '%' : '0';
  t0.textContent = fmt(cur);
  t1.textContent = fmt(dur);
  st.textContent = v.paused ? '❚❚  Pausa' : '';

  if (lrc) {
    let idx = -1;
    for (let i = 0; i < lrc.length; i++) { if (lrc[i].t <= cur + 0.25) idx = i; else break; }
    if (idx !== curIdx) {
      curIdx = idx;
      const els = lines.children;
      for (let i = 0; i < els.length; i++) els[i].className = 'ytm-l' + (i === idx ? ' cur' : i < idx ? ' past' : '');
      if (idx >= 0 && els[idx]) {
        const target = lyr.clientHeight * 0.4 - (els[idx].offsetTop + els[idx].offsetHeight / 2);
        lines.style.transform = 'translateY(' + Math.round(target) + 'px)';
      }
    }
  }
}

setInterval(tick, 250);
