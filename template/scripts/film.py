#!/usr/bin/env python3
"""film.py — the pipeline for a code-rendered documentary film, driven by film.json.

  python3 scripts/film.py cues                 list frames and cue indices (author shots against these)
  python3 scripts/film.py geo [--download]     build the relief-map data (asks nothing; --download fetches)
  python3 scripts/film.py audio [--dry]        narration → cue timings → build/timeline.json → score + ambience
  python3 scripts/film.py score                re-synthesize score + ambience only
  python3 scripts/film.py index [--only ID …] [--qa]   write index.html
  python3 scripts/film.py qa [--frames]        static checks; --frames also renders samples and inspects them
  python3 scripts/film.py render [--only ID …]  final render + package (--only: a sample cut of those frames)
  python3 scripts/film.py package              encodes, cover, contact sheet, post-draft numbers
  python3 scripts/film.py log "message"        append a timestamped line to logs/PRODUCTION_LOG.md

Run from the project root. Everything is deterministic except TTS (cached per cue text).
"""
import argparse, hashlib, json, math, os, re, shutil, struct, subprocess, sys, time
from datetime import datetime
from pathlib import Path

P = Path.cwd()
sys.path.insert(0, str(Path(__file__).resolve().parent))
BUILD = P / 'build'
SIZES = {'16:9': (1920, 1080), '9:16': (1080, 1920), '1:1': (1080, 1080)}
PLATFORM_LIMITS = {'x': 140, 'x-premium': 4 * 3600, 'douyin': 15 * 60, 'tiktok': 10 * 60, 'shipinhao': 30 * 60, 'youtube': 12 * 3600}


def load():
    f = P / 'film.json'
    if not f.exists():
        sys.exit('film.json not found — run from the project root')
    return json.loads(f.read_text())


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def probe_duration(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)], text=True).strip())


def log(msg):
    d = P / 'logs'
    d.mkdir(exist_ok=True)
    f = d / 'PRODUCTION_LOG.md'
    if not f.exists():
        f.write_text('# 制作记录（实测数字的出处）\n\n| 时间 | 事件 |\n|---|---|\n')
    with f.open('a') as fh:
        fh.write(f"| {datetime.now().strftime('%Y-%m-%d %H:%M')} | {msg} |\n")


# ── narration cues ───────────────────────────────────────────────────────────
def frame_cues(fr):
    n = fr.get('narration')
    if not n:
        return []
    return n if isinstance(n, list) else [s for s in re.split(r'(?<=[。？！])', n) if s.strip()]


def est_seconds(text, voice):
    return len(re.sub(r'[，。？！：；、“”\s]', '', text)) / 4.3 / voice.get('tempo', 1.0) + 0.25 * len(re.findall(r'[，：；]', text))


def cmd_cues(film, args):
    voice = film['meta'].get('voice', {})
    total = 0
    for fr in film['frames']:
        cues = frame_cues(fr)
        d = fr.get('duration') or (voice.get('lead', 0.4) + sum(est_seconds(c, voice) for c in cues) + voice.get('gap', 0.28) * max(0, len(cues) - 1) + voice.get('tail', 0.75))
        total += d
        print(f"\n{fr['id']}  (≈{d:.1f}s)" + (f"  station {fr['station']}" if fr.get('station') else ''))
        for i, c in enumerate(cues):
            print(f'   cue:{i}  {c}')
        for s in fr.get('shots', []):
            print(f"   shot {s['id']:<10} until {s.get('until', 'end')}")
    print(f'\nestimated total ≈ {total:.0f}s ({total / 60:.1f} min)')


# ── TTS providers ────────────────────────────────────────────────────────────
# Built in:  say      macOS system voice (free, offline, robotic — fine for a first cut)
#            edge     the edge-tts command line tool, if you have installed it
#            command  any CLI: voice.command is a shell template with {text} and {out}
#            auto     edge if edge-tts is on PATH, else say on macOS (the default)
# Your own:  put  tts_<name>.py  in ~/.config/code-doc-film/ (or $CODE_DOC_FILM_HOME) with a function
#            synth(text, voice, out_path)  that writes an audio file; then use "provider": "<name>".
#            That is where a paid cloud voice and its credentials belong — never in the project.
CONFIG_HOME = Path(os.environ.get('CODE_DOC_FILM_HOME', Path.home() / '.config' / 'code-doc-film'))


def tts_say(text, voice, out_mp3):
    if sys.platform != 'darwin' or not shutil.which('say'):
        raise SystemExit('voice provider "say" needs macOS. Set meta.voice.provider to "edge", "command" or your own plug-in (see references/audio.md).')
    aiff = Path(str(out_mp3) + '.aiff')
    sh(['say', '-v', voice.get('id') or 'Tingting', '-r', str(round(175 * voice.get('speed', 1.0))), '-o', str(aiff), text])
    sh(['ffmpeg', '-v', 'error', '-y', '-i', str(aiff), str(out_mp3)])
    aiff.unlink()


def tts_edge(text, voice, out_mp3):
    if not shutil.which('edge-tts'):
        raise SystemExit('voice provider "edge" needs the edge-tts command (pip install edge-tts).')
    pct = round((voice.get('speed', 1.0) - 1) * 100)
    sh(['edge-tts', '--voice', voice.get('id') or 'zh-CN-XiaoxiaoNeural', f'--rate={pct:+d}%', '--text', text, '--write-media', str(out_mp3)])


def tts_command(text, voice, out_mp3):
    sh(voice['command'].format(text=text.replace('"', '\\"'), out=str(out_mp3)), shell=True)


def tts_auto(text, voice, out_mp3):
    return (tts_edge if shutil.which('edge-tts') else tts_say)(text, voice, out_mp3)


BUILTIN_TTS = {'auto': tts_auto, 'say': tts_say, 'edge': tts_edge, 'command': tts_command}


def tts_provider(voice):
    name = voice.get('provider', 'auto')
    if name in BUILTIN_TTS:
        return BUILTIN_TTS[name]
    plug = CONFIG_HOME / f'tts_{name}.py'
    if not plug.exists():
        raise SystemExit(f'unknown voice provider "{name}": no built-in of that name and no {plug}')
    import importlib.util
    spec = importlib.util.spec_from_file_location(f'tts_{name}', plug)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.synth


def synth_cue(text, voice, audio_dir):
    """Returns a wav (48k mono, tempo applied) for one piece of text; cached by content hash."""
    key = hashlib.sha1(f"{voice.get('provider')}|{voice.get('id')}|{voice.get('speed', 1.0)}|{text}".encode()).hexdigest()[:16]
    mp3 = audio_dir / 'tts' / f'{key}.mp3'
    mp3.parent.mkdir(parents=True, exist_ok=True)
    if not mp3.exists():
        tts_provider(voice)(text, voice, mp3)
    wav = audio_dir / 'tts' / f"{key}.t{voice.get('tempo', 1.0)}.wav"
    if not wav.exists():
        sh(['ffmpeg', '-v', 'error', '-y', '-i', str(mp3), '-af', f"atempo={voice.get('tempo', 1.0)},silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse",
            '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', str(wav)])
    return wav


def silence_gaps(wav, lead, end):
    logtxt = subprocess.run(['ffmpeg', '-i', str(wav), '-af', 'silencedetect=noise=-38dB:d=0.18', '-f', 'null', '-'], capture_output=True, text=True).stderr
    sil = [(float(a), float(b)) for a, b in zip(re.findall(r'silence_start: ([\d.]+)', logtxt), re.findall(r'silence_end: ([\d.]+)', logtxt))]
    return [(a + b) / 2 for a, b in sil if a > lead + 0.2 and b < end - 0.1]


def build_frame_audio(fr, voice, audio_dir, dry):
    """Returns (wav path or None, duration, cues[{start,end,text}]) — times local to the frame."""
    cues = frame_cues(fr)
    lead, tail, gap = fr.get('lead', voice.get('lead', 0.4)), fr.get('tail', voice.get('tail', 0.75)), voice.get('gap', 0.28)
    out = audio_dir / f"{fr['id']}.wav"
    if not cues:
        return None, float(fr.get('duration', 3.0)), []
    if dry:
        t, res = lead, []
        for c in cues:
            d = est_seconds(c, voice)
            res.append({'start': round(t, 3), 'end': round(t + d, 3), 'text': c})
            t += d + gap
        dur = t - gap + tail
        sh(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', f'{dur:.3f}', '-c:a', 'pcm_s16le', str(out)])
        return out, round(dur, 3), res
    legacy = audio_dir / f"{fr['id']}.mp3"
    if voice.get('unit', 'cue') == 'frame' or legacy.exists():
        # one take for the whole frame; cue boundaries found from the pauses between sentences
        if not legacy.exists():
            tts_provider(voice)(''.join(cues), voice, legacy)
        sh(['ffmpeg', '-v', 'error', '-y', '-i', str(legacy), '-af', f"atempo={voice.get('tempo', 1.0)},adelay={int(lead * 1000)},apad=pad_dur={tail}", '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', str(out)])
        dur = probe_duration(out)
        end = dur - tail
        chars = [len(c) for c in cues]
        acc, bounds = 0, []
        for c in chars[:-1]:
            acc += c
            bounds.append(lead + (end - lead) * acc / sum(chars))
        gaps = silence_gaps(out, lead, end)
        cuts = []
        for b in bounds:
            cand = [g for g in gaps if g not in cuts]
            g = min(cand, key=lambda g: abs(g - b)) if cand else None
            cuts.append(g if g is not None and abs(g - b) < 0.7 else b)
        cuts = sorted(cuts)
        starts, ends = [lead] + cuts, cuts + [end]
        return out, round(dur, 3), [{'start': round(s, 3), 'end': round(e, 3), 'text': c} for c, s, e in zip(cues, starts, ends)]
    # one take per cue → exact cue times
    parts, res, t = [], [], lead
    for c in cues:
        w = synth_cue(c, voice, audio_dir)
        d = probe_duration(w)
        res.append({'start': round(t, 3), 'end': round(t + d, 3), 'text': c})
        parts.append((w, t))
        t += d + gap
    dur = t - gap + tail
    inputs, filt = [], []
    for i, (w, at) in enumerate(parts):
        inputs += ['-i', str(w)]
        filt.append(f'[{i}:a]adelay={int(at * 1000)}[a{i}]')
    filt.append(''.join(f'[a{i}]' for i in range(len(parts))) + f'amix=inputs={len(parts)}:normalize=0,apad=whole_dur={dur:.3f}[o]')
    sh(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(filt), '-map', '[o]', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', str(out)])
    return out, round(dur, 3), res


# ── time expressions ─────────────────────────────────────────────────────────
EXPR = re.compile(r'^(?:(cue|cueEnd):(\d+)|(end))([+-]\d+(?:\.\d+)?)?$')


def resolve(expr, cues, dur, base=0.0):
    """number | "end" | "cue:N" | "cue:N+0.5" | "cueEnd:N-0.2" → seconds (frame-local, minus base)."""
    if isinstance(expr, (int, float)):
        return float(expr)
    m = EXPR.match(expr)
    if not m:
        raise ValueError(f'bad time expression: {expr!r} (use seconds, "end", "end-0.5", "cue:2", "cue:2+0.5" or "cueEnd:2")')
    off = float(m.group(4)) if m.group(4) else 0.0
    if m.group(3):
        return round(dur + off - base, 3)
    i = int(m.group(2))
    if i >= len(cues):
        raise ValueError(f'{expr}: this frame has only {len(cues)} cues (cue:0 … cue:{len(cues) - 1})')
    return round(cues[i]['start' if m.group(1) == 'cue' else 'end'] + off - base, 3)


def resolve_tree(node, cues, dur, base):
    """Resolve every time-expression string inside a shot's map/card config (shot-local seconds)."""
    if isinstance(node, str):
        return resolve(node, cues, dur, base) if EXPR.match(node) else node
    if isinstance(node, list):
        return [resolve_tree(x, cues, dur, base) for x in node]
    if isinstance(node, dict):
        return {k: (v if k in ('text', 'title', 'sub', 'note') else resolve_tree(v, cues, dur, base)) for k, v in node.items()}
    return node


def sub_cues(cue, max_chars):
    """Split one narration cue into subtitle lines of at most max_chars, at punctuation."""
    text = cue['text']
    if len(text) <= max_chars:
        chunks = [text]
    else:
        chunks, buf = [], ''
        for piece in [x for x in re.split(r'(?<=[，：；、])', text) if x]:
            if buf and len(buf) + len(piece) > max_chars:
                chunks.append(buf); buf = piece
            else:
                buf += piece
        if buf:
            chunks.append(buf)
    total, t, out = sum(len(c) for c in chunks), cue['start'], []
    for c in chunks:
        d = (cue['end'] - cue['start']) * len(c) / total
        out.append({'start': round(t, 3), 'end': round(t + d, 3), 'text': c.strip().rstrip('。，：；、')})
        t += d
    return out


def sections(fr, shots, key, cues, dur):
    """Music / ambience sections with frame-local start/end. Either a frame-level list of
    {until, …} entries (independent of the shots) or one section per shot from the shot's own key."""
    norm = (lambda v: {'mood': v} if isinstance(v, str) else dict(v)) if key == 'music' else (lambda v: {'tags': v} if isinstance(v, list) else dict(v))
    spec = fr.get(key)
    if isinstance(spec, list) and spec and isinstance(spec[0], dict) and 'until' in spec[0]:
        out, t0 = [], 0.0
        for i, sec in enumerate(spec):
            end = resolve(sec['until'], cues, dur) if i < len(spec) - 1 else dur
            out.append({**{k: v for k, v in sec.items() if k != 'until'}, 'start': round(t0, 3), 'end': round(end, 3)})
            t0 = end
        return out
    default = spec if isinstance(spec, str) else ('calm' if key == 'music' else None)
    out = []
    for sh_ in shots:
        v = sh_.get(key, default)
        if v:
            out.append({**norm(v), 'start': sh_['start'], 'end': sh_['end']})
    return out


def build_timeline(film, dry):
    meta = film['meta']
    voice = meta.get('voice', {})
    audio_dir = P / 'audio'
    audio_dir.mkdir(exist_ok=True)
    W, H = SIZES[meta.get('aspect', '16:9')]
    max_chars = meta.get('subtitleMaxChars', 24 if W > H else 26)
    frames, subs, cursor = [], [], 0.0
    cover = meta.get('cover')
    if cover:
        cd = float(cover.get('duration', 1.2))
        frames.append({'id': '__cover', 'kind': 'cover', 'scene': cover.get('scene'), 'start': 0.0, 'duration': cd, 'cues': [], 'callouts': [], 'stamp': False,
                       'shots': [{'id': cover.get('shot', 'cover'), 'type': cover.get('type', 'map'), 'start': 0.0, 'end': cd, 'in': 'cut', 'map': cover.get('map'),
                                  'card': {'title': cover['title'], 'sub': cover.get('sub', ''), 'note': cover.get('note', ''), 'big': True, 'a': -1, 'b': cd - 0.1, 'fin': 0.01, 'fout': 0.4}}]})
        cursor = cd
    for n, fr in enumerate(film['frames']):
        wav, dur, cues = build_frame_audio(fr, voice, audio_dir, dry)
        shots, t0 = [], 0.0
        specs = fr.get('shots') or [{'id': 'main', 'until': 'end'}]
        for i, s in enumerate(specs):
            end = resolve(s.get('until', 'end'), cues, dur) if i < len(specs) - 1 else dur
            if end <= t0 + 0.05:
                raise ValueError(f"{fr['id']}/{s['id']}: shot ends at {end:.2f}s, before it starts ({t0:.2f}s)")
            shot = {k: v for k, v in s.items() if k not in ('until', 'map', 'card')}
            shot.update({'type': s.get('type', 'map' if 'map' in s else 'scene'), 'start': round(t0, 3), 'end': round(end, 3)})
            if 'map' in s:
                shot['map'] = resolve_tree(s['map'], cues, dur, t0)
            if 'card' in s:
                shot['card'] = resolve_tree(s['card'], cues, dur, t0)
            shots.append(shot)
            t0 = end
        callouts = []
        for c in fr.get('callouts', []):
            start = resolve(c['at'], cues, dur) if 'at' in c else cues[c['cue']]['start'] + c.get('delay', 0.2)
            end = resolve(c['until'], cues, dur) if 'until' in c else cues[c['cue']]['end'] if 'cue' in c else dur
            callouts.append({**{k: v for k, v in c.items() if k not in ('at', 'until', 'cue', 'delay')}, 'start': round(start, 3), 'end': round(end, 3)})
        callouts.sort(key=lambda c: c['start'])
        for a, b in zip(callouts, callouts[1:]):
            a['end'] = min(a['end'], b['start'])
        frames.append({'id': fr['id'], 'kind': 'frame', 'scene': fr.get('scene'), 'station': fr.get('station'), 'stamp': fr.get('stamp', {}), 'start': round(cursor, 3), 'duration': dur,
                       'cues': cues, 'shots': shots, 'callouts': callouts, 'audio': str(wav.relative_to(P)) if wav else None,
                       'music': sections(fr, shots, 'music', cues, dur), 'ambience': sections(fr, shots, 'ambience', cues, dur)})
        for c in cues:
            for sc in sub_cues(c, max_chars):
                subs.append({'start': round(sc['start'] + cursor, 3), 'end': round(sc['end'] + cursor, 3), 'text': sc['text']})
        cursor += dur
    tl = {'total': round(cursor, 3), 'size': [W, H], 'frames': frames, 'subs': subs, 'dry': dry, 'film_md5': film_md5()}
    BUILD.mkdir(exist_ok=True)
    (BUILD / 'timeline.json').write_text(json.dumps(tl, ensure_ascii=False, indent=1))
    return tl


def film_md5():
    import hashlib
    return hashlib.md5((P / 'film.json').read_bytes()).hexdigest()


def timeline():
    f = BUILD / 'timeline.json'
    if not f.exists():
        sys.exit('build/timeline.json missing — run: python3 scripts/film.py audio')
    tl = json.loads(f.read_text())
    # Shots, map framings and callouts are resolved into the timeline by `audio`. If film.json was
    # edited afterwards, index / qa / render would silently keep using the old values.
    tl['stale'] = bool(tl.get('film_md5')) and tl['film_md5'] != film_md5()
    return tl


def cmd_audio(film, args):
    tl = build_timeline(film, args.dry)
    for fr in tl['frames']:
        print(f"{fr['id']:<16} {fr['start']:7.2f}s  +{fr['duration']:5.2f}s  " + ' | '.join(f"{s['id']} {s['start']:.1f}–{s['end']:.1f}" for s in fr['shots']))
    print(f"total {tl['total']:.2f}s" + ('  (DRY: estimated timings, silent audio)' if args.dry else ''))
    log(f"配音与时间轴完成：{len(film['frames'])} 段，{tl['total']:.1f} 秒" + ('（试排，未合成配音）' if args.dry else ''))
    cmd_score(film, args)


def cmd_score(film, args):
    import synth
    tl = timeline()
    stats = synth.render_film(film, tl, P)
    print(f"score: {stats['music']}  ambience: {stats['sfx']}")


# ── index.html ────────────────────────────────────────────────────────────────
def cmd_index(film, args):
    tl = timeline()
    if tl.get('stale'):
        print('⚠ film.json was edited after the timeline was built — this index still uses the OLD shots/maps/callouts. Run `film.py audio` first (cached lines cost nothing).')
    meta = film['meta']
    W, H = tl['size']
    frames = tl['frames']
    if args.only:
        keep = [f for f in frames if f['id'] in args.only]
        missing = set(args.only) - {f['id'] for f in keep}
        if missing:
            sys.exit(f'no such frame id(s): {sorted(missing)}')
        cursor, shift = 0.0, {}
        for f in keep:
            shift[f['id']] = cursor - f['start']
            cursor += f['duration']
        subs = []
        for f in keep:
            subs += [{**s, 'start': round(s['start'] + shift[f['id']], 3), 'end': round(s['end'] + shift[f['id']], 3)} for s in tl['subs'] if f['start'] - 0.01 <= s['start'] < f['start'] + f['duration']]
        frames = [{**f, 'start': round(f['start'] + shift[f['id']], 3)} for f in keep]
        total = round(cursor, 3)
    else:
        subs, total = tl['subs'], tl['total']
    tags = []
    for i, f in enumerate(frames):
        if f.get('audio'):
            tags.append(f'      <audio id="vo-{i:02d}" src="{f["audio"]}" data-start="{f["start"]:.3f}" data-duration="{f["duration"]:.3f}" data-track-index="{10 + i % 2}" data-volume="1"></audio>')
    if not args.only:
        for name, track in (('score', 12), ('ambience', 13)):
            if (P / 'audio' / f'{name}.wav').exists():
                tags.append(f'      <audio id="{name}" src="audio/{name}.wav" data-start="0" data-duration="{total}" data-track-index="{track}" data-volume="1"></audio>')
    data = {'meta': {'W': W, 'H': H, 'title': meta.get('title', ''), 'progress': meta.get('progress'), 'stationFormat': meta.get('stationFormat', '第 {n} 站 / 共 {total} 站'),
                     'style': meta.get('style', {}), 'qa': bool(args.qa), 'hasGeo': (P / 'assets/geo.json').exists()},
            'frames': frames, 'subs': subs}
    html = f'''<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width={W}, height={H}" />
    <script type="importmap">
      {{ "imports": {{ "three": "./vendor/three/three.module.js", "three/addons/": "./vendor/three/addons/" }} }}
    </script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ width: {W}px; height: {H}px; overflow: hidden; background: #0e0c0a; }}
      #root {{ position: relative; width: {W}px; height: {H}px; overflow: hidden; background: #0e0c0a; }}
      #film {{ position: absolute; inset: 0; width: {W}px; height: {H}px; display: block; }}
      #overlay {{ position: absolute; inset: 0; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-no-timeline data-start="0" data-duration="{total}" data-width="{W}" data-height="{H}">
      <canvas id="film" class="clip" data-start="0" data-duration="{total}" data-track-index="0" width="{W}" height="{H}"></canvas>
      <div id="overlay" class="clip" data-start="0" data-duration="{total}" data-track-index="1"></div>
{chr(10).join(tags)}
    </div>
    <script type="module">
      import {{ boot }} from "./film/film.js";
      const FILM = {json.dumps(data, ensure_ascii=False)};
      window.__hf = window.__hf || {{}};
      window.__hf.buildReady = window.__hf.buildReady || {{}};
      // A broken scene must be loud: paint the error on the frame (and a red marker the QA script reads)
      // instead of leaving a silent black picture.
      window.__filmError = (e) => {{
        let d = document.getElementById("film-error");
        if (!d) {{ d = document.createElement("pre"); d.id = "film-error"; document.getElementById("root").appendChild(d);
          d.style.cssText = "position:absolute;inset:0;margin:0;padding:60px;background:#300;color:#fff;font:26px/1.4 Menlo,monospace;white-space:pre-wrap;z-index:99;border-left:14px solid #f00;border-top:14px solid #f00"; }}
        d.textContent = "FILM ERROR\\n\\n" + (e && e.stack ? e.stack : String(e));
      }};
      window.__hf.buildReady["film"] = boot({{ canvas: document.getElementById("film"), overlayRoot: document.getElementById("overlay"), film: FILM }})
        .then((film) => {{
          window.__film = film;
          const safe = (t) => {{ try {{ film.renderAt(t); document.getElementById("film-error")?.remove(); }} catch (e) {{ window.__filmError(e); }} }};
          window.addEventListener("hf-seek", (e) => safe(e.detail.time));
          safe(window.__hfThreeTime || 0);
        }})
        .catch((e) => {{ window.__filmError(e); }});
    </script>
  </body>
</html>
'''
    (P / 'index.html').write_text(html)
    print(f"index.html: {len(frames)} frame(s), {total}s, {W}×{H}" + ('  [QA build]' if args.qa else ''))
    return frames, total


# ── QA ────────────────────────────────────────────────────────────────────────
def static_checks(film, tl):
    errs, warns = [], []
    meta = film['meta']
    facts = ' '.join(' '.join([f.get('text', '')] + f.get('match', [])) for f in film.get('facts', []))
    nosrc = [f.get('text') for f in film.get('facts', []) if not f.get('source')]
    if nosrc:
        errs.append(f'facts without a source: {nosrc}')
    for fr in film['frames']:
        text = ''.join(frame_cues(fr))
        for num in set(re.findall(r'\d+(?:[.,]\d+)*', text)):
            if num not in facts:
                errs.append(f"{fr['id']}: number “{num}” in the narration is not covered by any entry in facts[] (add the claim with its source)")
        if fr.get('scene'):
            src = P / 'scenes' / f"{fr['scene']}.js"
            if not src.exists():
                errs.append(f"{fr['id']}: scenes/{fr['scene']}.js does not exist")
            else:
                js = src.read_text()
                for s in fr.get('shots', []):
                    if s.get('type', 'map' if 'map' in s else 'scene') == 'scene' and not re.search(rf"\b{re.escape(s['id'])}\s*[:(]", js):
                        errs.append(f"{fr['id']}: shot “{s['id']}” has no renderer in scenes/{fr['scene']}.js")
    # unknown music moods / chords / ambience tags would only fail later, inside the synth
    import synth
    def audio_spec(where, music, amb):
        for m in (music if isinstance(music, list) else [music] if music else []):
            mood = m if isinstance(m, str) else m.get('mood')
            if mood and mood not in synth.MOODS:
                errs.append(f"{where}: unknown music mood “{mood}” (known: {', '.join(synth.MOODS)})")
            if isinstance(m, dict) and m.get('chord') and m['chord'] not in synth.CHORDS:
                errs.append(f"{where}: unknown chord “{m['chord']}” (known: {', '.join(synth.CHORDS)})")
        for tag in amb or []:
            if tag not in synth.AMBIENCE:
                errs.append(f"{where}: unknown ambience tag “{tag}” (known: {', '.join(synth.AMBIENCE)})")
    for fr in film['frames']:
        audio_spec(fr['id'], fr.get('music'), fr.get('ambience'))
        for s in fr.get('shots', []):
            audio_spec(f"{fr['id']}/{s['id']}", s.get('music'), s.get('ambience'))
    cov = meta.get('cover') or {}
    if cov.get('type') == 'scene' and not (P / 'scenes' / f"{cov.get('scene')}.js").exists():
        errs.append(f"meta.cover: scenes/{cov.get('scene')}.js does not exist")
    if cov and cov.get('type', 'map') == 'map' and not film.get('geo'):
        errs.append('meta.cover uses a map background but film.json has no "geo" — set cover.type to "scene" with a scene and shot')
    for fr in tl['frames']:
        for s in fr['shots']:
            if s['end'] - s['start'] < 1.0 and fr['kind'] != 'cover':
                warns.append(f"{fr['id']}/{s['id']}: only {s['end'] - s['start']:.2f}s long — too short to read")
        for c in fr['callouts']:
            if c['end'] - c['start'] < 0.9:
                warns.append(f"{fr['id']}: callout “{c.get('num')}” is on screen for {c['end'] - c['start']:.2f}s")
    W, H = tl['size']
    limit = 26 if H > W else 24
    for s in tl['subs']:
        if len(s['text']) > limit + 2:
            warns.append(f"subtitle too long ({len(s['text'])} chars): {s['text']}")
    plat = meta.get('platform', 'x')
    lim = PLATFORM_LIMITS.get(plat)
    if lim and tl['total'] > lim:
        warns.append(f"{tl['total']:.0f}s is over the {plat} limit of {lim}s" + (' (X: 2:20 without Premium)' if plat == 'x' else ''))
    if tl.get('stale'):
        errs.append('film.json was edited after the timeline was built — run `film.py audio` (lines already synthesized come from the cache, so it costs nothing)')
    if tl.get('dry'):
        warns.append('timeline is a DRY run (estimated timings, no narration) — run `film.py audio` before rendering')
    return errs, warns


def qa_frames(film, tl, args):
    from PIL import Image, ImageDraw, ImageFont
    qdir = BUILD / 'qa'
    shutil.rmtree(qdir, ignore_errors=True)
    qdir.mkdir(parents=True)
    samples = []
    for fr in tl['frames']:
        for s in fr['shots']:
            d = s['end'] - s['start']
            # sample after the fade-in and before any fade-out, so a designed fade is not reported as "black"
            fin, fout = s.get('in', 'black'), s.get('out', 'cut')
            din = 0 if fin == 'cut' else (fin.get('dur', 0.4) if isinstance(fin, dict) else 0.4)
            dout = 0 if fout == 'cut' else (fout.get('dur', 0.5) if isinstance(fout, dict) else 0.5)
            first = min(max(din + 0.25, min(0.7, d * 0.4)), d * 0.6)
            last = max(d - dout - 0.25, d * 0.7) if dout else max(d - 0.25, d * 0.8)
            for tag, lt in (('start', first), ('mid', d * 0.5), ('end', last)):
                samples.append({'frame': fr['id'], 'shot': s['id'], 'tag': tag, 't': round(fr['start'] + s['start'] + lt, 2)})
    if args.only:
        samples = [s for s in samples if s['frame'] in args.only]
    ns = argparse.Namespace(only=None, qa=True)
    cmd_index(film, ns)
    try:
        times = ','.join(f"{s['t']:.2f}" for s in samples)
        sh(['npx', '--yes', 'hyperframes', 'snapshot', '--at', times, '-o', str(qdir), '--no-end', '--describe', 'false'], stdout=subprocess.DEVNULL)
    finally:
        cmd_index(film, argparse.Namespace(only=None, qa=False))
    # snapshot names its files frame-NN-at-<time>s.png — match each sample to the file with its time
    by_time = {}
    for png in qdir.glob('frame-*-at-*.png'):
        m = re.search(r'-at-([\d.]+)s$', png.stem)
        if m:
            by_time[round(float(m.group(1)), 2)] = png
    problems, fatal, thumbs = [], [], []
    for s in samples:
        png = by_time.get(s['t']) or min(by_time.items(), key=lambda kv: abs(kv[0] - s['t']), default=(None, None))[1]
        if png is None:
            problems.append(f"{s['frame']}/{s['shot']} t={s['t']}s: no snapshot was produced")
            continue
        im = Image.open(png).convert('RGB')
        mark = im.getpixel((5, 5))
        small = im.resize((160, 90 if im.width > im.height else 284))
        raw = small.tobytes()
        lum = [(0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2]) / 255 for i in range(0, len(raw), 3)]
        mean = sum(lum) / len(lum)
        var = sum((x - mean) ** 2 for x in lum) / len(lum)
        dark, bright = sum(x < 0.02 for x in lum) / len(lum), sum(x > 0.93 for x in lum) / len(lum)
        s.update({'mean': round(mean, 3), 'std': round(var ** 0.5, 3), 'file': png.name})
        where = f"{s['frame']}/{s['shot']} [{s['tag']}] t={s['t']}s"
        if mark[0] > 200 and mark[1] < 60 and mark[2] < 60:
            fatal.append(f'{where}: SCENE ERROR — the code threw; the message is painted on build/qa/{png.name}')
            continue
        if mark[0] > 200 and mark[2] > 200 and mark[1] < 80:
            problems.append(f'{where}: engine warning on this frame (camera corrected or view blocked) — open build/qa/{png.name}')
        if mean < 0.02 or dark > 0.97:
            problems.append(f'{where}: nearly black (mean {mean:.3f}) — open build/qa/{png.name}')
        elif mean > 0.80 or bright > 0.5:
            problems.append(f'{where}: blown out (mean {mean:.3f}, {bright:.0%} near white)')
        elif var ** 0.5 < 0.012:
            problems.append(f'{where}: flat, almost no detail (std {var ** 0.5:.3f})')
        if s['tag'] == 'mid':
            thumbs.append((im, f"{s['frame']}/{s['shot']} {s['t']}s"))
    # contact sheets of every shot's midpoint
    cols = 4 if tl['size'][0] > tl['size'][1] else 6
    tw = 480 if cols == 4 else 320
    th = round(tw * tl['size'][1] / tl['size'][0])
    font = ImageFont.load_default()
    for cand in ('/System/Library/Fonts/Supplemental/Songti.ttc', '/System/Library/Fonts/PingFang.ttc',                 # macOS
                 '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',   # Linux
                 'C:/Windows/Fonts/simsun.ttc', 'C:/Windows/Fonts/msyh.ttc'):                                           # Windows
        try:
            font = ImageFont.truetype(cand, 20); break
        except Exception:
            continue
    per = cols * (5 if cols == 4 else 3)
    sheets = []
    for n in range(0, len(thumbs), per):
        chunk = thumbs[n:n + per]
        rows = math.ceil(len(chunk) / cols)
        sheet = Image.new('RGB', (cols * tw, rows * th), '#000')
        dr = ImageDraw.Draw(sheet)
        for i, (im, label) in enumerate(chunk):
            x, y = (i % cols) * tw, (i // cols) * th
            sheet.paste(im.resize((tw, th)), (x, y))
            dr.rectangle([x, y, x + tw, y + 26], fill=(0, 0, 0))
            dr.text((x + 6, y + 2), label, fill=(255, 230, 80), font=font)
        out = qdir / f'contact-{len(sheets) + 1}.jpg'
        sheet.save(out, quality=88)
        sheets.append(out)
    (qdir / 'samples.json').write_text(json.dumps(samples, ensure_ascii=False, indent=1))
    # Every sample the same flat colour = the page never drew anything (a syntax error or a
    # missing import stops the whole module, so not even the error panel can appear).
    measured = [s for s in samples if 'std' in s]
    if len(measured) >= 2 and all(s['std'] < 0.004 for s in measured) and not fatal:
        fatal.append('every sampled frame is one flat colour — the page did not run at all. Usually a syntax error or a bad '
                     'import in a scene file: open the preview (tools/serve.py) and read the browser console.')
        problems = []
    return problems, sheets, fatal


def cmd_qa(film, args):
    tl = timeline()
    errs, warns = static_checks(film, tl)
    problems, sheets, fatal = (qa_frames(film, tl, args) if args.frames else ([], [], []))
    errs = errs + fatal
    for e in errs:
        print(f'✗ {e}')
    for w in warns:
        print(f'⚠ {w}')
    for p in problems:
        print(f'⚠ {p}')
    for s in sheets:
        print(f'contact sheet: {s.relative_to(P)}')
    print(f'\nQA: {len(errs)} error(s), {len(warns) + len(problems)} warning(s)' + ('' if args.frames else '  (static only — add --frames to inspect rendered samples)'))
    if errs:
        sys.exit(1)


# ── render + package ─────────────────────────────────────────────────────────
def cmd_render(film, args):
    tl = timeline()
    errs, warns = static_checks(film, tl)
    if errs:
        for e in errs:
            print(f'✗ {e}')
        sys.exit('fix the errors above before rendering')
    slug = film['meta'].get('slug', P.name)
    (P / 'renders').mkdir(exist_ok=True)
    (P / 'logs').mkdir(exist_ok=True)
    if args.only:
        # a sample cut: just these frames, with their narration (no score), for the user to judge the look
        _, total = cmd_index(film, argparse.Namespace(only=args.only, qa=False))
        out = P / 'renders' / f"sample-{'-'.join(args.only)}.mp4"
        try:
            t0 = time.time()
            sh(['npx', '--yes', 'hyperframes', 'render', '--quality', 'high', '--output', str(out)], stdout=open(P / 'logs' / 'render-sample.log', 'w'), stderr=subprocess.STDOUT)
        finally:
            cmd_index(film, argparse.Namespace(only=None, qa=False))
        small = out.with_name(out.stem + '-preview.mp4')
        sh(['ffmpeg', '-v', 'error', '-y', '-i', str(out), '-c:v', 'libx264', '-crf', '21', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(small)])
        log(f"样片渲染：{' '.join(args.only)}，{total:.1f} 秒，用时 {(time.time() - t0) / 60:.1f} 分钟")
        print(f'sample: {small.relative_to(P)} ({small.stat().st_size / 1e6:.0f} MB)')
        return
    cmd_index(film, argparse.Namespace(only=None, qa=False))
    out = P / 'renders' / f'{slug}.mp4'
    log(f"开始整片渲染（{tl['total']:.0f} 秒）")
    t0 = time.time()
    sh(['npx', '--yes', 'hyperframes', 'render', '--quality', 'high', '--output', str(out)], stdout=open(P / 'logs' / 'render.log', 'w'), stderr=subprocess.STDOUT)
    took = time.time() - t0
    log(f'整片渲染完成：用时 {took / 60:.1f} 分钟')
    print(f'rendered {out.relative_to(P)} in {took / 60:.1f} min')
    cmd_package(film, args)


def cmd_package(film, args):
    from PIL import Image
    tl = timeline()
    meta = film['meta']
    slug = meta.get('slug', P.name)
    R = P / 'renders'
    master = R / f'{slug}.mp4'
    if not master.exists():
        sys.exit(f'{master} not found — render first')
    W, H = tl['size']
    ln = 'loudnorm=I=-16:TP=-1.5:LRA=11'
    up = R / f'{slug}-upload.mp4'
    sh(['ffmpeg', '-v', 'error', '-y', '-i', str(master), '-c:v', 'libx264', '-preset', 'slow', '-b:v', '8M', '-maxrate', '10M', '-bufsize', '16M', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
        '-af', ln, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', str(up)])
    pv = R / f'{slug}-preview.mp4'
    scale = 'scale=1280:-2' if W >= H else 'scale=-2:1280'
    sh(['ffmpeg', '-v', 'error', '-y', '-i', str(master), '-vf', scale, '-c:v', 'libx264', '-preset', 'slow', '-b:v', '2.8M', '-maxrate', '3.5M', '-bufsize', '6M', '-pix_fmt', 'yuv420p',
        '-af', ln, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(pv)])
    cover = R / 'cover.png'
    sh(['ffmpeg', '-v', 'error', '-y', '-ss', '0', '-i', str(master), '-frames:v', '1', str(cover)])
    im = Image.open(cover).convert('L').resize((160, 90))
    first = sum(im.tobytes()) / (160 * 90) / 255
    dur = probe_duration(up)
    # contact sheet: one frame per shot midpoint
    snap = P / 'snapshots'
    snap.mkdir(exist_ok=True)
    mids = [f['start'] + (s['start'] + s['end']) / 2 for f in tl['frames'] for s in f['shots']]
    tiles = []
    for i, t in enumerate(mids):
        f = snap / f'_c{i:03d}.png'
        sh(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.2f}', '-i', str(up), '-frames:v', '1', '-vf', 'scale=480:-1' if W >= H else 'scale=270:-1', str(f)])
        tiles.append(f)
    cols = 5 if W >= H else 8
    sh(['ffmpeg', '-v', 'error', '-y', '-i', str(snap / '_c%03d.png'), '-vf', f'tile={cols}x{math.ceil(len(tiles) / cols)}', '-frames:v', '1', str(snap / 'final-contact.jpg')])
    for f in tiles:
        f.unlink()
    lines = sum(len(p.read_text().splitlines()) for d in ('film', 'scenes', 'scripts') for p in (P / d).rglob('*') if p.suffix in ('.js', '.py'))
    vol = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(up), '-af', 'volumedetect', '-vn', '-f', 'null', '-'], capture_output=True, text=True).stderr
    mean_db = re.search(r'mean_volume: (-?[\d.]+)', vol)
    report = {'duration_s': round(dur, 2), 'size': [W, H], 'frames': len(tl['frames']), 'shots': len(mids), 'code_lines': lines,
              'upload': f'{up.name} ({up.stat().st_size / 1e6:.0f} MB)', 'preview': f'{pv.name} ({pv.stat().st_size / 1e6:.0f} MB)', 'cover_luminance': round(first, 3),
              'mean_volume_db': float(mean_db.group(1)) if mean_db else None}
    (BUILD / 'package.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if first < 0.05:
        print('⚠ the first frame is nearly black — platforms use it as the thumbnail; give meta.cover a visible background')
    plat = meta.get('platform', 'x')
    lim = PLATFORM_LIMITS.get(plat)
    if lim and dur > lim:
        print(f'⚠ {dur:.0f}s exceeds the {plat} limit ({lim}s) — X needs Premium for anything over 2:20')
    log(f"打包完成：{dur:.0f} 秒，上传版 {up.stat().st_size / 1e6:.0f} MB，代码 {lines} 行，{len(mids)} 个镜头")


# ── geo ───────────────────────────────────────────────────────────────────────
def cmd_geo(film, args):
    import geo
    geo.build(film, P, download=args.download)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('cues')
    g = sub.add_parser('geo'); g.add_argument('--download', action='store_true')
    a = sub.add_parser('audio'); a.add_argument('--dry', action='store_true')
    sub.add_parser('score')
    i = sub.add_parser('index'); i.add_argument('--only', nargs='*'); i.add_argument('--qa', action='store_true')
    q = sub.add_parser('qa'); q.add_argument('--frames', action='store_true'); q.add_argument('--only', nargs='*')
    rd = sub.add_parser('render'); rd.add_argument('--only', nargs='*')
    sub.add_parser('package')
    lg = sub.add_parser('log'); lg.add_argument('message')
    args = ap.parse_args()
    if args.cmd == 'log':
        log(args.message); return
    film = load()
    {'cues': cmd_cues, 'geo': cmd_geo, 'audio': cmd_audio, 'score': cmd_score, 'index': cmd_index, 'qa': cmd_qa, 'render': cmd_render, 'package': cmd_package}[args.cmd](film, args)


if __name__ == '__main__':
    main()
