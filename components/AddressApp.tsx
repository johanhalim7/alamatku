"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  AddressResult,
  CrossCheck,
  DesaCandidate,
  DesaResponse,
  Landmark,
  NearbyResponse,
  ReverseResponse,
  RtRwHint,
  SavedAddress,
  SearchItem,
} from "@/lib/types";
import { EMPTY_COMPONENTS } from "@/lib/types";
import { computePlusCode, completeness, formatOneLine, formatShopee, mapsUrl } from "@/lib/format";
import { fetchCrossCheck } from "@/lib/bigdatacloud";
import { arbitrateComponents } from "@/lib/arbitrate";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[340px] animate-pulse items-center justify-center rounded-2xl border border-gray-200 bg-gray-100 text-sm text-gray-500 sm:h-[400px]">
      Memuat peta…
    </div>
  ),
});

const LS_KEY = "alamatku:saved";
type Phase = "idle" | "locating" | "done" | "denied" | "error";
type StepState = "done" | "active" | "todo";

interface PostcodeConflict {
  nominatim: string;
  bigdatacloud: string;
}

const inputCls =
  "w-full rounded-xl border border-gray-300 bg-gray-50/60 px-3.5 py-2.5 text-[15px] text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/15";
const labelCls = "mb-1.5 block text-[13px] font-semibold text-gray-700";
const cardCls =
  "mt-4 rounded-3xl border border-gray-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,0.06),0_10px_30px_-12px_rgba(16,24,40,0.14)] sm:p-5";
const chipCls =
  "rounded-full border border-teal-700/60 bg-teal-50/60 px-3 py-1.5 text-xs font-semibold text-teal-900 transition hover:bg-teal-100 active:scale-95";

/** Kelas kolom isian: kuning lembut bila komponen kunci ini masih kosong. */
const fieldCls = (value: string) =>
  value.trim()
    ? inputCls
    : `${inputCls} border-amber-300 bg-amber-50/70 focus:border-amber-400 focus:ring-amber-400/20`;

function distMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ---------- ikon (SVG sebaris, tanpa dependensi baru) ---------- */

function Svg({
  children,
  className,
  filled,
}: {
  children: React.ReactNode;
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-5 w-5"}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const IconPin = ({ className }: { className?: string }) => (
  <Svg filled className={className}>
    <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
  </Svg>
);
const IconTarget = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Svg>
);
const IconSearch = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.8-3.8" />
  </Svg>
);
const IconCheck = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
const IconCopy = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);
const IconShare = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </Svg>
);
const IconBookmark = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </Svg>
);

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className ?? "h-5 w-5"}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- komponen presentasi ---------- */

function CopyButton({
  copyKey,
  copiedKey,
  text,
  onCopy,
  children,
}: {
  copyKey: string;
  copiedKey: string;
  text: string;
  onCopy: (key: string, text: string) => void;
  children: React.ReactNode;
}) {
  const done = copiedKey === copyKey;
  return (
    <button
      type="button"
      onClick={() => onCopy(copyKey, text)}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white shadow-sm transition active:scale-95 ${
        done ? "bg-emerald-600" : "bg-teal-700 hover:bg-teal-800"
      }`}
    >
      {done ? (
        <>
          <IconCheck className="h-3.5 w-3.5" /> Tersalin
        </>
      ) : (
        <>
          <IconCopy className="h-3.5 w-3.5" /> {children}
        </>
      )}
    </button>
  );
}

function StepHeader({ n, title, state }: { n: number; title: string; state: StepState }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
          state === "done"
            ? "bg-emerald-500 text-white"
            : state === "active"
              ? "bg-gradient-to-br from-teal-700 to-emerald-600 text-white shadow-md shadow-teal-700/25"
              : "bg-gray-100 text-gray-400"
        }`}
      >
        {state === "done" ? <IconCheck className="h-4 w-4" /> : n}
      </span>
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      {state === "done" && (
        <span className="ml-auto rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
          Selesai
        </span>
      )}
    </div>
  );
}

function Stepper({ steps }: { steps: Array<{ label: string; state: StepState }> }) {
  return (
    <ol className="mt-5 flex items-start">
      {steps.map((s, i) => (
        <li key={s.label} className={`flex items-center ${i < steps.length - 1 ? "flex-1" : ""}`}>
          <div className="flex flex-col items-center gap-1.5">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-extrabold transition ${
                s.state === "done"
                  ? "bg-white text-teal-800"
                  : s.state === "active"
                    ? "bg-white/15 text-white ring-2 ring-white shadow-[0_0_0_4px_rgba(255,255,255,0.18)]"
                    : "bg-white/10 text-white/60 ring-1 ring-white/25"
              }`}
            >
              {s.state === "done" ? <IconCheck className="h-4 w-4" /> : i + 1}
            </span>
            <span
              className={`text-[11px] font-semibold ${s.state === "todo" ? "text-white/55" : "text-white/90"}`}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className="mx-2 mb-5 h-0.5 flex-1 overflow-hidden rounded-full bg-white/20">
              <div
                className={`h-full rounded-full bg-white transition-all duration-500 ${
                  s.state === "done" ? "w-full" : "w-0"
                }`}
              />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function AddressApp() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [geoError, setGeoError] = useState("");
  const [liveAccuracy, setLiveAccuracy] = useState<number | null>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [posVersion, setPosVersion] = useState(0);
  const [addr, setAddr] = useState<AddressResult | null>(null);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [addressNote, setAddressNote] = useState("");
  const [conflict, setConflict] = useState<PostcodeConflict | null>(null);
  const [crossCheck, setCrossCheck] = useState<CrossCheck | null>(null);
  const [desaOptions, setDesaOptions] = useState<DesaCandidate[]>([]);
  const [desaNote, setDesaNote] = useState("");
  const [rtRwHints, setRtRwHints] = useState<RtRwHint[]>([]);
  const [rtRwNote, setRtRwNote] = useState("");

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchItem[]>([]);
  const [searchNote, setSearchNote] = useState("");

  const [patokanManual, setPatokanManual] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");
  const [saveLabel, setSaveLabel] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [saved, setSaved] = useState<SavedAddress[]>([]);

  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bestRef = useRef<{ lat: number; lng: number; acc: number } | null>(null);
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addrRef = useRef<AddressResult | null>(null);
  const savedRef = useRef<SavedAddress[]>([]);

  useEffect(() => {
    addrRef.current = addr;
  }, [addr]);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  /* ---------- muat alamat tersimpan ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      // Pola baku membaca penyimpanan eksternal (localStorage) saat mount;
      // tidak ada cara lain yang menghindari setState di effect untuk ini.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setSaved(JSON.parse(raw) as SavedAddress[]);
    } catch {
      /* abaikan data rusak */
    }
  }, []);

  const persistSaved = useCallback((next: SavedAddress[]) => {
    setSaved(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* penyimpanan penuh/ditolak */
    }
  }, []);

  /* ---------- salin ---------- */
  const copyText = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? "" : k)), 2000);
  }, []);

  /* ---------- inti: hitung alamat dari koordinat ---------- */
  const lookup = useCallback(
    async (lat: number, lng: number, accuracy: number | null) => {
      setLoadingAddress(true);
      setAddressNote("");
      const [revSettled, crossSettled, nearSettled] = await Promise.allSettled([
        fetch(`/api/reverse?lat=${lat}&lng=${lng}`).then(async (r) => {
          if (!r.ok) throw new Error("reverse gagal");
          return (await r.json()) as ReverseResponse;
        }),
        fetchCrossCheck(lat, lng),
        fetch(`/api/nearby?lat=${lat}&lng=${lng}`).then(async (r) => {
          if (!r.ok) throw new Error("nearby gagal");
          return (await r.json()) as NearbyResponse;
        }),
      ]);

      const rev = revSettled.status === "fulfilled" ? revSettled.value : null;
      const cross = crossSettled.status === "fulfilled" ? crossSettled.value : null;
      const landmarks = nearSettled.status === "fulfilled" ? nearSettled.value.landmarks : [];
      const hints = nearSettled.status === "fulfilled" ? nearSettled.value.rtRwHints ?? [] : [];
      setRtRwHints(hints);
      setCrossCheck(cross);

      // BigDataCloud menjadi wasit tingkat administrasi (kelurahan/kecamatan/
      // kota) lewat arbitrateComponents — bukan sekadar pengisi slot kosong.
      const { components: arbitrated, postcodeConflict: newConflict } = arbitrateComponents(
        { ...(rev?.components ?? EMPTY_COMPONENTS) },
        cross,
      );
      setConflict(newConflict);
      const comps = { ...arbitrated };

      // Lapisan data wilayah resmi (Kemendagri): di pedesaan, peta sering
      // tidak punya desa pengguna sama sekali (kasus Kondangsari, Beber —
      // peta hanya tahu nama kecamatannya). Dataset desa + pusat desanya
      // menambal lubang itu; AI (bila aktif) menjadi wasit di antara kandidat.
      setDesaOptions([]);
      setDesaNote("");
      let desaRes: DesaResponse | null = null;
      try {
        const r = await fetch(
          `/api/desa?lat=${lat}&lng=${lng}&postcode=${encodeURIComponent(comps.postcode || "")}`,
        );
        if (r.ok) desaRes = (await r.json()) as DesaResponse;
      } catch {
        /* dataset pelengkap saja; diam-diam lanjut tanpa itu */
      }
      if (desaRes && desaRes.nearest.length > 0) {
        const top = desaRes.nearest[0];
        const ruralPattern = !comps.cityDistrict || !comps.village;
        if (ruralPattern && (top.distanceKm ?? 99) <= 6) {
          let chosen: DesaCandidate = top;
          let aiReason = "";
          try {
            const rr = await fetch("/api/resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lat,
                lng,
                road: comps.road,
                village: comps.village,
                cityDistrict: comps.cityDistrict,
                city: comps.city,
                state: comps.state,
                postcode: comps.postcode,
                candidates: desaRes.nearest,
                kecamatanVillages: desaRes.kecamatanVillages,
              }),
            });
            const rj = (await rr.json()) as {
              ai?: boolean;
              resolution?: { village: string; cityDistrict: string; reason: string };
            };
            if (rj?.ai && rj.resolution?.village) {
              const pick =
                desaRes.nearest.find((c) => c.village === rj.resolution!.village) ??
                (desaRes.kecamatanVillages.includes(rj.resolution.village)
                  ? { ...top, village: rj.resolution.village, cityDistrict: rj.resolution.cityDistrict || top.cityDistrict }
                  : null);
              if (pick) {
                chosen = pick;
                aiReason = rj.resolution.reason;
              }
            }
          } catch {
            /* AI opsional; peringkat jarak dataset tetap dipakai */
          }
          comps.village = chosen.village;
          if (!comps.cityDistrict) comps.cityDistrict = chosen.cityDistrict;
          if (!comps.city) comps.city = chosen.city;
          if (!comps.state) comps.state = chosen.state;
          if (!comps.postcode) comps.postcode = chosen.postcode;
          setDesaOptions(desaRes.nearest.filter((c) => c.village !== chosen.village));
          setDesaNote(
            aiReason
              ? `Desamu ditebak dari data wilayah resmi dan diperiksa AI: ${aiReason} Ketuk desa lain di bawah bila keliru.`
              : `Desamu ditebak dari data wilayah resmi (pusat desa terdekat, ±${(top.distanceKm ?? 0).toFixed(1)} km dari titikmu). Ketuk desa lain di bawah bila keliru.`,
          );
        } else if (top.village.toLowerCase() !== (comps.village || "").toLowerCase()) {
          // Pola kota (peta sudah lengkap): jangan menimpa hasil peta, cukup
          // tawarkan kandidat resmi sebagai opsi sekali ketuk.
          setDesaOptions(desaRes.nearest.slice(0, 4));
          setDesaNote(
            "Data wilayah resmi menunjuk desa terdekat yang berbeda dari hasil peta — ketuk untuk mengganti bila hasil peta keliru.",
          );
        }
      }

      if (!rev && !cross) {
        setAddressNote(
          "Layanan peta sedang tidak terjangkau. Komponen alamat dapat diisi manual di bawah ini.",
        );
      } else if (rev && !rev.found) {
        setAddressNote(
          "Titik ini belum terpetakan detail di OpenStreetMap. Silakan lengkapi komponen alamat secara manual.",
        );
      }

      const prev = addrRef.current;
      let rt = prev?.rt ?? "";
      let rw = prev?.rw || rev?.rwDetected || "";
      if (!rt && rev?.rtDetected) rt = rev.rtDetected;

      // Ingatan lokasi: alamat tersimpan dalam radius 250 m yang RT/RW-nya
      // sudah pernah diisi menjadi sumber isian otomatis — cukup isi sekali,
      // setelahnya titik yang sama selalu terisi sendiri.
      let savedLabel = "";
      if (!rt || !rw) {
        const nearSaved = savedRef.current.find(
          (s) => (s.data.rt || s.data.rw) && distMeters(lat, lng, s.data.lat, s.data.lng) <= 250,
        );
        if (nearSaved) {
          if (!rt) rt = nearSaved.data.rt;
          if (!rw) rw = nearSaved.data.rw;
          if (rt || rw) savedLabel = nearSaved.label || "alamat tersimpan";
        }
      }
      setRtRwNote(
        savedLabel
          ? `RT/RW diisi dari alamat tersimpanmu "${savedLabel}" di dekat titik ini — periksa bila belum pas.`
          : "",
      );

      setAddr({
        ...comps,
        houseNumber: prev?.houseNumber || rev?.houseNumberDetected || "",
        rt,
        rw,
        building: prev?.building ?? "",
        // Patokan pilihan/ketikan pengguna dipertahankan; daftar kandidat diperbarui.
        patokan: prev?.patokan ?? "",
        lat,
        lng,
        accuracyMeters: accuracy,
        plusCode: computePlusCode(lat, lng),
        displayName: rev?.displayName ?? prev?.displayName ?? "",
        landmarks,
      });
      setLoadingAddress(false);
    },
    [],
  );

  /* ---------- deteksi GPS ---------- */
  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const finishDetection = useCallback(() => {
    stopWatch();
    const best = bestRef.current;
    if (!best) return;
    setPhase("done");
    setPos({ lat: best.lat, lng: best.lng });
    setPosVersion((v) => v + 1);
    void lookup(best.lat, best.lng, Math.round(best.acc));
  }, [lookup, stopWatch]);

  const startDetection = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setPhase("denied");
      setGeoError("Perangkat/browser ini tidak mendukung GPS. Gunakan pencarian manual di bawah.");
      return;
    }
    stopWatch();
    bestRef.current = null;
    setLiveAccuracy(null);
    setGeoError("");
    setPhase("locating");

    watchIdRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude, longitude, accuracy } = p.coords;
        setLiveAccuracy(Math.round(accuracy));
        if (!bestRef.current || accuracy < bestRef.current.acc) {
          bestRef.current = { lat: latitude, lng: longitude, acc: accuracy };
        }
        if (accuracy <= 20) finishDetection();
      },
      (err) => {
        stopWatch();
        if (err.code === err.PERMISSION_DENIED) {
          setPhase("denied");
          setGeoError(
            "Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini (ikon gembok di kolom alamat browser → Izin lokasi → Izinkan), atau pakai pencarian manual di bawah.",
          );
        } else if (bestRef.current) {
          finishDetection();
        } else {
          setPhase("error");
          setGeoError(
            "Sinyal GPS tidak ditemukan. Coba di area terbuka (dekat jendela/teras), atau pakai pencarian manual di bawah.",
          );
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );

    timerRef.current = setTimeout(() => {
      if (bestRef.current) {
        finishDetection();
      } else {
        stopWatch();
        setPhase("error");
        setGeoError(
          "GPS terlalu lama merespons (20 detik). Coba lagi di area terbuka, atau pakai pencarian manual di bawah.",
        );
      }
    }, 20000);
  }, [finishDetection, stopWatch]);

  /* ---------- pencarian manual ---------- */
  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 3) {
      setSearchNote("Ketik minimal 3 huruf nama tempat/jalan/kawasan.");
      return;
    }
    setSearching(true);
    setSearchNote("");
    setResults([]);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const j = (await r.json()) as { results?: SearchItem[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? "Pencarian gagal");
      const items = j.results ?? [];
      setResults(items);
      if (items.length === 0) setSearchNote("Tidak ditemukan. Coba kata kunci lain, mis. nama jalan + kota.");
    } catch (e) {
      setSearchNote(e instanceof Error ? e.message : "Pencarian gagal.");
    } finally {
      setSearching(false);
    }
  }, [query]);

  const pickSearch = useCallback(
    (item: SearchItem) => {
      setResults([]);
      setPhase("done");
      setPos({ lat: item.lat, lng: item.lng });
      setPosVersion((v) => v + 1);
      void lookup(item.lat, item.lng, null);
    },
    [lookup],
  );

  const onDragEnd = useCallback(
    (lat: number, lng: number) => {
      if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
      dragTimerRef.current = setTimeout(() => {
        setPos({ lat, lng });
        void lookup(lat, lng, null);
      }, 400);
    },
    [lookup],
  );

  /* ---------- simpan ---------- */
  const saveCurrent = useCallback(() => {
    if (!addr) return;
    const label = saveLabel.trim() || "Rumah";
    const item: SavedAddress = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      isPrimary: saved.length === 0,
      savedAt: Date.now(),
      data: addr,
    };
    persistSaved([item, ...saved]);
    setSaveLabel("");
    setShowSave(false);
  }, [addr, saveLabel, saved, persistSaved]);

  const setPrimary = useCallback(
    (id: string) => persistSaved(saved.map((s) => ({ ...s, isPrimary: s.id === id }))),
    [saved, persistSaved],
  );

  const removeSaved = useCallback(
    (id: string) => {
      const next = saved.filter((s) => s.id !== id);
      if (next.length && !next.some((s) => s.isPrimary)) next[0].isPrimary = true;
      persistSaved(next);
    },
    [saved, persistSaved],
  );

  /* ---------- bagikan ---------- */
  const shareAddress = useCallback(async () => {
    if (!addr) return;
    const text = `${formatOneLine(addr)}\nPatokan: ${addr.patokan || "-"}\nPeta: ${mapsUrl(addr.lat, addr.lng)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Alamat saya — AlamatKu", text });
        return;
      } catch {
        /* dibatalkan pengguna */
        return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }, [addr]);

  const setField = <K extends keyof AddressResult>(key: K, value: AddressResult[K]) =>
    setAddr((prev) => (prev ? { ...prev, [key]: value } : prev));

  /** Terapkan kandidat desa resmi (chip) ke formulir. */
  const pickDesa = (c: DesaCandidate) => {
    setAddr((prev) =>
      prev
        ? {
            ...prev,
            village: c.village,
            cityDistrict: c.cityDistrict || prev.cityDistrict,
            city: prev.city || c.city,
            state: prev.state || c.state,
            postcode: prev.postcode || c.postcode,
          }
        : prev,
    );
    setDesaOptions((opts) => opts.filter((o) => o.village !== c.village));
    setDesaNote(`Desa diganti ke ${c.village} sesuai pilihanmu.`);
  };

  /** Terapkan petunjuk RT/RW dari alamat tempat terdekat. */
  const pickRtRwHint = (h: RtRwHint) => {
    setAddr((prev) => (prev ? { ...prev, rt: h.rt || prev.rt, rw: h.rw || prev.rw } : prev));
    setRtRwNote(
      `RT/RW diisi dari alamat ${h.sourceName} (±${h.distanceMeters} m dari titikmu) — pastikan sama dengan blok rumahmu.`,
    );
  };

  const comp = addr ? completeness(addr) : { filled: 0, total: 7, missing: [] as string[] };
  const isComplete = addr != null && comp.filled === comp.total;

  const steps: Array<{ label: string; state: StepState }> = [
    { label: "Deteksi", state: phase === "done" ? "done" : "active" },
    { label: "Peta", state: addr && !loadingAddress ? "done" : pos ? "active" : "todo" },
    { label: "Alamat", state: isComplete ? "done" : addr ? "active" : "todo" },
    { label: "Salin", state: addr ? "active" : "todo" },
  ];

  return (
    <div className="min-h-full bg-gradient-to-b from-teal-50/80 via-gray-50 to-gray-100">
      <main className="mx-auto w-full max-w-xl px-4 pb-40">
        {/* ===== Hero ===== */}
        <header className="animate-fade-up mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-teal-800 via-teal-700 to-emerald-600 p-5 text-white shadow-lg shadow-teal-900/20">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30">
              <IconPin className="h-6 w-6 text-white" />
            </span>
            <div>
              <h1 className="text-2xl font-extrabold leading-tight tracking-tight">AlamatKu</h1>
              <p className="text-xs font-medium text-white/75">Alamat lengkapmu, tanpa menebak</p>
            </div>
            <span className="ml-auto rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ring-white/25">
              GRATIS
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/90">
            Tahu alamat lengkap tempat tinggalmu — detail, akurat, siap ditempel ke Shopee. Berdiri di
            rumahmu, tekan deteksi, selesai.
          </p>
          <Stepper steps={steps} />
        </header>

        {/* ===== Deteksi ===== */}
        <section className={`${cardCls} animate-fade-up`}>
          <StepHeader n={1} title="Deteksi Lokasi Saya" state={phase === "done" ? "done" : "active"} />
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            Berdiri di rumah/kost kamu, lalu tekan tombol ini. GPS akan membaca posisimu seakurat
            mungkin.
          </p>
          <button
            type="button"
            onClick={startDetection}
            disabled={phase === "locating"}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-600 px-4 py-4 text-base font-bold text-white shadow-md shadow-teal-700/25 transition hover:brightness-105 active:scale-[0.99] disabled:opacity-70"
          >
            {phase === "locating" ? (
              <>
                <Spinner /> Membaca GPS…
              </>
            ) : (
              <>
                <IconTarget className="h-5 w-5" />
                {phase === "done" ? "Deteksi Ulang Lokasi Saya" : "Deteksi Lokasi Saya"}
              </>
            )}
          </button>

          {phase === "locating" && (
            <div className="mt-3 rounded-2xl bg-teal-50 p-3.5 text-sm text-teal-900 ring-1 ring-teal-100">
              <p className="flex items-center gap-2 font-medium">
                <Spinner className="h-4 w-4" /> Sedang membaca GPS… tetap di tempatmu.
              </p>
              {liveAccuracy != null && (
                <div className="mt-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      Akurasi saat ini: <b>±{liveAccuracy} meter</b>
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-bold ${
                        liveAccuracy <= 20
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {liveAccuracy <= 20 ? "Tajam" : "Menajam…"}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-teal-100">
                    <div
                      className="h-full rounded-full bg-teal-600 transition-all duration-500"
                      style={{
                        width: `${Math.max(8, Math.min(100, (1 - Math.min(liveAccuracy, 100) / 100) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {phase === "done" && addr && (
            <div className="mt-3 flex items-start gap-2.5 rounded-2xl bg-emerald-50 p-3.5 text-sm text-emerald-900 ring-1 ring-emerald-100">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                <IconCheck className="h-3 w-3" />
              </span>
              <p>
                Posisi terkunci
                {addr.accuracyMeters != null ? (
                  <>
                    {" "}
                    dengan akurasi <b>±{addr.accuracyMeters} meter</b>.
                  </>
                ) : (
                  " dari titik yang kamu pilih."
                )}{" "}
                Periksa peta di bawah — geser pin bila meleset.
              </p>
            </div>
          )}

          {(phase === "denied" || phase === "error") && (
            <div className="mt-3 rounded-2xl bg-amber-50 p-3.5 text-sm text-amber-900 ring-1 ring-amber-200">
              <p>{geoError}</p>
              <button
                type="button"
                className="mt-2 font-semibold text-teal-800 underline"
                onClick={() => {
                  document.getElementById("pencarian")?.scrollIntoView({ behavior: "smooth" });
                  searchRef.current?.focus({ preventScroll: true });
                }}
              >
                Ke pencarian manual ↓
              </button>
            </div>
          )}
        </section>

        {/* ===== Pencarian manual ===== */}
        <section id="pencarian" className={cardCls}>
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700 ring-1 ring-teal-100">
              <IconSearch className="h-4 w-4" />
            </span>
            <h2 className="text-base font-bold text-gray-900">Atau cari alamat secara manual</h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            Untuk alamat lokasi lain (mis. rumah orang tua) atau bila GPS tidak bisa dipakai.
          </p>
          <div className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void doSearch()}
                placeholder="cth: Jalan Sudirman, Jakarta / nama kawasan"
                className={`${inputCls} pl-10`}
              />
            </div>
            <button
              type="button"
              onClick={() => void doSearch()}
              disabled={searching}
              className="shrink-0 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 active:scale-95 disabled:opacity-60"
            >
              {searching ? "Mencari…" : "Cari"}
            </button>
          </div>
          {searchNote && <p className="mt-2 text-sm text-gray-500">{searchNote}</p>}
          {results.length > 0 && (
            <ul className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200">
              {results.map((r, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => pickSearch(r)}
                    className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left text-sm leading-relaxed text-gray-800 transition hover:bg-teal-50"
                  >
                    <IconPin className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                    <span>{r.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ===== Peta + hasil ===== */}
        {pos && (
          <section className={`${cardCls} animate-fade-up`}>
            <StepHeader
              n={2}
              title="Periksa Titik di Peta"
              state={addr && !loadingAddress ? "done" : "active"}
            />
            <div className="mt-3">
              <MapView
                lat={pos.lat}
                lng={pos.lng}
                accuracyMeters={addr?.accuracyMeters ?? null}
                positionVersion={posVersion}
                onDragEnd={onDragEnd}
              />
            </div>
            {loadingAddress && (
              <p className="mt-3 flex items-center gap-2 text-sm font-medium text-teal-800">
                <Spinner className="h-4 w-4" /> Menghitung alamat dari titik ini…
              </p>
            )}
            {addressNote && (
              <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                {addressNote}
              </p>
            )}
          </section>
        )}

        {addr && (
          <>
            {/* ===== Komponen alamat ===== */}
            <section className={`${cardCls} animate-fade-up`}>
              <StepHeader n={3} title="Komponen Alamat" state="active" />
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                Hasil deteksi otomatis — periksa, dan betulkan bila ada yang keliru. Kolom kuning
                masih kosong dan perlu diisi.
              </p>
              {addr.displayName && (
                <p className="mt-3 break-words rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-500 ring-1 ring-gray-100">
                  <span className="font-semibold text-gray-600">Hasil peta:</span> {addr.displayName}
                </p>
              )}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelCls} htmlFor="f-road">Nama jalan</label>
                  <input id="f-road" className={fieldCls(addr.road)} value={addr.road} onChange={(e) => setField("road", e.target.value)} placeholder="cth: Jl. Cendana Raya" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="f-village">Kelurahan / Desa</label>
                  <input id="f-village" className={fieldCls(addr.village)} value={addr.village} onChange={(e) => setField("village", e.target.value)} />
                  {desaOptions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {desaOptions.map((c) => (
                        <button
                          key={`${c.village}-${c.cityDistrict}`}
                          type="button"
                          onClick={() => pickDesa(c)}
                          className={chipCls}
                        >
                          {c.village}
                          {c.distanceKm != null ? ` · ${c.distanceKm.toFixed(1)} km` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                  {desaNote && <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{desaNote}</p>}
                </div>
                <div>
                  <label className={labelCls} htmlFor="f-district">Kecamatan</label>
                  <input id="f-district" className={fieldCls(addr.cityDistrict)} value={addr.cityDistrict} onChange={(e) => setField("cityDistrict", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="f-city">Kota / Kabupaten</label>
                  <input id="f-city" className={inputCls} value={addr.city} onChange={(e) => setField("city", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="f-state">Provinsi</label>
                  <input id="f-state" className={inputCls} value={addr.state} onChange={(e) => setField("state", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="f-postcode">Kode pos</label>
                  <input id="f-postcode" className={fieldCls(addr.postcode)} inputMode="numeric" value={addr.postcode} onChange={(e) => setField("postcode", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="f-neigh">Lingkungan / Kompleks</label>
                  <input id="f-neigh" className={inputCls} value={addr.neighbourhood} onChange={(e) => setField("neighbourhood", e.target.value)} />
                </div>
              </div>

              {conflict && (
                <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-3.5">
                  <p className="text-sm font-semibold text-amber-900">
                    Kode pos dari dua sumber berbeda — pilih yang benar sesuai wilayahmu:
                  </p>
                  <div className="mt-2 space-y-1.5 text-sm text-amber-900">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="postcode-choice"
                        checked={addr.postcode === conflict.nominatim}
                        onChange={() => setField("postcode", conflict.nominatim)}
                      />
                      {conflict.nominatim} <span className="text-xs">(OpenStreetMap)</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="postcode-choice"
                        checked={addr.postcode === conflict.bigdatacloud}
                        onChange={() => setField("postcode", conflict.bigdatacloud)}
                      />
                      {conflict.bigdatacloud} <span className="text-xs">(BigDataCloud)</span>
                    </label>
                  </div>
                </div>
              )}
              {crossCheck && !conflict && crossCheck.postcode && addr.postcode === crossCheck.postcode && (
                <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <IconCheck className="h-3.5 w-3.5" /> Kode pos terkonfirmasi sama oleh dua sumber.
                </p>
              )}
            </section>

            {/* ===== Lengkapi ===== */}
            <section className={`${cardCls} animate-fade-up`}>
              <StepHeader n={4} title="Lengkapi Detail" state={isComplete ? "done" : "active"} />
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                Nomor rumah, RT/RW, dan patokan hanya kamu yang tahu — isi sekali saja.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="f-house">Nomor rumah</label>
                  <input id="f-house" className={fieldCls(addr.houseNumber)} value={addr.houseNumber} onChange={(e) => setField("houseNumber", e.target.value)} placeholder="cth: 12 / 12A" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="f-building">Gedung / Kost / Kamar / Blok</label>
                  <input id="f-building" className={inputCls} value={addr.building} onChange={(e) => setField("building", e.target.value)} placeholder="cth: Kost Melati, Kamar 3" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="f-rt">RT</label>
                  <input id="f-rt" className={fieldCls(addr.rt)} inputMode="numeric" value={addr.rt} onChange={(e) => setField("rt", e.target.value)} placeholder="cth: 004" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="f-rw">RW</label>
                  <input id="f-rw" className={fieldCls(addr.rw)} inputMode="numeric" value={addr.rw} onChange={(e) => setField("rw", e.target.value)} placeholder="cth: 007" />
                </div>
                {(rtRwHints.length > 0 || rtRwNote) && (
                  <div className="col-span-2 rounded-2xl bg-teal-50/70 p-3 ring-1 ring-teal-100">
                    {rtRwHints.length > 0 && (
                      <>
                        <p className="text-xs leading-relaxed text-gray-600">
                          Petunjuk RT/RW dari alamat tempat terdekat yang terdaftar di peta — ketuk
                          bila sama dengan blok rumahmu:
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {rtRwHints.map((h, i) => (
                            <button
                              key={`${h.rt}-${h.rw}-${i}`}
                              type="button"
                              onClick={() => pickRtRwHint(h)}
                              className={chipCls}
                            >
                              RT {h.rt || "—"} / RW {h.rw || "—"} · {h.sourceName} ({h.distanceMeters} m)
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {rtRwNote && <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{rtRwNote}</p>}
                  </div>
                )}
                <div className="col-span-2">
                  <label className={labelCls} htmlFor="f-patokan">Patokan (membantu kurir menemukan rumahmu)</label>
                  {!patokanManual ? (
                    <select
                      id="f-patokan"
                      className={inputCls}
                      value={addr.patokan}
                      onChange={(e) => {
                        if (e.target.value === "__manual") {
                          setPatokanManual(true);
                          setField("patokan", "");
                        } else {
                          setField("patokan", e.target.value);
                        }
                      }}
                    >
                      <option value="">— Pilih patokan terdekat —</option>
                      {addr.landmarks.map((lm, i) => (
                        <option key={i} value={lm.name}>
                          {lm.name} ({lm.kind}, ±{lm.distanceMeters} m)
                        </option>
                      ))}
                      <option value="__manual">Tulis sendiri…</option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        id="f-patokan"
                        className={inputCls}
                        value={addr.patokan}
                        onChange={(e) => setField("patokan", e.target.value)}
                        placeholder="cth: Sebrang warteg, pagar hitam"
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-xl border border-gray-300 px-3 text-xs font-semibold text-gray-700 transition active:scale-95"
                        onClick={() => setPatokanManual(false)}
                      >
                        Pilih dari daftar
                      </button>
                    </div>
                  )}
                  {addr.landmarks.length === 0 && !patokanManual && (
                    <p className="mt-1 text-xs text-gray-500">
                      Tidak ada tempat bernama dalam 300 m di data peta — pilih &quot;Tulis sendiri…&quot;.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 rounded-2xl bg-gray-50 p-3.5 ring-1 ring-gray-100">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-800">
                    Kelengkapan: {comp.filled} dari {comp.total}
                  </span>
                  {isComplete ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                      <IconCheck className="h-3.5 w-3.5" /> LENGKAP
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                      {Math.round((comp.filled / comp.total) * 100)}%
                    </span>
                  )}
                </div>
                <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full transition-[width] duration-700 ${
                      isComplete ? "bg-emerald-500" : "bg-gradient-to-r from-teal-700 to-emerald-500"
                    }`}
                    style={{ width: `${(comp.filled / comp.total) * 100}%` }}
                  />
                </div>
                {!isComplete && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-gray-500">Masih kurang:</span>
                    {comp.missing.map((m) => (
                      <span
                        key={m}
                        className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* ===== Kartu alamat ===== */}
            <section
              id="hasil"
              className="animate-fade-up mt-4 rounded-3xl bg-gradient-to-br from-teal-700 via-teal-600 to-emerald-500 p-[1.5px] shadow-lg shadow-teal-900/15"
            >
              <div className="rounded-[22px] bg-white p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-700 to-emerald-600 text-sm font-extrabold text-white shadow-md shadow-teal-700/25">
                    5
                  </span>
                  <h2 className="text-base font-bold text-gray-900">Kartu Alamat Kamu</h2>
                  {isComplete && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">
                      <IconCheck className="h-3 w-3" /> SIAP PAKAI
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="pt-1.5 text-xs font-bold uppercase tracking-wide text-teal-800">
                      Format Shopee
                    </p>
                    <CopyButton copyKey="shopee" copiedKey={copiedKey} text={formatShopee(addr)} onCopy={copyText}>
                      Salin
                    </CopyButton>
                  </div>
                  <pre className="mt-1.5 whitespace-pre-wrap rounded-2xl bg-teal-50/80 p-3.5 font-sans text-sm leading-relaxed text-gray-900 ring-1 ring-teal-100">
                    {formatShopee(addr)}
                  </pre>
                </div>

                <div className="mt-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="pt-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
                      Alamat lengkap
                    </p>
                    <CopyButton copyKey="oneline" copiedKey={copiedKey} text={formatOneLine(addr)} onCopy={copyText}>
                      Salin
                    </CopyButton>
                  </div>
                  <p className="mt-1.5 rounded-2xl bg-gray-50 p-3.5 text-sm leading-relaxed text-gray-900 ring-1 ring-gray-100">
                    {formatOneLine(addr) || "—"}
                  </p>
                </div>

                <div className="mt-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="pt-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
                      Titik presisi
                    </p>
                    <CopyButton
                      copyKey="precise"
                      copiedKey={copiedKey}
                      text={`Plus Code: ${addr.plusCode}\nKoordinat: ${addr.lat.toFixed(6)}, ${addr.lng.toFixed(6)}\nPeta: ${mapsUrl(addr.lat, addr.lng)}`}
                      onCopy={copyText}
                    >
                      Salin
                    </CopyButton>
                  </div>
                  <div className="mt-1.5 space-y-1 text-sm text-gray-800">
                    <p>
                      Plus Code:{" "}
                      <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[13px] font-semibold">
                        {addr.plusCode || "-"}
                      </span>
                    </p>
                    <p>
                      Koordinat: {addr.lat.toFixed(6)}, {addr.lng.toFixed(6)}
                    </p>
                    <p>
                      <a
                        className="font-semibold text-teal-800 underline decoration-teal-300 underline-offset-2"
                        href={mapsUrl(addr.lat, addr.lng)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Buka titik ini di Google Maps
                      </a>
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void shareAddress()}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
                  >
                    <IconShare className="h-4 w-4" /> Bagikan
                  </button>
                  {!showSave ? (
                    <button
                      type="button"
                      onClick={() => setShowSave(true)}
                      className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800 active:scale-95"
                    >
                      <IconBookmark className="h-4 w-4" /> Simpan Alamat
                    </button>
                  ) : (
                    <span className="flex gap-2">
                      <input
                        value={saveLabel}
                        onChange={(e) => setSaveLabel(e.target.value)}
                        placeholder="Label: Rumah / Kost / Kantor"
                        className="w-44 rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/15"
                      />
                      <button
                        type="button"
                        onClick={saveCurrent}
                        className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition active:scale-95"
                      >
                        Simpan
                      </button>
                    </span>
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {/* ===== Tersimpan ===== */}
        <section className={cardCls}>
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700 ring-1 ring-teal-100">
              <IconBookmark className="h-4 w-4" />
            </span>
            <h2 className="text-base font-bold text-gray-900">Alamat Tersimpan</h2>
            {saved.length > 0 && (
              <span className="ml-auto rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
                {saved.length} alamat
              </span>
            )}
          </div>
          {saved.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 px-4 py-5 text-center">
              <IconPin className="mx-auto h-6 w-6 text-gray-300" />
              <p className="mt-2 text-sm leading-relaxed text-gray-500">
                Belum ada alamat tersimpan.
                <br />
                Alamat yang kamu simpan tinggal di perangkat ini saja — dan titik yang sama akan
                terisi RT/RW-nya otomatis lain kali.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {saved.map((s) => (
                <li
                  key={s.id}
                  className="rounded-2xl border border-gray-200 border-l-4 border-l-teal-600 p-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-gray-900">
                      {s.label}
                      {s.isPrimary && (
                        <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800">
                          UTAMA
                        </span>
                      )}
                    </p>
                    <CopyButton
                      copyKey={`saved-${s.id}`}
                      copiedKey={copiedKey}
                      text={formatOneLine(s.data)}
                      onCopy={copyText}
                    >
                      Salin
                    </CopyButton>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-gray-700">{formatOneLine(s.data)}</p>
                  <div className="mt-2.5 flex gap-4 text-xs font-semibold">
                    {!s.isPrimary && (
                      <button type="button" className="text-teal-800" onClick={() => setPrimary(s.id)}>
                        Jadikan utama
                      </button>
                    )}
                    <button type="button" className="text-red-600" onClick={() => removeSaved(s.id)}>
                      Hapus
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-6 px-2 text-center text-xs leading-relaxed text-gray-500">
          🔒 Privasi: koordinatmu hanya dikirim ke layanan peta (OpenStreetMap &amp; BigDataCloud)
          saat kamu mendeteksi/mencari alamat. Tidak ada pelacakan dan tidak ada data lokasi yang
          disimpan di server AlamatKu.
        </footer>
      </main>

      {/* ===== Bilah aksi lengket ===== */}
      {addr && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200/80 bg-white/92 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_28px_rgba(16,24,40,0.10)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-xl items-center gap-2.5 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-gray-900">
                {isComplete ? "Alamatmu sudah lengkap ✓" : `Kurang: ${comp.missing.join(", ")}`}
              </p>
              <p className="truncate text-xs text-gray-500">{formatOneLine(addr)}</p>
            </div>
            <button
              type="button"
              onClick={() => void shareAddress()}
              aria-label="Bagikan alamat"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-300 text-gray-700 transition active:scale-95"
            >
              <IconShare className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void copyText("shopee", formatShopee(addr))}
              className={`flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white shadow-md transition active:scale-95 ${
                copiedKey === "shopee"
                  ? "bg-emerald-600 shadow-emerald-600/25"
                  : "bg-gradient-to-r from-teal-700 to-emerald-600 shadow-teal-700/25"
              }`}
            >
              {copiedKey === "shopee" ? (
                <>
                  <IconCheck className="h-4.5 w-4.5" /> Tersalin
                </>
              ) : (
                <>
                  <IconCopy className="h-4.5 w-4.5" /> Salin Shopee
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
