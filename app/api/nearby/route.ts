import { NextRequest, NextResponse } from "next/server";
import { parseLatLng } from "@/lib/nominatim";
import type { Landmark } from "@/lib/types";

const RADIUS_M = 300;

/** Label Bahasa Indonesia untuk jenis tempat dari tag OSM. */
function kindLabel(tags: Record<string, string>): string {
  const a = tags.amenity ?? "";
  const shop = tags.shop ?? "";
  const building = tags.building ?? "";
  if (building === "mosque" || /masjid|musholla|mushola/i.test(tags.name ?? "")) return "Masjid";
  if (a === "place_of_worship") return tags.religion === "christian" ? "Gereja" : "Tempat ibadah";
  if (building === "church") return "Gereja";
  if (a === "school" || building === "school" || a === "kindergarten") return "Sekolah";
  if (a === "university" || a === "college") return "Kampus";
  if (shop === "convenience") return "Minimarket";
  if (shop === "supermarket") return "Supermarket";
  if (shop === "mall" || a === "marketplace") return "Pasar/Mal";
  if (a === "pharmacy") return "Apotek";
  if (a === "hospital") return "Rumah sakit";
  if (a === "clinic" || a === "doctors") return "Klinik";
  if (a === "fuel") return "SPBU";
  if (a === "post_office") return "Kantor pos";
  if (a === "police") return "Kantor polisi";
  if (a === "bank" || a === "atm") return "Bank/ATM";
  if (tags.office === "government") return "Kantor pemerintahan";
  if (tags.railway === "station" || tags.public_transport === "station") return "Stasiun/Halte";
  if (a === "restaurant" || a === "fast_food" || a === "cafe") return "Tempat makan";
  if (a) return "Fasilitas umum";
  if (shop) return "Toko";
  return "Tempat";
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const AMENITIES =
  "place_of_worship|school|kindergarten|university|college|hospital|clinic|pharmacy|marketplace|fuel|police|post_office|bank|restaurant|fast_food|cafe|library";

/**
 * Patokan otomatis: tempat bernama dalam radius 300 m dari Overpass API (OSM).
 * Mengembalikan maksimal 5 kandidat terdekat beserta jaraknya.
 */
export async function GET(req: NextRequest) {
  const coords = parseLatLng(req.nextUrl.searchParams);
  if (!coords) {
    return NextResponse.json({ error: "Parameter lat & lng tidak valid." }, { status: 400 });
  }
  const { lat, lng } = coords;
  const around = `(around:${RADIUS_M},${lat},${lng})`;

  const ql = `
[out:json][timeout:12];
(
  node["name"]["amenity"~"^(${AMENITIES})$"]${around};
  way["name"]["amenity"~"^(${AMENITIES})$"]${around};
  node["name"]["shop"~"^(convenience|supermarket|mall)$"]${around};
  way["name"]["shop"~"^(convenience|supermarket|mall)$"]${around};
  node["name"]["building"~"^(mosque|church|school)$"]${around};
  way["name"]["building"~"^(mosque|church|school)$"]${around};
  node["name"]["office"="government"]${around};
  way["name"]["office"="government"]${around};
  node["name"]["railway"~"^(station|halt)$"]${around};
  node["name"]["public_transport"~"^(station|stop_position|platform)$"]${around};
);
out center 60;`;

  // Coba instans Overpass utama, lalu cermin publik bila gagal/diblokir jaringan.
  const ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  let upstream: Response | null = null;
  let lastStatus = 0;
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "AlamatKu/1.0 (web pencari alamat Indonesia)",
        },
        body: `data=${encodeURIComponent(ql)}`,
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        upstream = res;
        break;
      }
      lastStatus = res.status;
    } catch {
      /* lanjut ke cermin berikutnya */
    }
  }
  if (!upstream) {
    return NextResponse.json(
      {
        error:
          lastStatus > 0
            ? `Overpass membalas status ${lastStatus}.`
            : "Layanan patokan (Overpass) tidak terjangkau saat ini.",
      },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as {
    elements?: Array<{
      type: string;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }>;
  };

  const seen = new Set<string>();
  const landmarks: Landmark[] = [];
  for (const el of data.elements ?? []) {
    const name = el.tags?.name?.trim();
    if (!name) continue;
    const elat = el.lat ?? el.center?.lat;
    const elng = el.lon ?? el.center?.lon;
    if (elat == null || elng == null) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    landmarks.push({
      name,
      kind: kindLabel(el.tags ?? {}),
      lat: elat,
      lng: elng,
      distanceMeters: Math.round(haversineMeters(lat, lng, elat, elng)),
    });
  }
  landmarks.sort((a, b) => a.distanceMeters - b.distanceMeters);

  return NextResponse.json(
    { landmarks: landmarks.slice(0, 5), radiusMeters: RADIUS_M },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
