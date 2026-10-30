import type { AddressComponents } from "./types";

/**
 * Normalisasi satu objek address Nominatim (addressdetails=1, accept-language=id)
 * ke skema alamat Indonesia. Dipakai route /api/reverse dan /api/search.
 *
 * Pola data OSM/Nominatim di Indonesia yang harus ditangani:
 * - Normal (mis. Bandung): suburb=kelurahan, district/city_district=kecamatan,
 *   city=kota, state=provinsi.
 * - Jakarta (DKI): bergeser satu tingkat — village/neighbourhood=kelurahan,
 *   suburb=nama kecamatan, city_district=kota administrasi, city=provinsi,
 *   dan `state` kosong. Terdeteksi bila `city` berisi nama provinsi.
 * - `city_block` kerap berisi "RW 02" — dimanfaatkan sebagai deteksi RW.
 */
export const NOMINATIM_UA =
  "AlamatKu/1.0 (web pencari alamat Indonesia; kontak: johanhalim7@users.noreply.github.com)";

type RawAddress = Record<string, string | undefined>;

const PROVINCES = new Set(
  [
    "Aceh", "Sumatera Utara", "Sumatera Barat", "Riau", "Kepulauan Riau", "Jambi",
    "Sumatera Selatan", "Kepulauan Bangka Belitung", "Bangka Belitung", "Bengkulu",
    "Lampung", "Banten", "DKI Jakarta", "Daerah Khusus Ibukota Jakarta", "Jakarta",
    "Jawa Barat", "Jawa Tengah", "DI Yogyakarta", "Daerah Istimewa Yogyakarta",
    "Yogyakarta", "Jawa Timur", "Bali", "Nusa Tenggara Barat", "Nusa Tenggara Timur",
    "Kalimantan Barat", "Kalimantan Tengah", "Kalimantan Selatan", "Kalimantan Timur",
    "Kalimantan Utara", "Sulawesi Utara", "Gorontalo", "Sulawesi Tengah",
    "Sulawesi Barat", "Sulawesi Selatan", "Sulawesi Tenggara", "Maluku",
    "Maluku Utara", "Papua", "Papua Barat", "Papua Selatan", "Papua Tengah",
    "Papua Pegunungan", "Papua Barat Daya",
  ].map((s) => s.toLowerCase()),
);

const first = (addr: RawAddress, keys: string[]): string => {
  for (const k of keys) {
    const v = addr[k];
    if (v && v.trim()) return v.trim();
  }
  return "";
};

export function normalizeNominatimAddress(raw: unknown): {
  components: AddressComponents;
  houseNumberDetected: string;
  rwDetected: string;
} {
  const addr = (raw ?? {}) as RawAddress;

  const road = first(addr, ["road", "pedestrian", "footway", "cycleway", "path", "residential"]);
  const postcode = first(addr, ["postcode"]);
  const country = first(addr, ["country"]) || "Indonesia";
  const houseNumberDetected = first(addr, ["house_number"]);
  const rwMatch = (addr.city_block ?? "").match(/RW\s*0*(\d+)/i);
  const rwDetected = rwMatch ? rwMatch[1] : "";

  let state = first(addr, ["state", "province", "region"]);
  let city = first(addr, ["city", "municipality", "town", "county"]);
  let cityDistrict = first(addr, ["city_district", "district", "subdistrict"]);
  let village = first(addr, ["village", "hamlet"]);
  let neighbourhood = first(addr, ["neighbourhood", "quarter"]);

  const jakartaShift = !state && city !== "" && PROVINCES.has(city.toLowerCase());
  if (jakartaShift) {
    // Pola Jakarta: city=provinsi, city_district=kota administrasi, suburb=kecamatan.
    state = city;
    city = cityDistrict;
    cityDistrict = first(addr, ["suburb"]);
    if (!village) {
      village = neighbourhood;
      neighbourhood = "";
    }
  } else {
    // Pola normal: suburb umumnya kelurahan bila village kosong; bila suburb
    // tidak terpakai sebagai kelurahan, ia dapat menjadi kecamatan cadangan.
    const suburb = first(addr, ["suburb"]);
    if (!village && suburb) village = suburb;
    else if (!cityDistrict && suburb && suburb !== village) cityDistrict = suburb;
  }

  return {
    components: {
      road,
      neighbourhood,
      village,
      cityDistrict,
      city,
      state,
      postcode,
      country,
    },
    houseNumberDetected,
    rwDetected,
  };
}

export function parseLatLng(searchParams: URLSearchParams): { lat: number; lng: number } | null {
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng") ?? searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
