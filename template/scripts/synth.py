"""Score and ambience, synthesized with numpy only (no samples, no services).

Music: an additive string pad, a taiko-style low drum, a military snare and a sparse horn,
arranged from each shot's `music` mood. Ambience: filtered-noise beds and events (river,
rain, wind, fire, gunfire, footsteps …) from each shot's `ambience` tags. Both are ducked
under the narration and written as audio/score.wav and audio/ambience.wav.
"""
import json, wave
from pathlib import Path
import numpy as np

SR = 48000
NOTE = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}


def hz(n):
    name, octv = n[:-1], int(n[-1])
    return 440.0 * 2 ** ((NOTE[name] + 12 * (octv + 1) - 69) / 12)


CHORDS = {
    'Dm': ['D2', 'A2', 'D3', 'F3', 'A3'], 'Bb': ['Bb1', 'F2', 'Bb2', 'D3', 'F3'], 'Gm': ['G1', 'D2', 'G2', 'Bb2', 'D3'],
    'A': ['A1', 'E2', 'A2', 'C#3', 'E3'], 'F': ['F1', 'C2', 'F2', 'A2', 'C3'], 'C': ['C2', 'G2', 'C3', 'E3', 'G3'],
    'D': ['D2', 'A2', 'D3', 'F#3', 'A3'], 'Am': ['A1', 'E2', 'A2', 'C3', 'E3'], 'Em': ['E2', 'B2', 'E3', 'G3', 'B3'],
    'G': ['G1', 'D2', 'G2', 'B2', 'D3'], 'Cm': ['C2', 'G2', 'C3', 'Eb3', 'G3'], 'Eb': ['Eb2', 'Bb2', 'Eb3', 'G3', 'Bb3'],
}

# mood → (level, brightness, drums, default chords to cycle through, horn notes or None)
MOODS = {
    'silence': (0.0, 0.0, None, ['Dm'], None),
    'swell': (0.6, 0.3, None, ['Dm'], None),
    'calm': (0.55, 0.3, None, ['F', 'Bb'], None),
    'somber': (0.55, 0.25, None, ['Dm', 'Am'], None),
    'tension': (0.75, 0.45, 'pulse', ['Gm', 'Bb', 'A'], None),
    'march': (0.8, 0.45, 'march', ['Bb', 'Gm', 'Dm'], None),
    'battle': (1.0, 0.6, 'battle', ['Dm', 'Gm'], None),
    'reveal': (1.0, 0.55, 'hit', ['Dm', 'F'], None),
    'hope': (0.9, 0.58, 'hit', ['F', 'C'], ['C5', 'F5']),
    'triumph': (1.25, 0.8, 'battle', ['D'], ['D5', 'F#5', 'A5']),
    'resolve': (0.8, 0.45, 'hit', ['D'], ['A4', 'D5']),
}


class Synth:
    def __init__(self, seed=1934):
        self.rng = np.random.default_rng(seed)

    # ── music voices ──
    def adsr(self, n, a, r):
        env = np.ones(n)
        na, nr = min(int(a * SR), n), min(int(r * SR), n)
        if na: env[:na] = np.linspace(0, 1, na) ** 1.5
        if nr: env[-nr:] *= np.linspace(1, 0, nr) ** 1.2
        return env

    def string_voice(self, f, dur, bright):
        n = int(dur * SR); t = np.arange(n) / SR
        out = np.zeros(n)
        for det in (-0.07, 0.0, 0.06):
            ff = f * (1 + det / 100 * 1.2)
            vib = 1 + 0.0025 * np.sin(2 * np.pi * (4.8 + det) * t + det * 20)
            ph = 2 * np.pi * ff * np.cumsum(vib) / SR
            for h in range(1, int(6 + bright * 10) + 1):
                if ff * h > 9000: break
                out += np.sin(h * ph + self.rng.random() * 6.28) / h ** (1.25 - 0.35 * bright)
        return out / 3

    def pad(self, chord, dur, level, bright):
        x = sum(self.string_voice(hz(n), dur, bright) for n in CHORDS[chord])
        return x * self.adsr(len(x), min(1.2, dur * 0.4), min(1.4, dur * 0.4)) * level * 0.05

    def horn(self, notes, dur, level=1.0):
        n = int(dur * SR); t = np.arange(n) / SR; out = np.zeros(n)
        seg = dur / len(notes)
        for i, nn in enumerate(notes):
            a, b = int(i * seg * SR), int((i + 1) * seg * SR)
            tt = t[a:b] - t[a]
            out[a:b] += sum(np.sin(2 * np.pi * hz(nn) * h * tt) * (0.9 / h ** 1.1) for h in range(1, 9)) * self.adsr(b - a, 0.18, 0.35)
        return out * level * 0.06

    def taiko(self, level):
        n = int(1.2 * SR); t = np.arange(n) / SR
        body = np.sin(2 * np.pi * np.cumsum(42 + 58 * np.exp(-t * 18)) / SR) * np.exp(-t * 4.2)
        return (body + self.rng.standard_normal(n) * np.exp(-t * 60) * 0.25) * level

    def snare(self, level):
        n = int(0.35 * SR); t = np.arange(n) / SR
        noise = self.rng.standard_normal(n)
        noise = np.convolve(noise, np.ones(3) / 3, mode='same') - np.convolve(noise, np.ones(40) / 40, mode='same')
        return (noise * np.exp(-t * 16) * 0.6 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.5) * level

    def reverb(self, x, secs=2.2, mix=0.28):
        n = int(secs * SR); t = np.arange(n) / SR
        ir = self.rng.standard_normal(n) * np.exp(-t * 3.2)
        ir[: int(0.012 * SR)] = 0
        ir /= np.sqrt((ir ** 2).sum())
        nfft = 1 << (len(x) + n - 1).bit_length()
        wet = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[: len(x)]
        return x * (1 - mix) + wet * mix * 3.0

    # ── noise tools for ambience ──
    def noise(self, n, lo=None, hi=None):
        """White noise band-limited to [lo, hi] Hz via FFT masking."""
        x = self.rng.standard_normal(n)
        if lo is None and hi is None:
            return x
        X = np.fft.rfft(x); f = np.fft.rfftfreq(n, 1 / SR)
        mask = np.ones_like(f)
        if lo: mask *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
        if hi: mask *= 1 / (1 + (f / hi) ** 4)
        y = np.fft.irfft(X * mask, n)
        return y / (np.abs(y).max() + 1e-9)

    def lfo(self, n, rate, depth=0.5, phase=0.0):
        t = np.arange(n) / SR
        return 1 - depth + depth * (0.5 + 0.5 * np.sin(2 * np.pi * rate * t + phase))

    def bed(self, tag, dur):
        n = int(dur * SR)
        if n <= 0: return np.zeros(0)
        r = self.rng
        if tag == 'river':
            return self.noise(n, 120, 1800) * self.lfo(n, 0.13, 0.3) * 0.5
        if tag == 'rapids':
            return (self.noise(n, 90, 3500) * self.lfo(n, 0.21, 0.25) + self.noise(n, 30, 160) * 0.5) * 0.75
        if tag == 'lake':
            return self.noise(n, 200, 1200) * self.lfo(n, 0.08, 0.6) * 0.18
        if tag == 'sea':                         # open water: a slow swell washing past the hull + a low rumble
            wash = self.noise(n, 180, 2600) * (self.lfo(n, 0.17, 0.75) * self.lfo(n, 0.071, 0.5, 1.1)) ** 1.5
            return wash * 0.5 + self.noise(n, 30, 140) * self.lfo(n, 0.09, 0.5, 2.0) * 0.35
        if tag == 'surf':                        # waves breaking on a beach every few seconds
            t = np.arange(n) / SR
            env = np.clip(np.sin(2 * np.pi * t / 5.6 + 0.6) * 0.5 + np.sin(2 * np.pi * t / 8.9) * 0.5, 0, 1) ** 2
            return self.noise(n, 250, 4200) * (0.12 + env) * 0.55 + self.noise(n, 40, 200) * env * 0.4
        if tag in ('sails', 'creak'):            # timber and rope working: slow creaks over a little wind
            x = self.noise(n, 100, 600) * self.lfo(n, 0.13, 0.7) * 0.25
            for _ in range(max(1, int(dur / 1.6))):
                i = int(r.integers(0, max(1, n - 12000))); k = int(r.integers(5000, 12000)); tt = np.arange(k) / SR
                f0 = r.uniform(140, 260)
                seg = x[i:i + k]
                creak = np.sin(2 * np.pi * np.cumsum(f0 * (1 + 0.25 * np.sin(2 * np.pi * r.uniform(1.5, 4) * tt))) / SR) * (np.sin(2 * np.pi * r.uniform(22, 40) * tt) > 0.1)
                seg += (creak * np.sin(np.pi * tt / tt[-1]) ** 2 * r.uniform(0.15, 0.4))[: len(seg)]
            return x * 0.5
        if tag == 'rain':
            return self.noise(n, 1500, 9000) * 0.45 + self.noise(n, 300, 1200) * 0.2
        if tag == 'wind':
            return self.noise(n, 80, 700) * self.lfo(n, 0.11, 0.7) * self.lfo(n, 0.37, 0.4, 1.3) * 0.7
        if tag == 'blizzard':
            return (self.noise(n, 150, 1400) * self.lfo(n, 0.23, 0.7) + self.noise(n, 1800, 6000) * self.lfo(n, 0.31, 0.6, 2.0) * 0.3) * 0.9
        if tag == 'room':
            return self.noise(n, 40, 300) * 0.12
        if tag == 'night':                       # crickets: chirps of a high tone
            t = np.arange(n) / SR
            chirp = (np.sin(2 * np.pi * 4300 * t) * (np.sin(2 * np.pi * 38 * t) > 0.2) * (np.sin(2 * np.pi * 1.7 * t) > -0.2))
            return chirp * 0.06 + self.noise(n, 60, 400) * 0.1
        if tag == 'fire':                        # low roar + crackles
            x = self.noise(n, 60, 700) * self.lfo(n, 0.9, 0.35) * 0.5
            for _ in range(int(dur * 9)):
                i = r.integers(0, max(1, n - 400)); k = int(r.integers(60, 400))
                x[i:i + k] += r.standard_normal(k) * np.exp(-np.arange(k) / (k / 5)) * r.uniform(0.3, 1.0)
            return x * 0.6
        if tag == 'crowd':
            return self.noise(n, 250, 1100) * self.lfo(n, 2.3, 0.35) * self.lfo(n, 0.4, 0.4, 1.0) * 0.35
        if tag in ('march', 'footsteps'):        # soft thuds, slightly irregular
            x = np.zeros(n); step = int(0.27 * SR)
            for i in range(0, n - 2000, step):
                j = i + int(r.integers(0, 1800)); k = 1800
                x[j:j + k] += self.noise(k, 60, 500)[: len(x[j:j + k])] * np.exp(-np.arange(len(x[j:j + k])) / 300) * r.uniform(0.4, 0.9)
            return x * 0.5
        if tag in ('battle', 'gunfire'):         # scattered shots near and far, the odd deep thump
            x = np.zeros(n)
            for _ in range(int(dur * (9 if tag == 'battle' else 5))):
                i = int(r.integers(0, max(1, n - 6000))); k = int(r.integers(1500, 5000)); far = r.uniform(0.25, 1.0)
                seg = x[i:i + k]
                seg += self.noise(len(seg), 300 if far > 0.6 else 150, 5000 * far + 600) * np.exp(-np.arange(len(seg)) / (len(seg) / 6)) * far
            if tag == 'battle':
                for _ in range(max(1, int(dur / 2.2))):
                    x = self.add(x, self.boom(r.uniform(0.5, 0.9)), r.uniform(0, max(0.1, dur - 1.5)))
            return x * 0.55
        raise ValueError(f'unknown ambience tag: {tag}')

    def boom(self, level=1.0):
        n = int(1.8 * SR); t = np.arange(n) / SR
        return (np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t * 9)) / SR) * np.exp(-t * 3.2) + self.noise(n, 40, 900) * np.exp(-t * 5) * 0.8) * level

    @staticmethod
    def add(buf, x, at):
        i = int(at * SR)
        if i >= len(buf) or i < 0: return buf
        j = min(len(buf), i + len(x)); buf[i:j] += x[: j - i]
        return buf


def fade(x, a=0.35, r=0.5):
    n = len(x)
    na, nr = min(int(a * SR), n // 2), min(int(r * SR), n // 2)
    if na: x[:na] *= np.linspace(0, 1, na)
    if nr: x[-nr:] *= np.linspace(1, 0, nr)
    return x


def voice_envelope(P, tl):
    env = np.zeros(int(tl['total'] * SR) + SR)
    for fr in tl['frames']:
        if not fr.get('audio'): continue
        with wave.open(str(P / fr['audio'])) as w:
            sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        if sr != SR: x = np.interp(np.arange(0, len(x), sr / SR), np.arange(len(x)), x)
        win = int(0.05 * SR)
        e = (np.sqrt(np.convolve(x ** 2, np.ones(win) / win, mode='same')) > 0.02).astype(float)
        k = int(0.25 * SR); e = np.clip(np.convolve(e, np.ones(k) / k, mode='same') * 1.6, 0, 1)
        i = int(fr['start'] * SR); j = min(len(env), i + len(e)); env[i:j] = np.maximum(env[i:j], e[: j - i])
    return env


def write_wav(path, x, peak):
    m = np.abs(x).max()
    if m > 0: x = x / m * peak
    f = int(0.8 * SR)
    if len(x) > f: x[-f:] *= np.linspace(1, 0, f)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


AMBIENCE = ('river', 'rapids', 'lake', 'sea', 'surf', 'sails', 'creak', 'rain', 'wind', 'blizzard', 'room', 'night', 'fire', 'crowd', 'march', 'footsteps', 'battle', 'gunfire')


def render_film(film, tl, P):
    S = Synth(film['meta'].get('musicSeed', 1934))
    total = tl['total']
    N = int(total * SR) + SR
    pads, drums, sfx = np.zeros(N), np.zeros(N), np.zeros(N)
    cycle = {}
    n_music = n_sfx = 0
    for fr in tl['frames']:
        for mu in fr.get('music', []):
            a, b = fr['start'] + mu['start'], fr['start'] + mu['end']
            dur = b - a
            mood = mu.get('mood', 'calm')
            level, bright, drum, chords, horn = MOODS[mood]
            level, bright = mu.get('level', level), mu.get('bright', bright)
            drum = mu['drums'] if 'drums' in mu else drum
            horn = mu['horn'] if 'horn' in mu else horn
            i = cycle.get(mood, 0); cycle[mood] = i + 1
            chord = mu.get('chord', chords[i % len(chords)])
            if level > 0:
                S.add(pads, S.pad(chord, dur + 1.2, level, bright), a); n_music += 1
            if horn:
                S.add(pads, S.horn(horn, dur), a)
            if drum == 'pulse':
                for k in np.arange(a, b, 1.2): S.add(drums, S.taiko(0.5), k)
            elif drum == 'march':
                for j, k in enumerate(np.arange(a, b, 0.5)):
                    S.add(drums, S.snare(0.22 if j % 2 else 0.32), k)
                    if j % 4 == 0: S.add(drums, S.taiko(0.45), k)
            elif drum == 'battle':
                for j, k in enumerate(np.arange(a, b, 0.25)):
                    S.add(drums, S.snare(0.18 + 0.12 * (j % 2 == 0)), k)
                    if j % 4 == 0: S.add(drums, S.taiko(0.75), k)
            elif drum == 'hit':
                S.add(drums, S.taiko(1.0), a); S.add(drums, S.taiko(0.6), a + 0.18)
        for am in fr.get('ambience', []):
            a, b = fr['start'] + am['start'], fr['start'] + am['end']
            for tag in am.get('tags', []):
                S.add(sfx, fade(S.bed(tag, b - a + 0.3)) * am.get('level', 1.0), a); n_sfx += 1
            for ev in am.get('events', []):                   # {"at": seconds into the section, "type": "boom", "level": 1}
                S.add(sfx, S.boom(ev.get('level', 1.0)), a + float(ev.get('at', 0)))
    env = voice_envelope(P, tl)[:N]
    music = (S.reverb(pads, 2.6, 0.35) + S.reverb(drums, 1.4, 0.18))[: int(total * SR)]
    music *= 1 - (1 - 10 ** (-9 / 20)) * env[: len(music)]
    amb = S.reverb(sfx, 1.2, 0.15)[: int(total * SR)]
    amb *= 1 - (1 - 10 ** (-5 / 20)) * env[: len(amb)]
    (P / 'audio').mkdir(exist_ok=True)
    write_wav(P / 'audio' / 'score.wav', music, film['meta'].get('musicLevel', 0.62))
    if n_sfx:
        write_wav(P / 'audio' / 'ambience.wav', amb, film['meta'].get('ambienceLevel', 0.30))
    elif (P / 'audio' / 'ambience.wav').exists():
        (P / 'audio' / 'ambience.wav').unlink()
    return {'music': f'{n_music} sections → audio/score.wav', 'sfx': f'{n_sfx} beds → audio/ambience.wav' if n_sfx else 'none'}
