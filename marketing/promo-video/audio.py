"""Voiceover and sound effects for the promo, mixed onto the picture.

    python marketing/promo-video/audio.py

Reads promo-picture.mp4 (render.mjs makes it) and writes brightsmile-promo-9x16.mp4 with sound,
plus voiceover.wav and sfx.wav for anyone who wants to remix in an editor.

The voice is Kokoro (https://github.com/thewh1teagle/kokoro-onnx, Apache 2.0), run locally. It needs
`pip install kokoro-onnx==0.4.9 soundfile scipy` and the two model files from that project's
model-files-v1.0 release (kokoro-v1.0.onnx, voices-v1.0.bin) in KOKORO_DIR (default: ./models next to this file).
Sound effects are synthesised here, so there is nothing to license. ffmpeg must be on the PATH.

Cue times are seconds from the start and follow the data-a times in promo.html: move both together.
"""

import os
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve

HERE = Path(__file__).resolve().parent
SR = 48_000
DURATION = 40.0
rng = np.random.default_rng(7)  # fixed seed: the same noise, so the same mix, every run

# ---------------------------------------------------------------- voiceover

VOICE = "af_heart"  # warm, friendly American English. Kokoro's best-rated voice.
SPEED = 1.0

# (start, text). Each line lands inside its caption's time in promo.html.
LINES = [
    (0.20, "When was your last dental check-up?"),
    (3.35, "At Bright Smile in Makati, a healthy smile is easy."),
    (7.30, "Book online in a minute. No calls needed."),
    (11.30, "Pick a time, and we'll text to confirm your visit."),
    (15.75, "Gentle, friendly care for kids and adults,"),
    (19.65, "from cleaning and pasta, to braces and root canal."),
    (24.35, "Three clinics in Makati, open nine to five."),
    (28.20, "There's one near you."),
    (32.70, "Book your visit today, at brightsmile dot pro."),
    (36.20, "Your bright smile starts here."),
]

# The phonemizer reads these the American way; say them the way Makati does.
PRONOUNCE = {
    "mækˈɑːɾi": "məkˈɑːti",  # Makati with a real t, not "Mak-AH-dee"
    "bɹˈaɪtsmaɪl": "bɹˈaɪt smˈaɪl",  # the domain as two clear words
}


def voiceover() -> np.ndarray:
    from kokoro_onnx import Kokoro

    models = Path(os.environ.get("KOKORO_DIR", HERE / "models"))
    kokoro = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
    track = np.zeros(int(DURATION * SR), dtype=np.float32)
    for i, (start, text) in enumerate(LINES):
        phonemes = kokoro.tokenizer.phonemize(text, "en-us")
        for american, local in PRONOUNCE.items():
            phonemes = phonemes.replace(american, local)
        audio, sr = kokoro.create(phonemes, voice=VOICE, speed=SPEED, is_phonemes=True)
        audio = resample(audio, sr, SR)
        end = start + len(audio) / SR
        next_start = LINES[i + 1][0] if i + 1 < len(LINES) else DURATION
        assert end <= next_start, f'"{text}" runs to {end:.2f}s, past the next line at {next_start}s'
        a = int(start * SR)
        track[a : a + len(audio)] += audio
        print(f"  {start:5.2f}-{end:5.2f}s  {text}")
    return track


def resample(audio: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst:
        return audio.astype(np.float32)
    from scipy.signal import resample_poly

    g = np.gcd(src, dst)
    return resample_poly(audio, dst // g, src // g).astype(np.float32)


# ---------------------------------------------------------------- sound effects


def t(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR)) / SR


def env(n: int, attack: float, decay: float) -> np.ndarray:
    """Quick attack, exponential decay (decay = time constant in seconds)."""
    x = np.arange(n) / SR
    return np.minimum(1, x / max(attack, 1e-4)) * np.exp(-x / decay)


def tone(freq_from: float, freq_to: float, seconds: float, glide: float) -> np.ndarray:
    """A sine whose pitch glides exponentially from freq_from to freq_to over `glide` seconds."""
    x = t(seconds)
    freq = freq_to + (freq_from - freq_to) * np.exp(-x / glide)
    return np.sin(2 * np.pi * np.cumsum(freq) / SR)


def svf_bandpass(signal: np.ndarray, centre: np.ndarray, q: float) -> np.ndarray:
    """State-variable band-pass with a moving centre frequency, for whooshes."""
    out = np.empty_like(signal)
    low = band = 0.0
    damp = 1 / q
    for i, s in enumerate(signal):
        f = 2 * np.sin(np.pi * min(centre[i], SR / 6) / SR)
        high = s - low - damp * band
        band += f * high
        low += f * band
        out[i] = band
    return out


def pop(pitch: float = 520) -> np.ndarray:
    """Soft bubbly pop for things that scale in."""
    n = int(0.12 * SR)
    body = tone(pitch * 1.9, pitch, 0.12, 0.018) * env(n, 0.002, 0.035)
    click = rng.standard_normal(n) * env(n, 0.0005, 0.003) * 0.15
    return (body + click) * 0.7


def tap() -> np.ndarray:
    """Glassy screen tap."""
    n = int(0.06 * SR)
    return (np.sin(2 * np.pi * 2400 * t(0.06)) * env(n, 0.0005, 0.008) * 0.5
            + rng.standard_normal(n) * env(n, 0.0003, 0.002) * 0.25)


def chime(notes: list[tuple[float, float]], decay: float = 0.45, level: float = 0.35) -> np.ndarray:
    """Bell notes (offset, frequency) with a few inharmonic partials."""
    length = max(o for o, _ in notes) + decay * 5
    out = np.zeros(int(length * SR))
    for offset, f in notes:
        n = int(decay * 5 * SR)
        x = t(decay * 5)
        bell = sum(a * np.sin(2 * np.pi * f * m * x) * np.exp(-x / (decay / m ** 0.7))
                   for m, a in [(1, 1.0), (2.01, 0.35), (3.02, 0.12), (4.17, 0.06)])
        a = int(offset * SR)
        out[a : a + n] += bell * env(n, 0.002, 1e9)
    return out * level


def sparkle(seconds: float = 0.6, count: int = 9, level: float = 0.12) -> np.ndarray:
    """A shimmer of tiny high plinks."""
    out = np.zeros(int((seconds + 0.4) * SR))
    for k in range(count):
        offset = seconds * k / count + rng.uniform(0, 0.03)
        f = rng.uniform(2600, 5200)
        n = int(0.35 * SR)
        a = int(offset * SR)
        out[a : a + n] += np.sin(2 * np.pi * f * t(0.35)) * env(n, 0.001, 0.06) * (1 - 0.5 * k / count)
    return out * level


def whoosh(seconds: float = 0.55, f_from: float = 300, f_to: float = 3200, level: float = 0.5) -> np.ndarray:
    """Air moving past: noise through a sweeping band-pass, swelling then fading."""
    n = int(seconds * SR)
    x = np.linspace(0, 1, n)
    centre = f_from * (f_to / f_from) ** x
    shape = np.sin(np.pi * x) ** 1.6
    return svf_bandpass(rng.standard_normal(n) * 0.6, centre, 1.4) * shape * level


def drop() -> np.ndarray:
    """Water-drop "plip" for a map pin landing."""
    n = int(0.14 * SR)
    return tone(1100, 420, 0.14, 0.025) * env(n, 0.001, 0.03) * 0.55


def tick() -> np.ndarray:
    n = int(0.03 * SR)
    return np.sin(2 * np.pi * 3200 * t(0.03)) * env(n, 0.0003, 0.004) * 0.35


def swell(seconds: float = 0.7) -> np.ndarray:
    """Rising airy swell into the URL reveal."""
    n = int(seconds * SR)
    x = np.linspace(0, 1, n)
    noise = svf_bandpass(rng.standard_normal(n) * 0.5, 800 * 6 ** x, 2.0)
    return noise * x ** 2.5 * 0.35


# (time, sound, pan -1 left .. 1 right). Times match the visuals in promo.html.
def cues():
    c = []
    # Scene 1, the hook: soft ticks as the words land, a bouncy pop for the "?"
    for i, s in enumerate([0.05, 0.2, 0.35, 0.5, 0.75, 0.9]):
        c.append((s + 0.12, pop(700 + 60 * i) * 0.45, -0.3 + 0.12 * i))
    c.append((1.33, pop(380) * 1.1, 0.2))
    c.append((2.75, whoosh(0.55, 2600, 250, 0.55), 0))  # iris closes to a dot
    # Scene 2, brand: the emblem pops out of the dot, sparkles twinkle
    c.append((3.2, pop(300) * 1.1, 0))
    c.append((3.3, sparkle(0.7), 0.2))
    c.append((3.85, chime([(0, 2637)], 0.25, 0.08), -0.4))
    c.append((4.35, chime([(0, 3136)], 0.25, 0.08), 0.4))
    c.append((6.85, whoosh(0.5, 400, 3000, 0.45), 0))  # brand slides up and away
    # Scene 3, booking
    c.append((7.55, whoosh(0.8, 200, 1400, 0.35), 0))  # phone rises
    for k, s in enumerate([8.3, 8.4, 8.5, 8.6, 8.7, 8.8]):
        c.append((s + 0.03, tick() * 0.6, -0.2 + 0.08 * k))
    c.append((9.70, tap(), 0.25))  # picks 10:30 AM
    c.append((10.62, tap(), -0.05))  # presses Book my visit
    c.append((11.55, chime([(0, 1318.5), (0.13, 1975.5)], 0.3, 0.22), 0.1))  # text arrives
    c.append((12.12, chime([(0, 1046.5), (0.09, 1318.5), (0.18, 1568)], 0.4, 0.26), 0.35))  # confirmed
    c.append((15.15, whoosh(0.5, 500, 3500, 0.45), 0))
    # Scene 4, family care: badges, then chips in two rising waves
    c.append((16.65, pop(440), -0.3))
    c.append((16.85, pop(520), 0.3))
    for k, s in enumerate([17.6, 17.85, 18.1]):
        c.append((s + 0.08, pop(560 + 70 * k), -0.4 + 0.4 * k))
    for k, s in enumerate([19.8, 20.05, 20.3]):
        c.append((s + 0.08, pop(700 + 80 * k), -0.4 + 0.4 * k))
    c.append((21.0, sparkle(0.5, 6, 0.07), 0))
    # Scene 5, map: a sideways wipe, pins drop in, the clock spins
    c.append((23.7, whoosh(0.65, 250, 4000, 0.5), 0))
    c.append((24.95, pop(330), 0))
    for k, (s, pan) in enumerate([(25.6, -0.3), (26.1, -0.5), (26.6, 0.6)]):
        c.append((s + 0.36, drop(), pan))
    c.append((27.85, pop(480), 0.2))
    for k in range(4):
        c.append((27.95 + 0.11 * k, tick() * 0.7, 0.2))
    c.append((31.95, whoosh(0.7, 200, 2400, 0.5), 0))
    # Scene 6, call to action
    c.append((32.45, pop(300) * 1.1, 0))
    c.append((33.0, swell(0.65), 0))
    c.append((33.68, pop(420), 0))
    c.append((33.7, sparkle(0.6, 8, 0.1), 0.1))
    c.append((34.68, pop(520), 0))
    c.append((36.25, chime([(0, 1046.5), (0.12, 1318.5), (0.24, 1568), (0.36, 2093)], 0.55, 0.22), 0))
    c.append((36.3, sparkle(1.0, 12, 0.1), 0))
    return c


def sfx() -> np.ndarray:
    track = np.zeros((int(DURATION * SR), 2), dtype=np.float64)
    for start, sound, pan in cues():
        a = int(start * SR)
        sound = sound[: len(track) - a]
        left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)  # equal-power pan
        track[a : a + len(sound), 0] += sound * left
        track[a : a + len(sound), 1] += sound * right
    # A short airy room so the effects sit together instead of feeling pasted on.
    n = int(0.6 * SR)
    ir = rng.standard_normal((n, 2)) * np.exp(-np.arange(n) / (0.12 * SR))[:, None]
    ir /= np.abs(ir).sum(axis=0) / 6
    wet = np.stack([fftconvolve(track[:, ch], ir[:, ch])[: len(track)] for ch in range(2)], axis=1)
    return (track + 0.18 * wet).astype(np.float32)


# ---------------------------------------------------------------- mix


def main() -> None:
    picture = HERE / "promo-picture.mp4"
    out = HERE / "brightsmile-promo-9x16.mp4"
    print("Voiceover")
    sf.write(HERE / "voiceover.wav", voiceover(), SR, subtype="PCM_24")
    print("Sound effects")
    sf.write(HERE / "sfx.wav", sfx(), SR, subtype="PCM_24")
    # Voice: clean the low end, add presence, even it out. Effects sit under it and duck while she speaks.
    graph = (
        "[1:a]highpass=f=90,equalizer=f=3500:t=q:w=1.2:g=2.5,"
        "acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2,aformat=channel_layouts=stereo,asplit=2[vo][key];"
        "[2:a]volume=-3dB[fx];"
        "[fx][key]sidechaincompress=threshold=0.05:ratio=3:attack=10:release=250[fxd];"
        "[vo][fxd]amix=inputs=2:duration=first:normalize=0,"
        "loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[a]"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(picture), "-i", str(HERE / "voiceover.wav"), "-i", str(HERE / "sfx.wav"),
         "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-t", str(DURATION), "-movflags", "+faststart", str(out)],
        check=True,
    )
    print(out)


if __name__ == "__main__":
    main()
