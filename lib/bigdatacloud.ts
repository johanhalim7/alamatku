import type { CrossCheck } from "./types";

/**
 * BigDataCloud reverse-geocode-client: endpoint gratis yang memang dirancang
 * untuk dipanggil dari browser/perangkat pengguna (BUKAN dari server).
 * Dipakai sebagai cek silang kelurahan/kecamatan/kota/kode pos.
 * Mengembalikan null bila gagal — kegagalannya tidak boleh memblokir alur utama.
 */
export async function fetchCrossCheck(lat: number, lng: number): Promise<CrossCheck | null> {
  try {
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&localityLanguage=id`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;

    const li = (j.localityInfo ?? {}) as Record<string, unknown>;
    const adminRaw = Array.isArray(li.administrative) ? li.administrative : [];
    const admin = adminRaw.filter(
      (e): e is Record<string, unknown> => typeof e === "object" && e !== null,
    );

    const byLevel = (level: number): string => {
      const hit = admin.find((e) => e.adminLevel === level && typeof e.name === "string");
      return hit ? String(hit.name) : "";
    };
    // Hierarki Indonesia di BigDataCloud umumnya: 4=provinsi, 5=kota/kab, 6=kecamatan, 7/8=kelurahan.
    const levels = admin
      .map((e) => e.adminLevel)
      .filter((n): n is number => typeof n === "number")
      .sort((a, b) => a - b);
    const deepest = levels.length ? levels[levels.length - 1] : 0;

    const str = (v: unknown) => (typeof v === "string" ? v : "");

    // Hierarki Indonesia di BigDataCloud: admin 4=provinsi, 5=kota/kab, 6=kecamatan.
    // principalSubdivision/city bawaan kadang terlalu umum (mis. "Jawa"/"Jakarta"),
    // jadi nilai per-level administrasi didahulukan bila ada.
    return {
      village: str(j.locality) || (deepest >= 7 ? byLevel(deepest) : ""),
      cityDistrict: byLevel(6),
      city: byLevel(5) || str(j.city),
      state: byLevel(4) || str(j.principalSubdivision),
      postcode: str(j.postcode),
    };
  } catch {
    return null;
  }
}
