import { NextRequest, NextResponse } from "next/server";
import { parseLatLng } from "@/lib/nominatim";
import { findDesaCandidates } from "@/lib/wilayah";
import type { DesaResponse } from "@/lib/types";

/**
 * Desa resmi terdekat menurut dataset wilayah Kemendagri (data/wilayah.json).
 * Menjawab lubang data OpenStreetMap/BigDataCloud di pedesaan, di mana desa
 * pengguna sering tidak ada sama sekali di peta (kasus nyata: Kondangsari,
 * Beber, Cirebon — kedua layanan peta hanya tahu "Beber").
 */
export async function GET(req: NextRequest) {
  const coords = parseLatLng(req.nextUrl.searchParams);
  if (!coords) {
    return NextResponse.json(
      { error: "Parameter lat & lng tidak valid." },
      { status: 400 },
    );
  }
  const postcode = req.nextUrl.searchParams.get("postcode") ?? "";

  try {
    const found = await findDesaCandidates(coords.lat, coords.lng, postcode);
    const body: DesaResponse = {
      nearest: found.nearest,
      kecamatan: found.kecamatan,
      kecamatanVillages: found.kecamatanVillages,
    };
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Dataset wilayah belum tersedia di server." },
      { status: 503 },
    );
  }
}
