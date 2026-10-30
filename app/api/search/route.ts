import { NextRequest, NextResponse } from "next/server";
import { NOMINATIM_UA, normalizeNominatimAddress } from "@/lib/nominatim";
import type { SearchItem } from "@/lib/types";

/** Proxy server ke Nominatim search untuk pencarian alamat manual. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 3) {
    return NextResponse.json(
      { error: "Kata kunci minimal 3 karakter." },
      { status: 400 },
    );
  }

  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2` +
    `&q=${encodeURIComponent(q)}&addressdetails=1&countrycodes=id&limit=5&accept-language=id`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_UA, "Accept-Language": "id" },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return NextResponse.json(
      { error: "Layanan pencarian (Nominatim) tidak terjangkau saat ini." },
      { status: 502 },
    );
  }
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Nominatim membalas status ${upstream.status}.` },
      { status: 502 },
    );
  }

  const rows = (await upstream.json()) as Array<{
    display_name?: string;
    lat?: string;
    lon?: string;
    address?: Record<string, string>;
  }>;

  const results: Array<SearchItem & { components: ReturnType<typeof normalizeNominatimAddress>["components"] }> =
    rows
      .filter((r) => r.lat && r.lon)
      .map((r) => ({
        displayName: r.display_name ?? "",
        lat: Number(r.lat),
        lng: Number(r.lon),
        components: normalizeNominatimAddress(r.address).components,
      }));

  return NextResponse.json(
    { results },
    { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } },
  );
}
