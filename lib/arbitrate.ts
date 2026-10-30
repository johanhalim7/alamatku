import type { AddressComponents, CrossCheck } from "./types";

export interface PostcodeConflictPair {
  nominatim: string;
  bigdatacloud: string;
}

const eq = (a: string, b: string): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Gabungkan komponen alamat Nominatim dengan cek silang BigDataCloud.
 *
 * Masalah yang diperbaiki: di banyak kota, Nominatim menaruh nama KECAMATAN
 * di field `suburb`, dan normalisasi lama memindahkannya ke slot kelurahan —
 * akibatnya "yang harusnya kecamatan malah jadi kelurahan". BigDataCloud
 * menyediakan hierarki administrasi berlevel eksplisit (level 6 = kecamatan),
 * jadi ia dipakai sebagai wasit tingkat administrasi:
 *
 * - Bila isi slot kelurahan ternyata sama dengan nama kecamatan versi
 *   BigDataCloud (dan slot kecamatan Nominatim tidak sudah berisi nama yang
 *   sama — pola sah seperti Kel./Kec. Gambir), nilai itu salah tingkat:
 *   pindahkan ke slot kecamatan dan kosongkan/ganti kelurahannya.
 * - Bila isi slot kecamatan ternyata nama kota/kabupaten versi BigDataCloud,
 *   perbaiki serupa.
 * - Selebihnya BigDataCloud hanya mengisi slot yang kosong, dan konflik kode
 *   pos tetap diserahkan ke pengguna (tidak dipilih diam-diam).
 */
export function arbitrateComponents(
  comps: AddressComponents,
  cross: CrossCheck | null,
): { components: AddressComponents; postcodeConflict: PostcodeConflictPair | null } {
  const out: AddressComponents = { ...comps };
  let postcodeConflict: PostcodeConflictPair | null = null;
  if (!cross) return { components: out, postcodeConflict };

  // 1) Anti-tukar kelurahan <-> kecamatan.
  if (
    cross.cityDistrict &&
    eq(out.village, cross.cityDistrict) &&
    !eq(out.cityDistrict, out.village)
  ) {
    if (!out.cityDistrict) out.cityDistrict = cross.cityDistrict;
    out.village =
      cross.village && !eq(cross.village, cross.cityDistrict) ? cross.village : "";
  }

  // 2) Anti-tukar kecamatan <-> kota/kabupaten.
  if (
    cross.cityDistrict &&
    cross.city &&
    eq(out.cityDistrict, cross.city) &&
    !eq(out.city, out.cityDistrict)
  ) {
    out.city = cross.city;
    out.cityDistrict = cross.cityDistrict;
  }

  // 3) Isi slot kosong dari BigDataCloud (dengan penjaga anti-tukar).
  if (!out.village && cross.village && !eq(cross.village, out.cityDistrict)) {
    out.village = cross.village;
  }
  if (!out.cityDistrict && cross.cityDistrict) out.cityDistrict = cross.cityDistrict;
  if (!out.city && cross.city) out.city = cross.city;
  if (!out.state && cross.state) out.state = cross.state;

  // 4) Kode pos: konflik tidak dipilih diam-diam; pengguna yang memutuskan.
  if (out.postcode && cross.postcode && out.postcode !== cross.postcode) {
    postcodeConflict = { nominatim: out.postcode, bigdatacloud: cross.postcode };
    out.postcode = "";
  } else if (!out.postcode && cross.postcode) {
    out.postcode = cross.postcode;
  }

  return { components: out, postcodeConflict };
}
