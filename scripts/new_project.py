#!/usr/bin/env python3
"""Scaffold (or refresh) a code-doc-film project.

  python3 new_project.py videos/<slug>                 new project: HyperFrames init + engine + scripts + three.js
  python3 new_project.py videos/<slug> --example zheng-he     also copy that example's film.json and scenes
  python3 new_project.py videos/<slug> --sync          refresh film/, scripts/, tools/ from the skill (keeps film.json, scenes/, assets/, audio/)
"""
import argparse, json, shutil, subprocess, sys
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
TEMPLATE = SKILL / 'template'
THREE = 'three@0.181.2'
ENGINE_DIRS = ('film', 'scripts', 'tools')


def run(cmd, cwd=None):
    print('$', ' '.join(str(c) for c in cmd))
    subprocess.run(cmd, check=True, cwd=cwd)


def copy_engine(dest):
    for d in ENGINE_DIRS:
        shutil.copytree(TEMPLATE / d, dest / d, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))


def vendor_three(dest):
    if (dest / 'vendor' / 'three' / 'three.module.js').exists():
        return
    run(['npm', 'i', '--no-audit', '--no-fund', THREE], cwd=dest)
    v = dest / 'vendor' / 'three'
    (v / 'addons').mkdir(parents=True, exist_ok=True)
    nm = dest / 'node_modules' / 'three'
    for f in ('three.module.js', 'three.core.js'):
        shutil.copy(nm / 'build' / f, v / f)
    for d in ('postprocessing', 'shaders', 'objects', 'utils'):
        shutil.copytree(nm / 'examples' / 'jsm' / d, v / 'addons' / d, dirs_exist_ok=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dir')
    ap.add_argument('--example')
    ap.add_argument('--sync', action='store_true')
    a = ap.parse_args()
    dest = Path(a.dir).resolve()
    if a.sync:
        if not (dest / 'film.json').exists():
            sys.exit(f'{dest} is not a code-doc-film project (no film.json)')
        copy_engine(dest)
        print(f'engine refreshed in {dest} — film.json, scenes/, assets/ and audio/ untouched')
        return
    if (dest / 'film.json').exists():
        sys.exit(f'{dest} already has a film.json — use --sync to refresh the engine')
    if not (dest / 'hyperframes.json').exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        run(['npx', '--yes', 'hyperframes', 'init', str(dest), '--non-interactive', '--example=blank'])
    copy_engine(dest)
    (dest / 'scenes').mkdir(exist_ok=True)
    if a.example:
        ex = SKILL / 'examples' / a.example
        if not ex.exists():
            sys.exit(f'no such example: {a.example} (have: {[p.name for p in (SKILL / "examples").iterdir()]})')
        shutil.copy(ex / 'film.json', dest / 'film.json')
        shutil.copytree(ex / 'scenes', dest / 'scenes', dirs_exist_ok=True)
    else:
        shutil.copy(TEMPLATE / 'film.example.json', dest / 'film.json')
        shutil.copy(TEMPLATE / 'scenes' / '_example.js', dest / 'scenes' / 'example.js')
        film = json.loads((dest / 'film.json').read_text())
        film['meta']['slug'] = dest.name
        (dest / 'film.json').write_text(json.dumps(film, ensure_ascii=False, indent=2))
    vendor_three(dest)
    for d in ('assets', 'audio', 'build', 'logs', 'renders', 'snapshots'):
        (dest / d).mkdir(exist_ok=True)
    print(f'\nproject ready: {dest}\nnext: edit film.json, then  cd {dest} && python3 scripts/film.py cues')


if __name__ == '__main__':
    main()
