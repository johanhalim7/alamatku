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
  /** RW yang terdeteksi dari field city_block Nominatim ("RW 02"), bila ada. */
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
