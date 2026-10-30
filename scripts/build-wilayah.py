#!/usr/bin/env python3
"""Bangun data/wilayah.json untuk AlamatKu.

Sumber:
- Hierarki + kode pos: dataset kodepos-id (Kemendagri, via nomor.net) - kodepos_parsed.csv
- Koordinat pusat desa: API Wikipedia bahasa Indonesia (prop=coordinates),
  judul artikel berpola "{desa}, {kecamatan}, {kabupaten}" (dibuat massal untuk
  hampir semua desa di Indonesia).

Ketahanan: hasil tiap batch disimpan ke scripts/coords_checkpoint.jsonl
(berkas persisten, bukan /tmp) sehingga proses yang mati di tengah (VM
redeploy/restart) dapat dilanjutkan tanpa mengulang dari nol. Pemrosesan
paralel 6 pekerja. Berkas akhir ditulis atomik (tmp + rename).

Output: {"v": [[desa, kecamatan, kabupaten, provinsi, kodepos, lat|null, lng|null], ...]}
"""
import csv, io, json, os, threading, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "wilayah.json")
CKPT = os.path.join(HERE, "coords_checkpoint.jsonl")
CSV_URL = "https://raw.githubusercontent.com/mrayhanfadil/kodepos-id/main/kodepos_parsed.csv"
UA = {"User-Agent": "AlamatKu/1.0 (build data wilayah; kontak: johanhalim7@users.noreply.github.com)"}
WORKERS = 6
BATCH = 50

def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=60).read()

print("Unduh CSV wilayah...", flush=True)
rows = list(csv.DictReader(io.StringIO(fetch(CSV_URL).decode("utf-8"))))
print(f"{len(rows)} baris desa", flush=True)

def titles_for(r):
    desa, kec = r["desa"].strip(), r["kecamatan"].strip()
    kab = r["kabupaten"].strip()
    dt2 = (r.get("dt2") or "").strip()
    cands = [f"{desa}, {kec}, {kab}"]
    if dt2:
        cands.append(f"{desa}, {kec}, {dt2} {kab}")
    return cands

# --- muat checkpoint lama: title -> (lat, lng) atau None (sudah dicek, kosong)
done = {}
if os.path.exists(CKPT):
    with open(CKPT, encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            done[rec["t"]] = (rec["la"], rec["lo"]) if rec.get("la") is not None else None
print(f"Checkpoint: {len(done)} judul sudah diproses sebelumnya", flush=True)

ckpt_lock = threading.Lock()
ckpt_f = open(CKPT, "a", encoding="utf-8")

def record(title, la, lo):
    with ckpt_lock:
        ckpt_f.write(json.dumps({"t": title, "la": la, "lo": lo}, ensure_ascii=False) + "\n")
        ckpt_f.flush()
        os.fsync(ckpt_f.fileno())
    done[title] = (la, lo) if la is not None else None

def process_batch(batch):
    url = ("https://id.wikipedia.org/w/api.php?action=query&prop=coordinates&redirects=1"
           "&format=json&colimit=50&titles=" + urllib.parse.quote("|".join(batch)))
    try:
        data = json.loads(fetch(url))
    except Exception as e:
        print(f"batch GAGAL ({e}); judul ditandai kosong agar tidak mengulang selamanya", flush=True)
        for t in batch:
            record(t, None, None)
        return 0
    q = data.get("query") or {}
    norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
    redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
    def resolve(t):
        t = norm.get(t, t)
        seen = set()
        while t in redir and t not in seen:
            seen.add(t)
            t = norm.get(redir[t], redir[t])
        return t
    by_title = {p.get("title", ""): p for p in (q.get("pages") or {}).values()}
    hits = 0
    for t in batch:
        p = by_title.get(resolve(t))
        co = ((p.get("coordinates") or [None])[0] if p else None)
        if co and co.get("lat") is not None:
            record(t, round(float(co["lat"]), 5), round(float(co["lon"]), 5))
            hits += 1
        else:
            record(t, None, None)
    return hits

def run_pass(title_to_row, label):
    todo_titles = [t for t in title_to_row if t not in done]
    print(f"{label}: {len(todo_titles)} judul belum diproses", flush=True)
    batches = [todo_titles[i:i + BATCH] for i in range(0, len(todo_titles), BATCH)]
    total_hits = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for n, hits in enumerate(ex.map(process_batch, batches)):
            total_hits += hits
            if n % 100 == 0:
                print(f"  {label}: batch {n}/{len(batches)}, total koordinat baru {total_hits}", flush=True)
    print(f"{label} selesai: {total_hits} koordinat baru", flush=True)

primary, fallback = {}, {}
for i, r in enumerate(rows):
    cands = titles_for(r)
    primary.setdefault(cands[0], i)
    if len(cands) > 1:
        fallback.setdefault(cands[1], i)

run_pass(primary, "Lintasan 1 (judul utama)")
# Lintasan 2 hanya untuk baris yang judul utamanya tidak menghasilkan koordinat
coords_by_row = {}
for t, i in primary.items():
    if done.get(t):
        coords_by_row[i] = done[t]
missing_fb = {t: i for t, i in fallback.items() if i not in coords_by_row}
run_pass(missing_fb, "Lintasan 2 (varian Kabupaten/Kota)")
for t, i in missing_fb.items():
    if done.get(t):
        coords_by_row[i] = done[t]

out = []
for i, r in enumerate(rows):
    la, lo = coords_by_row.get(i, (None, None))
    out.append([r["desa"].strip(), r["kecamatan"].strip(), r["kabupaten"].strip(),
                r["provinsi"].strip(), (r["kode_pos"] or "").strip(), la, lo])

tmp_out = OUT + ".tmp"
with open(tmp_out, "w", encoding="utf-8") as f:
    json.dump({"v": out}, f, ensure_ascii=False, separators=(",", ":"))
os.replace(tmp_out, OUT)
n_coord = sum(1 for r in out if r[5] is not None)
print(f"Selesai: {len(out)} baris, {n_coord} dengan koordinat ({n_coord*100//len(out)}%)")
print("Ukuran berkas:", os.path.getsize(OUT), "byte ->", OUT)
