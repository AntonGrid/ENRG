#!/usr/bin/env python3
"""
ENRG pitch video renderer (Colosseum submission).

Pipeline: piper TTS (per beat) -> measured timings -> ImageMagick scene
backgrounds -> ffmpeg scene videos (drawtext synced to the voice-over) ->
concat with fades -> quiet ambient bed -> demo/pitch-video/ENRG_pitch.mp4

Tool paths come from the environment (see build.sh / README.md):
  PIPER_BIN, PIPER_VOICE, FONTS_DIR, FFMPEG, FFPROBE, CONVERT
"""
import json
import os
import re
import shlex
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
BEATS = os.path.join(HERE, "beats.json")

FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "ffprobe")
CONVERT = os.environ.get("CONVERT", "convert")
PIPER = os.environ.get("PIPER_BIN", "/tmp/piper/piper/piper")
VOICE = os.environ.get("PIPER_VOICE", "/tmp/assets/en_US-ryan-high.onnx")
FONTS = os.environ.get("FONTS_DIR", "/tmp/assets")
WORK = os.environ.get("PITCH_WORK", "/tmp/pitch-work")

META = json.load(open(BEATS, encoding="utf-8"))["meta"]
SCENES = json.load(open(BEATS, encoding="utf-8"))["scenes"]

W, H, FPS = META["width"], META["height"], META["fps"]
BG, ACCENT, FG = META["bg"], META["accent"], META["fg"]
MUTED, DANGER, SUCCESS, GRID = META["muted"], META["danger"], META["success"], META["grid"]

F_HEAD = os.path.join(FONTS, "SpaceGrotesk-700.ttf")
F_BODY = os.path.join(FONTS, "SpaceGrotesk-500.ttf")
F_MONO = os.path.join(FONTS, "JetBrainsMono-400.ttf")
LOGO = os.path.join(FONTS, "logo_enrg.png")

MARGIN = 140
BULLET_Y = 600
BAR_Y = H - 8


def run(cmd, **kw):
    """Run a shell command, raising with the tail of its output on failure."""
    p = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, **kw)
    if p.returncode != 0:
        tail = (p.stderr or p.stdout or "").strip().splitlines()[-12:]
        raise RuntimeError(f"command failed ({p.returncode}): {cmd}\n" + "\n".join(tail))
    return p.stdout


def dur(path):
    return float(run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                      "-of", "csv=p=0", path]).strip())


def write(path, text):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text if text.endswith("\n") else text + "\n")
    return path


# ── 1. voice-over ────────────────────────────────────────────────────────────
def synthesize(scene):
    """One piper run per scene -> one wav per beat (keeps model loads cheap)."""
    lines = [b["vo"] for b in scene["beats"]]
    txt = write(os.path.join(WORK, f'{scene["id"]}.txt'), "\n".join(lines))
    outdir = os.path.join(WORK, f'tts-{scene["id"]}')
    shutil.rmtree(outdir, ignore_errors=True)
    os.makedirs(outdir, exist_ok=True)
    cmd = (f'{shlex.quote(PIPER)} --model {shlex.quote(VOICE)} '
           f'--output_dir {shlex.quote(outdir)} '
           f'--length_scale {META["length_scale"]} < {shlex.quote(txt)}')
    print(f'  · tts {scene["id"]}: {len(lines)} lines')
    run(cmd)
    wavs = sorted(os.path.join(outdir, f) for f in os.listdir(outdir) if f.endswith(".wav"))
    if len(wavs) != len(lines):
        raise RuntimeError(f'{scene["id"]}: piper produced {len(wavs)} files for {len(lines)} lines')
    beats = []
    for beat, wav in zip(scene["beats"], wavs):
        b = dict(beat)
        b["wav"], b["dur"] = wav, dur(wav)
        beats.append(b)
    return beats


def schedule(beats, min_duration):
    """Sequential beats with a small gap; the scene holds at least min_duration."""
    t = 0.0
    for b in beats:
        b["start"] = round(t, 3)
        t += b["dur"] + META["beat_gap"]
    content_end = t - META["beat_gap"]
    total = max(min_duration, content_end + META["scene_pad"])
    return beats, round(total, 3)


def scene_audio(scene_id, beats, total):
    """Concatenate the beat wavs with gaps, padded with silence to `total`."""
    out = os.path.join(WORK, f'audio-{scene_id}.wav')
    inputs, chain = [], []
    idx = 0
    for n, b in enumerate(beats):
        inputs += ["-i", b["wav"]]
        chain.append(f'[{idx}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono[b{n}]')
        idx += 1
        silence = b["dur"] + META["beat_gap"] if n < len(beats) - 1 else b["dur"]
        gap = META["beat_gap"] if n < len(beats) - 1 else 0.0
        inputs += ["-f", "lavfi", "-t", f"{gap:.3f}", "-i", "anullsrc=r=48000:cl=mono"]
        chain.append(f'[{idx}:a]aformat=sample_fmts=s16:channel_layouts=mono[g{n}]')
        idx += 1
    used = sum(b["dur"] for b in beats) + META["beat_gap"] * (len(beats) - 1)
    inputs += ["-f", "lavfi", "-t", f"{max(0.1, total - used):.3f}", "-i", "anullsrc=r=48000:cl=mono"]
    chain.append(f'[{idx}:a]aformat=sample_fmts=s16:channel_layouts=mono[tail]')
    parts = []
    for n in range(len(beats)):
        parts += [f'[b{n}]', f'[g{n}]']
    parts.append("[tail]")
    chain.append("".join(parts) + f'concat=n={len(parts)}:v=0:a=1,atrim=0:{total:.3f}[a]')
    run([FFMPEG, "-y", "-v", "error", *inputs,
         "-filter_complex", ";".join(chain), "-map", "[a]",
         "-c:a", "pcm_s16le", "-ar", "48000", out])
    return out, used


def txtfile(name, text):
    return write(os.path.join(WORK, "txt", f"{name}.txt"), text)


def grid_and_chrome(scene, total):
    """Base 1920x1080 canvas: dark bg, grid, logo, wordmark, scene label."""
    lines = []
    for x in range(120, W, 120):
        lines.append(f'-draw "line {x},0 {x},{H}"')
    for y in range(120, H, 120):
        lines.append(f'-draw "line 0,{y} {W},{y}"')
    base = os.path.join(WORK, f'bg-{scene["id"]}.png')
    cmd = (
        f'{CONVERT} -size {W}x{H} xc:"{BG}" '
        + " ".join(f'-stroke "{GRID}" -strokewidth 1 -fill none {l}' for l in lines)
        + f' -stroke none -fill "{ACCENT}" -draw "rectangle 0,0 8,{H}"'
    )
    run(cmd + f' "{base}"')
    # logo + wordmark (top-left), scene label (top-right), via a second pass
    cmd2 = (
        f'{CONVERT} "{base}" '
        f'"{LOGO}" -geometry 76x76+84+58 -composite '
        f'-font "{F_HEAD}" -pointsize 46 -fill "{FG}" -annotate +184+104 "ENRG" '
        f'-font "{F_MONO}" -pointsize 22 -fill "{MUTED}" -annotate +186+136 "axis protocol  ·  trust layer" '
        f'-font "{F_MONO}" -pointsize 26 -fill "{MUTED}" -gravity NorthEast -annotate +84+78 "{scene["label"].split("   ")[0]}" '
        f'-font "{F_MONO}" -pointsize 24 -fill "{MUTED}" -gravity NorthWest -annotate +186+{H - 96 - 0} " " '
    )
    run(cmd2 + f' "{base}"')
    return base


def decorate_portrait(bg):
    card = f'-stroke "{ACCENT}" -strokewidth 2 -fill none -draw "roundrectangle 1200,320 1800,860 24,24"'
    txt = (
        f'-font "{F_HEAD}" -pointsize 150 -fill "{ACCENT}" -gravity NorthWest -annotate +1330+430 "AG" '
        f'-font "{F_MONO}" -pointsize 24 -fill "{FG}"  -annotate +1300+668 "FOUNDER  ·  PROTOCOL ARCHITECT" '
        f'-font "{F_MONO}" -pointsize 24 -fill "{MUTED}" -annotate +1300+712 "Vladimir, Russia" '
        f'-font "{F_MONO}" -pointsize 24 -fill "{MUTED}" -annotate +1300+756 "oil field  ·  rotations"'
    )
    run(f'{CONVERT} "{bg}" {card} {txt} "{bg}"')


def decorate_table(bg):
    """A mock spreadsheet with one edited cell - the visual of the problem."""
    rows = [("2026-03  Solar Array A", "12 400 kWh", "verified"),
            ("2026-03  Solar Array B", "8 150 kWh", "verified"),
            ("2026-04  Solar Array A", "41 900 kWh", "EDITED", True),
            ("2026-04  Solar Array B", "9 020 kWh", "verified"),
            ("2026-04  Wind Park C", "22 780 kWh", "verified")]
    panel = f'-stroke "{GRID}" -strokewidth 2 -fill none -draw "roundrectangle 1120,380 1840,900 18,18"'
    txt = (f'-font "{F_MONO}" -pointsize 26 -fill "{MUTED}" -gravity NorthWest '
           f'-annotate +1160+420 "utility portal export  ·  editable"')
    run(f'{CONVERT} "{bg}" {panel} {txt} "{bg}"')
    y = 480
    for row in rows:
        name, val, state = row[0], row[1], row[2]
        edited = len(row) > 3
        colour = DANGER if edited else MUTED
        seg = (f'-font "{F_MONO}" -pointsize 25 -fill "{MUTED}" -gravity NorthWest -annotate +1160+{y} "{name}" '
               f'-font "{F_MONO}" -pointsize 25 -fill "{colour}" -annotate +1560+{y} "{val}" ')
        if edited:
            seg += (f'-stroke "{DANGER}" -strokewidth 3 -draw "line 1540,{y + 16} 1810,{y + 16}" '
                    f'-stroke none')
        run(f'{CONVERT} "{bg}" {seg} "{bg}"')
        y += 82


PIPELINE = {"x": 140, "y": 926, "w": 300, "h": 78, "gap": 62,
            "labels": ["SE050 DEVICE", "PROOF", "ORACLE QUORUM", "ATTESTATION", "MINT"]}


def decorate_pipeline(bg):
    """DEVICE -> PROOF -> ORACLE QUORUM -> ATTESTATION -> MINT (muted boxes)."""
    for i, label in enumerate(PIPELINE["labels"]):
        x0 = PIPELINE["x"] + i * (PIPELINE["w"] + PIPELINE["gap"])
        y = PIPELINE["y"]
        run(f'{CONVERT} "{bg}" -stroke "{GRID}" -strokewidth 2 -fill "none" '
            f'-draw "roundrectangle {x0},{y} {x0 + PIPELINE["w"]},{y + PIPELINE["h"]} 12,12" '
            f'"{bg}"')
        if i < len(PIPELINE["labels"]) - 1:
            ax = x0 + PIPELINE["w"] + 16
            run(f'{CONVERT} "{bg}" -fill "{GRID}" -stroke none '
                f'-draw "polygon {ax},{y + 30} {ax + 26},{y + 39} {ax},{y + 48}" "{bg}"')


def pipeline_stage(i, start):
    """Accent border + accent label for the pipeline box that the voice is on."""
    x0 = PIPELINE["x"] + i * (PIPELINE["w"] + PIPELINE["gap"])
    y = PIPELINE["y"]
    box = (f"drawbox=x={x0}:y={y}:w={PIPELINE['w']}:h={PIPELINE['h']}:"
           f"color={ACCENT}@0.9:t=3:enable='gte(t\\,{start})'")
    label = dt(txtfile(f'stage-{i}', PIPELINE["labels"][i]), F_MONO, 24, ACCENT,
               x0 + 22, y + 28, start, fade=0.3)
    return [box, label]


def decorate_timeline(bg):
    run(f'{CONVERT} "{bg}" -stroke "{GRID}" -strokewidth 3 -draw "line 160,1000 1760,1000" '
        f'-fill "{ACCENT}" -stroke none -draw "circle 1760,1000 1760,1012" "{bg}"')
    for i, label in enumerate(["day 0", "month 1", "month 2", "month 4  ·  today"]):
        cx = 160 + (int((1760 - 160) * i / 3))
        r = 10 if i == 3 else 7
        colour = ACCENT if i == 3 else MUTED
        run(f'{CONVERT} "{bg}" -fill "{colour}" -stroke none -draw "circle {cx},1000 {cx},{1000 + r}" '
            f'-font "{F_MONO}" -pointsize 24 -fill "{MUTED}" -gravity NorthWest '
            f'-annotate +{cx - 20}+1030 "{label}" "{bg}"')


def decorate_contact(bg):
    run(f'{CONVERT} "{bg}" -font "{F_MONO}" -pointsize 30 -fill "{FG}" -gravity NorthWest '
        f'-annotate +140+970 "github.com/AntonGrid/ENRG" '
        f'-font "{F_MONO}" -pointsize 28 -fill "{MUTED}" -annotate +140+1014 "enrg.network   ·   x.com/enrg_protocol" '
        f'"{bg}"')


def background(scene, total):
    bg = grid_and_chrome(scene, total)
    kind = scene.get("decoration")
    if kind == "portrait":
        decorate_portrait(bg)
    elif kind == "table":
        decorate_table(bg)
    elif kind == "pipeline":
        decorate_pipeline(bg)
    elif kind == "timeline":
        decorate_timeline(bg)
    elif kind == "contact":
        decorate_contact(bg)
    return bg


def dt(text_path, font, size, colour, x, y, start, fade=0.35, line_spacing=8):
    alpha = f"if(lt(t\\,{start})\\,0\\,if(lt(t\\,{start + fade})\\,(t-{start})/{fade}\\,1))"
    return (f"drawtext=fontfile={font}:textfile={text_path}:expansion=none:fontsize={size}:"
            f"fontcolor={colour}:x={x}:y={y}:line_spacing={line_spacing}:alpha='{alpha}'")


def bullet_marker(x, y, start, colour):
    return (f"drawbox=x={x}:y={y}:w=16:h=16:color={colour}@0.95:t=fill:"
            f"enable='gte(t\\,{start})'")


def progress_bar(total, colour):
    """Forty segments - avoids relying on per-frame expressions in drawbox."""
    segs = []
    n = 40
    for i in range(n):
        w = W / n
        segs.append(f"drawbox=x={int(i * w)}:y={BAR_Y}:w={int(w) + 1}:h=6:color={colour}@0.85:t=fill:"
                    f"enable='gte(t\\,{total * i / n:.3f})'")
    return segs


def build_scene(scene, beats, total, bg, audio):
    """Static background + drawtext layers whose alpha follows the voice-over."""
    parts = [f"fade=t=in:st=0:d={META['fade']}", f"fade=t=out:st={total - META['fade']:.2f}:d={META['fade']}"]
    # kicker + headline
    parts.append(dt(txtfile(f'{scene["id"]}-kicker', scene["kicker"]), F_MONO, 30, ACCENT, MARGIN, 236, 0.15))
    parts.append(dt(txtfile(f'{scene["id"]}-headline', scene["headline"]), F_HEAD, 74, FG, MARGIN, 290, 0.35, line_spacing=14))
    # bullets, one per beat, stacked and kept on screen
    many = len(beats) > 4
    size, step = (34, 62) if many else (40, 74)
    bullet_y = 528 if scene.get("decoration") == "pipeline" else BULLET_Y
    for i, b in enumerate(beats):
        if not b.get("bullet"):
            continue
        y = bullet_y + i * step
        path = txtfile(f'{scene["id"]}-b{i}', b["bullet"])
        if b.get("kind") == "accent":
            colour = ACCENT
        elif b.get("kind") == "danger":
            colour = DANGER
        elif b.get("kind") == "number":
            colour = MUTED
        else:
            colour = MUTED
        start = b["start"] + 0.12
        parts.append(bullet_marker(MARGIN, y + int(size * 0.34), start,
                                   ACCENT if b.get("kind") in ("accent", "number") else GRID))
        parts.append(dt(path, F_BODY, size, colour, MARGIN + 40, y, start))
        if b.get("bignum"):
            parts.append(dt(txtfile(f'{scene["id"]}-big{i}', b["bignum"]), F_MONO, 116, ACCENT,
                            1290, 240 + i * 142, start, fade=0.45))
    # pipeline stages light up one by one as the voice walks through them
    for b in beats:
        if "stage" in b:
            parts += pipeline_stage(b["stage"], b["start"] + 0.2)
    # the GREENWASHING stamp
    for i, b in enumerate(beats):
        if b.get("stamp"):
            s = b["start"] + 0.2
            parts.append(f"drawbox=x=1120:y=790:w=720:h=96:color={DANGER}@0.14:t=fill:enable='gte(t\\,{s})'")
            parts.append(f"drawbox=x=1120:y=790:w=720:h=96:color={DANGER}@0.85:t=3:enable='gte(t\\,{s})'")
            parts.append(dt(txtfile(f'{scene["id"]}-stamp', b["stamp"]), F_HEAD, 56, DANGER, 1176, 806, s, fade=0.3))
    parts += progress_bar(total, ACCENT)
    graph = ",".join(parts) + ",format=yuv420p"
    out = os.path.join(WORK, f'scene-{scene["id"]}.mp4')
    run([FFMPEG, "-y", "-v", "error", "-loop", "1", "-framerate", str(FPS), "-i", bg, "-i", audio,
         "-filter_complex", f"[0:v]{graph}[v]", "-map", "[v]", "-map", "1:a",
         "-t", f"{total:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out])
    return out


def endcard(scene_count):
    """Closing card: logo, tagline, repository."""
    png = os.path.join(WORK, "bg-end.png")
    lines = " ".join(f'-stroke "{GRID}" -strokewidth 1 -fill none -draw "line {x},0 {x},{H}"'
                     for x in range(120, W, 120))
    hlines = " ".join(f'-stroke "{GRID}" -strokewidth 1 -fill none -draw "line 0,{y} {W},{y}"'
                      for y in range(120, H, 120))
    run(f'{CONVERT} -size {W}x{H} xc:"{BG}" {lines} {hlines} '
        f'-fill "{ACCENT}" -stroke none -draw "rectangle 0,0 8,{H}" '
        f'"{png}"')
    run(f'{CONVERT} "{png}" "{LOGO}" -geometry 190x190+865+224 -composite '
        f'-font "{F_HEAD}" -pointsize 96 -fill "{FG}" -gravity North -annotate +0+470 "ENRG" '
        f'-font "{F_BODY}" -pointsize 40 -fill "{MUTED}" -gravity North -annotate +0+600 "Verification infrastructure for the physical world" '
        f'-font "{F_MONO}" -pointsize 30 -fill "{ACCENT}" -gravity North -annotate +0+690 "github.com/AntonGrid/ENRG" '
        f'-font "{F_MONO}" -pointsize 26 -fill "{MUTED}" -gravity North -annotate +0+745 "devnet HkuC3FT…  ·  55 instructions  ·  266 tests" '
        f'"{png}"')
    total = META["endcard"]
    out = os.path.join(WORK, "scene-end.mp4")
    run([FFMPEG, "-y", "-v", "error", "-loop", "1", "-framerate", str(FPS), "-i", png,
         "-f", "lavfi", "-t", str(total), "-i", "anullsrc=r=48000:cl=mono",
         "-filter_complex",
         f"[0:v]fade=t=in:st=0:d=0.6,fade=t=out:st={total - 0.6:.2f}:d=0.6,format=yuv420p[v]",
         "-map", "[v]", "-map", "1:a", "-t", str(total), "-c:v", "libx264", "-preset", "medium",
         "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "192k",
         "-ar", "48000", out])
    return out


def add_numbers_footer(bg):
    run(f'{CONVERT} "{bg}" -font "{F_MONO}" -pointsize 22 -fill "{MUTED}" -gravity NorthWest '
        f'-annotate +140+1008 "mint 2ANc1Lf3az4utCDRw9A7Lfp7z2e7oY2kseJoW6k6U9gcq9uCbTMR1gLRY4M8Ctb7hJfQMm3iuHYHacPQRQiXGKT6" '
        f'-annotate +140+1040 "slot 500485022  ·  devnet  ·  verified 2026-09-18" "{bg}"')


def assemble(scene_files, out_path):
    """Concat the scenes (video+audio), then mix a quiet ambient bed under the voice."""
    listing = write(os.path.join(WORK, "concat.txt"),
                    "\n".join(f"file '{f}'" for f in scene_files))
    concat = os.path.join(WORK, "concat.mp4")
    run([FFMPEG, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listing,
         "-c", "copy", concat])
    total = dur(concat)
    bed = os.path.join(WORK, "bed.m4a")
    run([FFMPEG, "-y", "-v", "error",
         "-f", "lavfi", "-t", f"{total:.3f}", "-i", "sine=frequency=55:sample_rate=48000",
         "-f", "lavfi", "-t", f"{total:.3f}", "-i", "sine=frequency=82.5:sample_rate=48000",
         "-filter_complex",
         "[0:a]volume=0.6[a0];[1:a]volume=0.35[a1];"
         "[a0][a1]amix=inputs=2:duration=longest:normalize=0,"
         "tremolo=f=0.12:d=0.5,lowpass=f=260,volume=0.06,"
         f"afade=t=in:st=0:d=2,afade=t=out:st={total - 3:.3f}:d=3[a]",
         "-map", "[a]", "-c:a", "aac", "-b:a", "160k", bed])
    run([FFMPEG, "-y", "-v", "error", "-i", concat, "-i", bed,
         "-filter_complex",
         "[0:a]volume=1.0[vo];[1:a]volume=0.9[bed];"
         "[vo][bed]amix=inputs=2:duration=first:normalize=0,"
         # -16 LUFS with a -1.5 dBTP ceiling: broadcast-safe headroom and no
         # clipping where the voice and the bed overlap; stereo for players and
         # editors that expect two channels.
         "loudnorm=I=-16:TP=-1.5:LRA=11,aformat=channel_layouts=stereo[a]",
         "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-ar", "48000", "-movflags", "+faststart", out_path])
    return total


def qa(path, marks):
    print("\n== output ==")
    print(run([FFPROBE, "-v", "error", "-show_entries",
               "format=duration,size,bit_rate:stream=index,codec_name,width,height,r_frame_rate,channels",
               "-of", "default=noprint_wrappers=1", path]).strip())
    vol = run([FFMPEG, "-v", "info", "-i", path, "-af", "volumedetect", "-f", "null", "-"]).splitlines()
    for line in vol:
        if "mean_volume" in line or "max_volume" in line:
            print("  " + line.split("] ")[-1])
    qa_dir = os.path.join(WORK, "qa")
    os.makedirs(qa_dir, exist_ok=True)
    for label, t in marks:
        frame = os.path.join(qa_dir, f"{label}.png")
        run([FFMPEG, "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1", frame])
        print(f"  frame {label} @{t:.1f}s -> {frame}")


def main():
    os.makedirs(os.path.join(WORK, "txt"), exist_ok=True)
    for tool in (PIPER, VOICE, F_HEAD, F_BODY, F_MONO):
        if not os.path.exists(tool):
            sys.exit(f"missing required asset: {tool}")
    for tool in (FFMPEG, FFPROBE, CONVERT):
        if not shutil.which(tool) and not os.path.exists(tool):
            sys.exit(f"missing required tool: {tool}")

    # `render.py s1 s3` renders single scenes (for iteration) and stops before
    # assembly; `render.py --assemble-only` only re-cuts the final film from the
    # scene files already in the work directory; a bare `render.py` builds
    # everything.
    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    if "--assemble-only" in sys.argv:
        files = [os.path.join(WORK, f'scene-{s["id"]}.mp4') for s in SCENES]
        end = os.path.join(WORK, "scene-end.mp4")
        if not os.path.exists(end):
            end = endcard(len(SCENES))
        total = assemble(files + [end], os.path.join(HERE, "ENRG_pitch.mp4"))
        print(f"\n  reassembled: {total:.2f}s")
        qa(os.path.join(HERE, "ENRG_pitch.mp4"), [])
        return

    videos, marks, table = [], [], []
    for scene in SCENES:
        if only and scene["id"] not in only:
            continue
        beats = synthesize(scene)
        beats, total = schedule(beats, scene["min_duration"])
        audio, voiced = scene_audio(scene["id"], beats, total)
        bg = background(scene, total)
        if scene.get("decoration") == "numbers":
            add_numbers_footer(bg)
        print(f'  · scene {scene["id"]}: {total:5.2f}s (voice {voiced:5.2f}s, {len(beats)} beats)')
        videos.append(build_scene(scene, beats, total, bg, audio))
        table.append((scene["id"], total))
        marks.append((scene["id"], total * 0.62))

    if only and "end" in only:
        videos.append(endcard(len(SCENES)))

    if only:
        print("\n== single-scene render ==")
        for sid, d in table:
            print(f"  {sid:>4}  {d:6.2f}s")
        for v in videos:
            print(f"  {v}")
        return

    videos.append(endcard(len(SCENES)))
    table.append(("end", META["endcard"]))
    out = os.path.join(HERE, "ENRG_pitch.mp4")
    total = assemble(videos, out)

    print("\n== scenes ==")
    for sid, d in table:
        print(f"  {sid:>4}  {d:6.2f}s")
    print(f"  {'TOTAL':>4}  {total:6.2f}s   ({int(total // 60)}:{total % 60:04.1f})")
    if not 118 <= total <= 152:
        print(f"  !! duration {total:.1f}s is outside the target 2:00-2:30 window")
    qa(out, marks)
    print(f"\nwritten: {out}")


if __name__ == "__main__":
    main()



