"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MapViewProps {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  /** Naik setiap posisi diatur secara programatis (deteksi/pencarian) agar peta memusat ulang. */
  positionVersion: number;
  onDragEnd: (lat: number, lng: number) => void;
}

const pinIcon = L.divIcon({
  className: "alamatku-pin",
  html: '<div class="pin-head"></div>',
  iconSize: [28, 40],
  iconAnchor: [14, 38],
});

export default function MapView({ lat, lng, accuracyMeters, positionVersion, onDragEnd }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const osmRef = useRef<L.TileLayer | null>(null);
  const satRef = useRef<L.TileLayer | null>(null);
  const dragEndRef = useRef(onDragEnd);
  useEffect(() => {
    dragEndRef.current = onDragEnd;
  }, [onDragEnd]);
  const lastVersionRef = useRef(positionVersion);
  const [satellite, setSatellite] = useState(false);

  // Inisialisasi peta sekali.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true });
    mapRef.current = map;

    osmRef.current = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    satRef.current = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "Esri World Imagery",
      },
    );
    osmRef.current.addTo(map);

    const marker = L.marker([lat, lng], { draggable: true, icon: pinIcon }).addTo(map);
    markerRef.current = marker;
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      dragEndRef.current(p.lat, p.lng);
    });

    map.setView([lat, lng], 17);
    // Leaflet kadang salah ukur bila kontainer baru tampil.
    setTimeout(() => map.invalidateSize(), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Posisi programatis berubah -> pusatkan ulang.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (positionVersion !== lastVersionRef.current) {
      lastVersionRef.current = positionVersion;
      marker.setLatLng([lat, lng]);
      map.setView([lat, lng], Math.max(map.getZoom(), 17));
    }
  }, [lat, lng, positionVersion]);

  // Lingkaran akurasi.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (accuracyMeters && accuracyMeters > 0) {
      if (!circleRef.current) {
        circleRef.current = L.circle([lat, lng], {
          radius: accuracyMeters,
          color: "#0F766E",
          weight: 1,
          fillColor: "#0F766E",
          fillOpacity: 0.12,
        }).addTo(map);
      } else {
        circleRef.current.setLatLng([lat, lng]);
        circleRef.current.setRadius(accuracyMeters);
      }
    } else if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }
  }, [lat, lng, accuracyMeters]);

  // Toggle satelit.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !osmRef.current || !satRef.current) return;
    if (satellite) {
      map.removeLayer(osmRef.current);
      satRef.current.addTo(map);
    } else {
      map.removeLayer(satRef.current);
      osmRef.current.addTo(map);
    }
  }, [satellite]);

  return (
    <div className="relative">
      <div ref={containerRef} className="z-0 h-[320px] w-full overflow-hidden rounded-xl border border-gray-200" />
      <button
        type="button"
        onClick={() => setSatellite((s) => !s)}
        className="absolute right-2 top-2 z-[500] rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-gray-800 shadow"
      >
        {satellite ? "Peta" : "Satelit"}
      </button>
      <p className="mt-1.5 text-center text-xs text-gray-500">
        Geser pin bila titiknya meleset — alamat akan dihitung ulang otomatis.
      </p>
    </div>
  );
}
