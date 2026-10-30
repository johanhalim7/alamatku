import { NextRequest, NextResponse } from "next/server";
import type { AiResolution, DesaCandidate } from "@/lib/types";

/**
 * Wasit AI (Gemini) untuk memilih desa yang benar dari kandidat RESMI.
 *
 * AI generatif tanpa data terbukti mengarang batas desa (kami uji: Gemini
 * menjawab "Desa Beber" dengan keyakinan tinggi untuk titik yang sebenarnya
 * di Desa Kondangsari). Karena itu AI di sini TIDAK bebas menebak: ia hanya
 * boleh memilih dari daftar kandidat dataset wilayah Kemendagri yang
 * diberikan, dengan mempertimbangkan nama jalan, kode pos, dan jarak ke
 * pusat desa. Pilihan di luar daftar dibuang.
 *
 * Bersifat opsional & memperkaya saja: tanpa GEMINI_API_KEY di environment
 * server, endpoint menjawab { ai: false } dan aplikasi memakai peringkat
 * jarak dataset apa adanya.
 */

interface ResolveBody {
  lat: number;
  lng: number;
  road?: string;
  village?: string;
  cityDistrict?: string;
  city?: string;
  state?: string;
  postcode?: string;
  candidates?: DesaCandidate[];
  kecamatanVillages?: string[];
}

const FALLBACK = { ai: false as const };

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json(FALLBACK);

  let body: ResolveBody;
  try {
    body = (await req.json()) as ResolveBody;
  } catch {
    return NextResponse.json(FALLBACK);
  }
  const candidates = body.candidates ?? [];
  if (candidates.length === 0) return NextResponse.json(FALLBACK);

  const allowed = new Set<string>([
    ...candidates.map((c) => c.village),
    ...(body.kecamatanVillages ?? []),
  ]);

  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const evidence = {
    koordinat: { lat: body.lat, lng: body.lng },
    jalan: body.road || "",
    hasilPetaSaatIni: {
      kelurahanDesa: body.village || "",
      kecamatan: body.cityDistrict || "",
      kotaKabupaten: body.city || "",
      provinsi: body.state || "",
      kodePos: body.postcode || "",
    },
    kandidatDesaResmi: candidates.map((c) => ({
      desa: c.village,
      kecamatan: c.cityDistrict,
      kabupaten: c.city,
      kodePos: c.postcode,
      jarakKePusatDesaKm: c.distanceKm,
    })),
    desaLainDalamKecamatan: (body.kecamatanVillages ?? []).filter(
      (v) => !candidates.some((c) => c.village === v),
    ),
  };

  const prompt =
    `Kamu adalah wasit data wilayah administrasi Indonesia. Tentukan kelurahan/desa ` +
    `yang paling mungkin memuat titik koordinat pengguna, HANYA dari daftar kandidat ` +
    `resmi yang diberikan (data Kemendagri). DILARANG menyebut nama desa di luar daftar.\n\n` +
    `Pertimbangan: jarak ke pusat desa (makin dekat makin mungkin, tapi bukan satu-satunya ` +
    `faktor), nama jalan, kode pos, dan pengetahuanmu tentang wilayah itu. Hasil peta saat ` +
    `ini sering keliru di pedesaan karena hanya memuat nama tempat terdekat.\n\n` +
    `DATA:\n${JSON.stringify(evidence, null, 1)}\n\n` +
    `Balas HANYA JSON: {"village":"<nama desa persis seperti di daftar>","cityDistrict":"<kecamatannya>",` +
    `"confidence":"tinggi|sedang|rendah","reason":"<satu kalimat alasan dalam Bahasa Indonesia>"}`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!resp.ok) return NextResponse.json(FALLBACK);
    const data = (await resp.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(text) as Partial<AiResolution>;
    if (!parsed.village || !allowed.has(parsed.village)) {
      return NextResponse.json(FALLBACK);
    }
    const fromCandidate = candidates.find((c) => c.village === parsed.village);
    const resolution: AiResolution = {
      village: parsed.village,
      cityDistrict: parsed.cityDistrict || fromCandidate?.cityDistrict || "",
      confidence:
        parsed.confidence === "tinggi" || parsed.confidence === "rendah"
          ? parsed.confidence
          : "sedang",
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
    return NextResponse.json({ ai: true, resolution });
  } catch {
    return NextResponse.json(FALLBACK);
  }
}
