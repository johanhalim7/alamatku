import { readFile } from "fs/promises";
import path from "path";
import type { DesaCandidate } from "./types";

/**
 * Dataset wilayah administrasi resmi (Kemendagri): ~83 ribu desa/kelurahan
 * dengan kecamatan, kabupaten/kota, provinsi, dan kode pos — sebagian besar
 * dilengkapi koordinat pusat desa (dari Wikipedia). Dibangun offline oleh
 * scripts/build-wilayah.py menjadi data/wilayah.json:
 *   {"v": [[desa, kecamatan, kabupaten, provinsi, kodepos, lat|null, lng|null], ...]}
 *
 * Modul ini khusus server (membaca berkas dari disk).
 */

type WilayahRow = [string, string, string, string, string, number | null, number | null];

let cache: Promise<WilayahRow[]> | null = null;

function loadWilayah(): Promise<WilayahRow[]> {
  if (!cache) {
    cache = readFile(path.join(process.cwd(), "data", "wilayah.json"), "utf-8")
      .then((txt) => (JSON.parse(txt) as { v: WilayahRow[] }).v)
      .catch((err) => {
        cache = null; // jangan cache kegagalan; beri kesempatan coba lagi
        throw err;
      });
  }
  return cache;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface DesaLookup {
  nearest: DesaCandidate[];
  kecamatan: string;
  kecamatanVillages: string[];
}

const MAX_NEAREST_KM = 25;

/**
 * Cari desa resmi terdekat dari sebuah titik.
 *
 * Kolam kandidat dipersempit memakai kode pos bila ada (satu kode pos di
 * Indonesia hampir selalu = satu kecamatan), lalu diperingkat menurut jarak
 * ke pusat desa. Tanpa kode pos, seluruh baris berkoordinat dipindai.
 */
export async function findDesaCandidates(
  lat: number,
  lng: number,
  postcode: string,
): Promise<DesaLookup> {
  const rows = await loadWilayah();
  const pc = (postcode || "").trim();
  const pool = pc ? rows.filter((r) => r[4] === pc) : rows;
  const source = pool.length > 0 ? pool : rows;

  const scored: DesaCandidate[] = [];
  for (const r of source) {
    if (r[5] == null || r[6] == null) continue;
    // Prefilter kotak kasar (~0.4 derajat ≈ 44 km) sebelum haversine penuh.
    if (Math.abs(r[5] - lat) > 0.4 || Math.abs(r[6] - lng) > 0.4) continue;
    const d = haversineKm(lat, lng, r[5], r[6]);
    if (d > MAX_NEAREST_KM) continue;
    scored.push({
      village: r[0],
      cityDistrict: r[1],
      city: r[2],
      state: r[3],
      postcode: r[4],
      distanceKm: Math.round(d * 100) / 100,
    });
  }
  scored.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  const nearest = scored.slice(0, 5);

  const kecamatan = nearest[0]?.cityDistrict ?? "";
  let kecamatanVillages: string[] = [];
  if (kecamatan) {
    const kecKey = kecamatan.toLowerCase();
    const cityKey = (nearest[0]?.city ?? "").toLowerCase();
    const names = new Set<string>();
    for (const r of rows) {
      if (r[1].toLowerCase() === kecKey && r[2].toLowerCase() === cityKey) names.add(r[0]);
    }
    kecamatanVillages = [...names].sort((a, b) => a.localeCompare(b, "id"));
  }

  return { nearest, kecamatan, kecamatanVillages };
}
