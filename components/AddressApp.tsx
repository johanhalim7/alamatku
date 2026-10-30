"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  AddressResult,
  CrossCheck,
  Landmark,
  ReverseResponse,
  SavedAddress,
  SearchItem,
} from "@/lib/types";
import { EMPTY_COMPONENTS } from "@/lib/types";
import { computePlusCode, completeness, formatOneLine, formatShopee, mapsUrl } from "@/lib/format";
import { fetchCrossCheck } from "@/lib/bigdatacloud";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[320px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-500">
      Memuat peta…
    </div>
  ),
});

const LS_KEY = "alamatku:saved";
type Phase = "idle" | "locating" | "done" | "denied" | "error";

interface PostcodeConflict {
  nominatim: string;
  bigdatacloud: string;
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-teal-700 focus:ring-1 focus:ring-teal-700";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500";

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
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${done ? "bg-emerald-600" : "bg-teal-700 hover:bg-teal-800"}`}
    >
      {done ? "Tersalin ✓" : children}
    </button>
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
          return (await r.json()) as { landmarks: Landmark[] };
        }),
      ]);

      const rev = revSettled.status === "fulfilled" ? revSettled.value : null;
      const cross = crossSettled.status === "fulfilled" ? crossSettled.value : null;
      const landmarks = nearSettled.status === "fulfilled" ? nearSettled.value.landmarks : [];
      setCrossCheck(cross);

      const comps = { ...(rev?.components ?? EMPTY_COMPONENTS) };
      let newConflict: PostcodeConflict | null = null;

      if (cross) {
        if (!comps.village && cross.village) comps.village = cross.village;
        if (!comps.cityDistrict && cross.cityDistrict) comps.cityDistrict = cross.cityDistrict;
        if (!comps.city && cross.city) comps.city = cross.city;
        if (!comps.state && cross.state) comps.state = cross.state;
        if (comps.postcode && cross.postcode && comps.postcode !== cross.postcode) {
          // Jangan memilih diam-diam: pengguna yang memutuskan lewat radio.
          newConflict = { nominatim: comps.postcode, bigdatacloud: cross.postcode };
          comps.postcode = "";
        } else if (!comps.postcode && cross.postcode) {
          comps.postcode = cross.postcode;
        }
      }
      setConflict(newConflict);

      if (!rev && !cross) {
        setAddressNote(
          "Layanan peta sedang tidak terjangkau. Komponen alamat dapat diisi manual di bawah ini.",
        );
      } else if (rev && !rev.found) {
        setAddressNote(
          "Titik ini belum terpetakan detail di OpenStreetMap. Silakan lengkapi komponen alamat secara manual.",
        );
      }

      setAddr((prev) => ({
        ...comps,
        houseNumber: prev?.houseNumber || rev?.houseNumberDetected || "",
        rt: prev?.rt ?? "",
        rw: prev?.rw || rev?.rwDetected || "",
        building: prev?.building ?? "",
        // Patokan pilihan/ketikan pengguna dipertahankan; daftar kandidat diperbarui.
        patokan: prev?.patokan ?? "",
        lat,
        lng,
        accuracyMeters: accuracy,
        plusCode: computePlusCode(lat, lng),
        displayName: rev?.displayName ?? prev?.displayName ?? "",
        landmarks,
      }));
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

  const comp = addr ? completeness(addr) : { filled: 0, total: 7, missing: [] as string[] };
  const isComplete = addr != null && comp.filled === comp.total;

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16">
      {/* ===== Header ===== */}
      <header className="pb-2 pt-6 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-teal-800">AlamatKu</h1>
        <p className="mt-1 text-sm text-gray-600">
          Tahu alamat lengkap tempat tinggalmu — detail, akurat, siap ditempel ke Shopee.
        </p>
      </header>

      {/* ===== Deteksi ===== */}
      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-bold text-gray-900">1. Deteksi Lokasi Saya</h2>
        <p className="mt-1 text-sm text-gray-600">
          Berdiri di rumah/kost kamu, lalu tekan tombol ini. GPS akan membaca posisimu seakurat mungkin.
        </p>
        <button
          type="button"
          onClick={startDetection}
          disabled={phase === "locating"}
          className="mt-3 w-full rounded-xl bg-teal-700 px-4 py-3.5 text-base font-bold text-white shadow hover:bg-teal-800 disabled:opacity-60"
        >
          {phase === "locating" ? "Membaca GPS…" : "📍 Deteksi Lokasi Saya"}
        </button>

        {phase === "locating" && (
          <div className="mt-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-900">
            Sedang membaca GPS… tetap di tempatmu.
            {liveAccuracy != null && (
              <>
                {" "}
                Akurasi saat ini: <b>±{liveAccuracy} meter</b>
                {liveAccuracy > 20 ? " — menunggu bacaan yang lebih tajam…" : ""}
              </>
            )}
          </div>
        )}

        {phase === "done" && addr && (
          <p className="mt-3 text-sm text-gray-700">
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
        )}

        {(phase === "denied" || phase === "error") && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
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
      <section id="pencarian" className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-bold text-gray-900">Atau cari alamat secara manual</h2>
        <p className="mt-1 text-sm text-gray-600">
          Untuk alamat lokasi lain (mis. rumah orang tua) atau bila GPS tidak bisa dipakai.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void doSearch()}
            placeholder="cth: Jalan Sudirman, Jakarta / nama kawasan / gedung"
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => void doSearch()}
            disabled={searching}
            className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {searching ? "Mencari…" : "Cari"}
          </button>
        </div>
        {searchNote && <p className="mt-2 text-sm text-gray-500">{searchNote}</p>}
        {results.length > 0 && (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => pickSearch(r)}
                  className="block w-full px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-teal-50"
                >
                  {r.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== Peta + hasil ===== */}
      {pos && (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">2. Periksa Titik di Peta</h2>
          <div className="mt-3">
            <MapView
              lat={pos.lat}
              lng={pos.lng}
              accuracyMeters={addr?.accuracyMeters ?? null}
              positionVersion={posVersion}
              onDragEnd={onDragEnd}
            />
          </div>
          {loadingAddress && <p className="mt-2 text-sm text-teal-800">Menghitung alamat dari titik ini…</p>}
          {addressNote && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">{addressNote}</p>
          )}
        </section>
      )}

      {addr && (
        <>
          {/* ===== Komponen alamat ===== */}
          <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold text-gray-900">3. Komponen Alamat (hasil deteksi, bisa diedit)</h2>
            {addr.displayName && (
              <p className="mt-1 break-words text-xs text-gray-500">Hasil peta: {addr.displayName}</p>
            )}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="f-road">Nama jalan</label>
                <input id="f-road" className={inputCls} value={addr.road} onChange={(e) => setField("road", e.target.value)} placeholder="cth: Jl. Cendana Raya" />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-village">Kelurahan / Desa</label>
                <input id="f-village" className={inputCls} value={addr.village} onChange={(e) => setField("village", e.target.value)} />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-district">Kecamatan</label>
                <input id="f-district" className={inputCls} value={addr.cityDistrict} onChange={(e) => setField("cityDistrict", e.target.value)} />
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
                <input id="f-postcode" className={inputCls} inputMode="numeric" value={addr.postcode} onChange={(e) => setField("postcode", e.target.value)} />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-neigh">Lingkungan / Kompleks</label>
                <input id="f-neigh" className={inputCls} value={addr.neighbourhood} onChange={(e) => setField("neighbourhood", e.target.value)} />
              </div>
            </div>

            {conflict && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
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
              <p className="mt-2 text-xs text-emerald-700">✓ Kode pos terkonfirmasi sama oleh dua sumber.</p>
            )}
          </section>

          {/* ===== Lengkapi ===== */}
          <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold text-gray-900">4. Lengkapi (hanya kamu yang tahu)</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="f-house">Nomor rumah</label>
                <input id="f-house" className={inputCls} value={addr.houseNumber} onChange={(e) => setField("houseNumber", e.target.value)} placeholder="cth: 12 / 12A" />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-building">Gedung / Kost / Kamar / Blok</label>
                <input id="f-building" className={inputCls} value={addr.building} onChange={(e) => setField("building", e.target.value)} placeholder="cth: Kost Melati, Kamar 3" />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-rt">RT</label>
                <input id="f-rt" className={inputCls} inputMode="numeric" value={addr.rt} onChange={(e) => setField("rt", e.target.value)} placeholder="cth: 004" />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-rw">RW</label>
                <input id="f-rw" className={inputCls} inputMode="numeric" value={addr.rw} onChange={(e) => setField("rw", e.target.value)} placeholder="cth: 007" />
              </div>
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
                      className="shrink-0 rounded-lg border border-gray-300 px-3 text-xs font-semibold text-gray-700"
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

            <div className="mt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-gray-800">
                  Kelengkapan: {comp.filled} dari {comp.total} komponen
                </span>
                {isComplete ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                    LENGKAP ✓
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                    Kurang: {comp.missing.join(", ")}
                  </span>
                )}
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full ${isComplete ? "bg-emerald-500" : "bg-teal-600"}`}
                  style={{ width: `${(comp.filled / comp.total) * 100}%` }}
                />
              </div>
            </div>
          </section>

          {/* ===== Kartu alamat ===== */}
          <section className="mt-4 rounded-2xl border-2 border-teal-700 bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold text-gray-900">5. Kartu Alamat Kamu</h2>

            <div className="mt-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Alamat lengkap</p>
                <CopyButton copyKey="oneline" copiedKey={copiedKey} text={formatOneLine(addr)} onCopy={copyText}>
                  Salin
                </CopyButton>
              </div>
              <p className="mt-1 rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-900">
                {formatOneLine(addr) || "—"}
              </p>
            </div>

            <div className="mt-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Format Shopee</p>
                <CopyButton copyKey="shopee" copiedKey={copiedKey} text={formatShopee(addr)} onCopy={copyText}>
                  Salin
                </CopyButton>
              </div>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 font-sans text-sm leading-relaxed text-gray-900">
                {formatShopee(addr)}
              </pre>
            </div>

            <div className="mt-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Titik presisi</p>
                <CopyButton
                  copyKey="precise"
                  copiedKey={copiedKey}
                  text={`Plus Code: ${addr.plusCode}\nKoordinat: ${addr.lat.toFixed(6)}, ${addr.lng.toFixed(6)}\nPeta: ${mapsUrl(addr.lat, addr.lng)}`}
                  onCopy={copyText}
                >
                  Salin
                </CopyButton>
              </div>
              <p className="mt-1 text-sm text-gray-800">
                Plus Code: <b>{addr.plusCode || "-"}</b>
                <br />
                Koordinat: {addr.lat.toFixed(6)}, {addr.lng.toFixed(6)}
                <br />
                <a
                  className="font-semibold text-teal-800 underline"
                  href={mapsUrl(addr.lat, addr.lng)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Buka titik ini di Google Maps
                </a>
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void shareAddress()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Bagikan
              </button>
              {!showSave ? (
                <button
                  type="button"
                  onClick={() => setShowSave(true)}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
                >
                  Simpan Alamat
                </button>
              ) : (
                <span className="flex gap-2">
                  <input
                    value={saveLabel}
                    onChange={(e) => setSaveLabel(e.target.value)}
                    placeholder="Label: Rumah / Kost / Kantor"
                    className="w-44 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={saveCurrent}
                    className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Simpan
                  </button>
                </span>
              )}
            </div>
          </section>
        </>
      )}

      {/* ===== Tersimpan ===== */}
      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-bold text-gray-900">Alamat Tersimpan</h2>
        {saved.length === 0 ? (
          <p className="mt-1 text-sm text-gray-500">
            Belum ada alamat tersimpan. Alamat yang kamu simpan tinggal di perangkat ini saja.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {saved.map((s) => (
              <li key={s.id} className="rounded-xl border border-gray-200 p-3">
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
                <p className="mt-1 text-sm leading-relaxed text-gray-700">{formatOneLine(s.data)}</p>
                <div className="mt-2 flex gap-3 text-xs font-semibold">
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

      <footer className="mt-6 text-center text-xs leading-relaxed text-gray-500">
        Privasi: koordinatmu hanya dikirim ke layanan peta (OpenStreetMap &amp; BigDataCloud) saat kamu
        mendeteksi/mencari alamat. Tidak ada pelacakan dan tidak ada data lokasi yang disimpan di server AlamatKu.
      </footer>
    </main>
  );
}
