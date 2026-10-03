"""Relief-map data: stitch AWS Terrain Tiles (terrarium PNG, open data) for film.json's
geo.bbox and export places / routes / rivers for film/map.js.

Downloads are cached in ~/.cache/code-doc-film and happen only with --download, so the
caller can tell the user what will be fetched (and how much) before fetching it.
No borders of any kind are exported — only terrain, rivers, places and routes.
"""
import json, math, os, struct, urllib.request, zipfile
from pathlib import Path

CACHE = Path(os.environ.get('CODE_DOC_FILM_CACHE', Path.home() / '.cache' / 'code-doc-film'))
TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
RIVERS_URL = 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_rivers_lake_centerlines.zip'


def tile_xy(lon, lat, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def _ssl_context():
    import ssl
    try:
        import certifi                       # python.org builds of Python ship without root certificates
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def fetch(url, dest):
    """Download to dest (atomically). Falls back to curl when Python has no usable root certificates."""
    import shutil, subprocess
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + '.part')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'code-doc-film/1.0'})
        with urllib.request.urlopen(req, timeout=60, context=_ssl_context()) as r, open(tmp, 'wb') as f:
            f.write(r.read())
    except Exception as e:
        if not shutil.which('curl'):
            raise
        r = subprocess.run(['curl', '-fsSL', '--retry', '3', '-A', 'code-doc-film/1.0', '-o', str(tmp), url], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(f'download failed: {url}\n  python: {e}\n  curl: {r.stderr.strip()}')
    tmp.replace(dest)


def read_rivers(bbox):
    d = CACHE / 'ne'
    shp, dbf = (d / 'ne_10m_rivers_lake_centerlines.shp').read_bytes(), (d / 'ne_10m_rivers_lake_centerlines.dbf').read_bytes()
    nrec, hlen, rlen = struct.unpack('<IHH', dbf[4:12])
    fields, off = [], 32
    while dbf[off] != 0x0D:
        fields.append((dbf[off:off + 11].split(b'\0')[0].decode(), dbf[off + 16])); off += 32

    def rec(i):
        base, out = hlen + i * rlen + 1, {}
        for name, flen in fields:
            out[name] = dbf[base:base + flen].decode('utf-8', 'ignore').replace('\x00', '').strip(); base += flen
        return out
    lon0, lat0, lon1, lat1 = bbox
    rivers, pos, i = [], 100, 0
    while pos < len(shp):
        _, clen = struct.unpack('>II', shp[pos:pos + 8]); content = shp[pos + 8:pos + 8 + clen * 2]; pos += 8 + clen * 2
        if struct.unpack('<i', content[:4])[0] == 3:
            xmin, ymin, xmax, ymax = struct.unpack('<4d', content[4:36])
            npart, npts = struct.unpack('<ii', content[36:44])
            if xmax > lon0 and xmin < lon1 and ymax > lat0 and ymin < lat1:
                parts = list(struct.unpack(f'<{npart}i', content[44:44 + 4 * npart])) + [npts]
                pts = struct.unpack(f'<{2 * npts}d', content[44 + 4 * npart:44 + 4 * npart + 16 * npts])
                r = rec(i)
                for a, b in zip(parts[:-1], parts[1:]):
                    rivers.append({'name': r.get('name', ''), 'zh': r.get('name_zh', ''), 'rank': int(r.get('scalerank') or 9), 'pts': [[round(pts[2 * k], 4), round(pts[2 * k + 1], 4)] for k in range(a, b)]})
        i += 1
    return rivers


def build(film, P, download=False):
    from PIL import Image
    g = film.get('geo')
    if not g:
        print('film.json has no "geo" section — this film has no map; nothing to do'); return
    z = g.get('zoom', 6)
    lon0, lat0, lon1, lat1 = g['bbox']                       # west, south, east, north
    x0, y0 = tile_xy(lon0, lat1, z); x1, y1 = tile_xy(lon1, lat0, z)
    tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    need = [(x, y) for x, y in tiles if not (CACHE / 'terrarium' / str(z) / f'{x}_{y}.png').exists()]
    need_rivers = not (CACHE / 'ne' / 'ne_10m_rivers_lake_centerlines.shp').exists()
    if (need or need_rivers) and not download:
        print(f'Map data to download (ask the user first, then re-run with --download):')
        if need:
            print(f'  · {len(need)} terrain tiles, about {len(need) * 0.08:.1f} MB — AWS Terrain Tiles (open data), zoom {z}: {TILE_URL.format(z=z, x="x", y="y")}')
        if need_rivers:
            print(f'  · ne_10m_rivers_lake_centerlines.zip, about 2 MB — Natural Earth (public domain): {RIVERS_URL}')
        return
    if need:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(8) as ex:
            list(ex.map(lambda t: fetch(TILE_URL.format(z=z, x=t[0], y=t[1]), CACHE / 'terrarium' / str(z) / f'{t[0]}_{t[1]}.png'), need))
        got = sum((CACHE / 'terrarium' / str(z) / f'{x}_{y}.png').stat().st_size for x, y in need)
        print(f'downloaded {len(need)} terrain tiles, {got / 1e6:.1f} MB')
    if need_rivers:
        zp = CACHE / 'ne' / 'rivers.zip'
        fetch(RIVERS_URL, zp)
        zipfile.ZipFile(zp).extractall(CACHE / 'ne')
    W, H = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
    img = Image.new('RGB', (W, H))
    for x, y in tiles:
        img.paste(Image.open(CACHE / 'terrarium' / str(z) / f'{x}_{y}.png').convert('RGB'), ((x - x0) * 256, (y - y0) * 256))
    (P / 'assets').mkdir(exist_ok=True)
    img.save(P / 'assets' / 'terrain.png')
    places = {k: {'ll': v} for k, v in g.get('places', {}).items()}
    routes, nodes = {}, {}
    for name, pts in g.get('routes', {}).items():
        routes[name], nodes[name] = [], {}
        for i, p in enumerate(pts):
            if isinstance(p, str):                         # a place name is a route point AND a named node
                if p not in places:
                    raise SystemExit(f'geo.routes.{name}: unknown place "{p}"')
                nodes[name][p] = i
                routes[name].append(places[p]['ll'])
            else:
                routes[name].append(p)
    out = {'image': 'assets/terrain.png', 'size': [W, H], 'zoom': z, 'origin': [x0 * 256, y0 * 256], 'places': places, 'routes': routes, 'nodes': nodes,
           'rivers': [r for r in read_rivers((lon0 - 1, lat0 - 1, lon1 + 1, lat1 + 1)) if r['rank'] <= g.get('riverRank', 8)]}
    (P / 'assets' / 'geo.json').write_text(json.dumps(out, ensure_ascii=False))
    print(f"assets/terrain.png {W}×{H} ({len(tiles)} tiles), assets/geo.json: {len(places)} places, {len(routes)} route(s), {len(out['rivers'])} river lines")
