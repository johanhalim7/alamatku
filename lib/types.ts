// Tipe data inti AlamatKu.

export interface Landmark {
  name: string;
  /** Jenis tempat dalam Bahasa Indonesia, mis. "Minimarket", "Masjid", "Sekolah". */
  kind: string;
  lat: number;
  lng: number;
  distanceMeters: number;
}

/** Komponen alamat hasil deteksi (dapat diedit pengguna). */
export interface AddressComponents {
  road: string;
  neighbourhood: string;
  village: string; // kelurahan / desa
  cityDistrict: string; // kecamatan
  city: string; // kota / kabupaten
  state: string; // provinsi
  postcode: string;
  country: string;
}

/** Isian manual yang hanya penghuni yang tahu. */
export interface UserFields {
  houseNumber: string;
  rt: string;
  rw: string;
  building: string; // gedung / kost / kamar / blok
  patokan: string;
}

export interface AddressResult extends AddressComponents, UserFields {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  plusCode: string;
  displayName: string;
  landmarks: Landmark[];
}

/** Hasil ternormalisasi dari /api/reverse (Nominatim via proxy server). */
export interface ReverseResponse {
  found: boolean;
  components: AddressComponents;
  houseNumberDetected: string;
  /** RT yang terpanen dari teks geocoder ("RT. 12/04" dsb.), bila ada. */
  rtDetected: string;
  /** RW yang terpanen dari teks geocoder (mis. city_block "RW 02"), bila ada. */
  rwDetected: string;
  displayName: string;
}

/** Hasil cek silang BigDataCloud (dipanggil dari browser). */
export interface CrossCheck {
  village: string;
  cityDistrict: string;
  city: string;
  state: string;
  postcode: string;
}

/** Kandidat desa dari dataset wilayah resmi (Kemendagri) — lihat /api/desa. */
export interface DesaCandidate {
  village: string;
  cityDistrict: string;
  city: string;
  state: string;
  postcode: string;
  /** Jarak titik pengguna ke pusat desa (km); null bila pusat desa tak berkoordinat. */
  distanceKm: number | null;
}

/** Respons /api/desa. */
export interface DesaResponse {
  /** Kandidat berkoordinat terdekat, urut dari yang terdekat (maks 5). */
  nearest: DesaCandidate[];
  /** Kecamatan dari kandidat terdekat ("" bila tak ada kandidat). */
  kecamatan: string;
  /** Seluruh nama desa/kelurahan resmi dalam kecamatan itu (untuk pilihan manual). */
  kecamatanVillages: string[];
}

/** Keputusan AI (Gemini) atas kandidat desa — lihat /api/resolve. */
export interface AiResolution {
  village: string;
  cityDistrict: string;
  confidence: "tinggi" | "sedang" | "rendah";
  reason: string;
}

/**
 * Petunjuk RT/RW dari alamat tempat terdekat yang terdaftar di OpenStreetMap
 * (tag addr:rt/addr:rw/addr:full) — lihat /api/nearby. Sifatnya petunjuk:
 * RT/RW bisa berbeda antarblok walau berdekatan.
 */
export interface RtRwHint {
  rt: string;
  rw: string;
  sourceName: string;
  distanceMeters: number;
}

/** Respons /api/nearby. */
export interface NearbyResponse {
  landmarks: Landmark[];
  rtRwHints: RtRwHint[];
  radiusMeters?: number;
}

export interface SearchItem {
  displayName: string;
  lat: number;
  lng: number;
}

export interface SavedAddress {
  id: string;
  label: string;
  isPrimary: boolean;
  savedAt: number;
  data: AddressResult;
}

export const EMPTY_COMPONENTS: AddressComponents = {
  road: "",
  neighbourhood: "",
  village: "",
  cityDistrict: "",
  city: "",
  state: "",
  postcode: "",
  country: "Indonesia",
};

export const EMPTY_USER_FIELDS: UserFields = {
  houseNumber: "",
  rt: "",
  rw: "",
  building: "",
  patokan: "",
};
