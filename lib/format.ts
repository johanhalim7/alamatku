import { OpenLocationCode } from "open-location-code";
import type { AddressResult } from "./types";

const olc = new OpenLocationCode();

/** Hitung Plus Code (Open Location Code) dari koordinat, lokal tanpa jaringan. */
export function computePlusCode(lat: number, lng: number): string {
  try {
    return olc.encode(lat, lng);
  } catch {
    return "";
  }
}

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** RT/RW lazim ditulis 3 digit: "4" -> "004". Nilai non-numerik dibiarkan apa adanya. */
export function padRtRw(v: string): string {
  const t = v.trim();
  return /^\d+$/.test(t) ? t.padStart(3, "0") : t;
}

function withKec(v: string): string {
  const t = v.trim();
  if (!t) return "";
  return /^(kec\.|kecamatan)\s/i.test(t) ? t : `Kec. ${t}`;
}

function withKel(v: string): string {
  const t = v.trim();
  if (!t) return "";
  return /^(kel\.|kelurahan|desa)\s/i.test(t) ? t : `Kel. ${t}`;
}

/** Alamat lengkap satu baris, format Indonesia. */
export function formatOneLine(a: AddressResult): string {
  const parts: string[] = [];

  let street = a.road.trim();
  if (street && a.houseNumber.trim()) street += ` No. ${a.houseNumber.trim()}`;
  else if (!street && a.houseNumber.trim()) street = `No. ${a.houseNumber.trim()}`;
  if (street) parts.push(street);

  if (a.building.trim()) parts.push(a.building.trim());

  const rt = padRtRw(a.rt);
  const rw = padRtRw(a.rw);
  if (rt && rw) parts.push(`RT ${rt}/RW ${rw}`);
  else if (rt) parts.push(`RT ${rt}`);
  else if (rw) parts.push(`RW ${rw}`);

  if (a.neighbourhood.trim() && a.neighbourhood.trim() !== a.village.trim()) {
    parts.push(a.neighbourhood.trim());
  }
  if (a.village.trim()) parts.push(withKel(a.village));
  if (a.cityDistrict.trim()) parts.push(withKec(a.cityDistrict));
  if (a.city.trim()) parts.push(a.city.trim());

  const stateZip = [a.state.trim(), a.postcode.trim()].filter(Boolean).join(" ");
  if (stateZip) parts.push(stateZip);

  return parts.join(", ");
}

/** Blok teks format Shopee: baris jalan & nomor, patokan, dan rincian wilayah. */
export function formatShopee(a: AddressResult): string {
  const lines: string[] = [];

  let street = a.road.trim();
  if (street && a.houseNumber.trim()) street += ` No. ${a.houseNumber.trim()}`;
  if (a.building.trim()) street = street ? `${street} (${a.building.trim()})` : a.building.trim();
  const rt = padRtRw(a.rt);
  const rw = padRtRw(a.rw);
  if (rt && rw) street += street ? `, RT ${rt}/RW ${rw}` : `RT ${rt}/RW ${rw}`;
  lines.push(`Nama jalan & nomor: ${street || "-"}`);

  lines.push(`Patokan: ${a.patokan.trim() || "-"}`);

  const wilayah: string[] = [];
  if (a.village.trim()) wilayah.push(withKel(a.village));
  if (a.cityDistrict.trim()) wilayah.push(withKec(a.cityDistrict));
  if (a.city.trim()) wilayah.push(a.city.trim());
  if (a.state.trim()) wilayah.push(a.state.trim());
  if (a.postcode.trim()) wilayah.push(`Kode Pos ${a.postcode.trim()}`);
  lines.push(`Wilayah: ${wilayah.join(", ") || "-"}`);

  return lines.join("\n");
}

/** 7 komponen kunci kelengkapan sesuai PRD. */
export function completeness(a: AddressResult): { filled: number; total: number; missing: string[] } {
  const checks: Array<[string, string]> = [
    ["Nama jalan", a.road],
    ["Nomor rumah", a.houseNumber],
    ["RT", a.rt],
    ["RW", a.rw],
    ["Kelurahan", a.village],
    ["Kecamatan", a.cityDistrict],
    ["Kode pos", a.postcode],
  ];
  const missing = checks.filter(([, v]) => !v.trim()).map(([label]) => label);
  return { filled: checks.length - missing.length, total: checks.length, missing };
}
