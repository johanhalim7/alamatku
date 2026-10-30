import { NextRequest, NextResponse } from "next/server";
import { NOMINATIM_UA, normalizeNominatimAddress, parseLatLng } from "@/lib/nominatim";
import type { ReverseResponse } from "@/lib/types";

/**
 * Proxy server ke Nominatim reverse geocoding (WAJIB lewat server sesuai
 * kebijakan pemakaian Nominatim; jangan dipanggil langsung dari browser).
 */
export async function GET(req: NextRequest) {
  const coords = parseLatLng(req.nextUrl.searchParams);
  if (!coords) {
    return NextResponse.json(
      { error: "Parameter lat & lng tidak valid." },
      { status: 400 },
    );
  }
  const { lat, lng } = coords;

  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18&accept-language=id`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_UA, "Accept-Language": "id" },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return NextResponse.json(
      { error: "Layanan peta (Nominatim) tidak terjangkau saat ini." },
      { status: 502 },
    );
  }
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Nominatim membalas status ${upstream.status}.` },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as {
    display_name?: string;
    address?: Record<string, string>;
    error?: string;
  };

  const { components, houseNumberDetected, rwDetected } = normalizeNominatimAddress(data.address);
  const body: ReverseResponse = {
    found: !data.error,
    components,
    houseNumberDetected,
    rwDetected,
    displayName: data.display_name ?? "",
  };

  return NextResponse.json(body, {
    headers: {
      // Hasil untuk satu titik stabil; cache di tepi jaringan secukupnya.
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
