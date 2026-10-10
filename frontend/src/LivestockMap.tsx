import { useEffect, useRef, useState } from "react";
import Map, {
  Marker,
  NavigationControl,
  Popup,
  type MapRef,
} from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { earthyStyle } from "./earthyStyle";
import { money, type ListingCollection, type ListingFeature } from "./types";
export default function LivestockMap({
  data,
  buyer,
  onSelect,
}: {
  data: ListingCollection | null;
  buyer: { longitude: number; latitude: number };
  onSelect: (f: ListingFeature) => void;
}) {
  const map = useRef<MapRef>(null);
  const [selected, setSelected] = useState<ListingFeature | null>(null);
  const [error, setError] = useState(false);
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  useEffect(() => {
    setSelected(null);
    map.current?.flyTo({
      center: [buyer.longitude, buyer.latitude],
      zoom: 9,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 400,
    });
  }, [buyer.longitude, buyer.latitude]);
  useEffect(() => {
    if (selected && !data?.features.some((f) => f.id === selected.id))
      setSelected(null);
  }, [data, selected]);
  if (!token)
    return (
      <div className="flex h-[520px] items-center justify-center rounded-xl bg-[#252D25] p-6 text-[#F6F2E9]">
        Map access is not configured. Livestock results remain available in the
        list.
      </div>
    );
  return (
    <section
      aria-label="Nearby livestock map"
      className="relative overflow-hidden rounded-xl border border-[#D5D9CD]"
    >
      <Map
        ref={map}
        mapboxAccessToken={token}
        initialViewState={{ ...buyer, zoom: 9 }}
        mapStyle={earthyStyle}
        style={{ height: 520, width: "100%" }}
        attributionControl
        scrollZoom={false}
        onError={() => setError(true)}
      >
        <NavigationControl position="top-right" />
        {(data?.features ?? []).slice(0, 200).map((raw) => {
          const f = raw as ListingFeature;
          const [lng, lat] = f.geometry.coordinates;
          return (
            <Marker key={f.id} longitude={lng} latitude={lat} anchor="bottom">
              <button
                className="flex min-h-11 min-w-11 items-center justify-center focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-[#F6F2E9]"
                aria-label={`${f.properties.title}, ${money(f.properties.price_cents)} per animal`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(f);
                }}
              >
                <svg
                  width="30"
                  height="38"
                  viewBox="0 0 30 38"
                  aria-hidden="true"
                >
                  <path
                    d="M15 37C11 31 1 23 1 15a14 14 0 1 1 28 0c0 8-10 16-14 22Z"
                    fill={
                      f.properties.is_verified_seller ? "#37533B" : "#A8442F"
                    }
                    stroke="#F6F2E9"
                    strokeWidth="2"
                  />
                  <circle cx="15" cy="15" r="5" fill="#F6F2E9" />
                </svg>
              </button>
            </Marker>
          );
        })}
        {selected && (
          <Popup
            longitude={selected.geometry.coordinates[0]}
            latitude={selected.geometry.coordinates[1]}
            anchor="bottom"
            offset={40}
            onClose={() => setSelected(null)}
            closeOnClick={false}
          >
            <div className="max-w-56 p-2 text-[#252D25]">
              <p className="text-sm font-semibold">
                {selected.properties.title}
              </p>
              <p className="mt-2 text-sm">
                {money(selected.properties.price_cents)} / animal
              </p>
              <p className="mt-1 text-xs">
                {selected.properties.town} · approximate location
              </p>
              <button
                onClick={() => onSelect(selected)}
                className="mt-3 min-h-11 rounded bg-[#A8442F] px-3 text-sm text-white"
              >
                View listing
              </button>
            </div>
          </Popup>
        )}
      </Map>
      {(data?.features.length ?? 0) > 200 && (
        <p className="absolute left-3 top-3 rounded bg-[#F6F2E9] p-2 text-xs">
          Closest 200 map pins shown. All loaded listings remain in the list.
        </p>
      )}
      {error && (
        <p
          role="status"
          className="absolute bottom-9 left-3 right-3 rounded bg-[#F6F2E9] p-3 text-sm"
        >
          The basemap is unavailable. Continue using the livestock list; it does
          not require Mapbox.
        </p>
      )}
    </section>
  );
}
