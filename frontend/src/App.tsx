import { useEffect, useRef, useState } from "react";
import { useNearbyListings } from "./useNearbyListings";
import LivestockMap from "./LivestockMap";
import { LivestockCard } from "./LivestockCard";
import LivestockCardSkeleton from "./LivestockCardSkeleton";
import ChatPanel from "./ChatPanel";
import {
  money,
  type Category,
  type Purpose,
  type ListingFeature,
  type SearchParams,
} from "./types";
export default function App() {
  const [params, setParams] = useState<SearchParams>({
    longitude: 29.4689,
    latitude: -23.9045,
    radiusKm: 50,
    verifiedOnly: false,
  });
  const [coords, setCoords] = useState({
    longitude: "29.4689",
    latitude: "-23.9045",
  });
  const [coordinateError, setCoordinateError] = useState("");
  const [selected, setSelected] = useState<ListingFeature | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const { data, loading, error, retry, loadMore } = useNearbyListings(params);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, [selected]);
  const input =
    "mt-2 min-h-12 w-full rounded-lg border border-[#D5D9CD] bg-white px-3 text-base";
  return (
    <>
      <header className="border-b border-[#D5D9CD] px-6 py-5">
        <a href="/" className="font-serif text-3xl font-bold">
          pudi<span className="text-[#A8442F]">.</span>
        </a>
        <span className="ml-3 text-sm">Local</span>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="font-serif text-5xl">Good stock, nearby.</h1>
        <p className="mt-3 text-base text-[#5E675E]">
          Search from your coordinates. Map pins show approximate locations.
        </p>
        {!online && (
          <p role="status" className="mt-5 rounded-lg bg-[#DCE5D6] p-4 text-sm">
            You’re offline. The interface is available; reconnect to search
            listings and send messages.
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const longitude = Number(coords.longitude),
              latitude = Number(coords.latitude);
            if (
              !coords.longitude ||
              !coords.latitude ||
              !Number.isFinite(longitude) ||
              !Number.isFinite(latitude) ||
              longitude < -180 ||
              longitude > 180 ||
              latitude < -90 ||
              latitude > 90
            ) {
              setCoordinateError("Enter valid longitude and latitude.");
              return;
            }
            setCoordinateError("");
            setParams((p) => ({ ...p, longitude, latitude }));
          }}
          className="my-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <label className="text-sm font-semibold">
            Longitude
            <input
              type="number"
              min={-180}
              max={180}
              step="0.0001"
              required
              value={coords.longitude}
              className={input}
              onChange={(e) =>
                setCoords((p) => ({ ...p, longitude: e.target.value }))
              }
            />
          </label>
          <label className="text-sm font-semibold">
            Latitude
            <input
              type="number"
              min={-90}
              max={90}
              step="0.0001"
              required
              value={coords.latitude}
              className={input}
              onChange={(e) =>
                setCoords((p) => ({ ...p, latitude: e.target.value }))
              }
            />
          </label>
          <label className="text-sm font-semibold">
            Distance
            <select
              className={input}
              value={params.radiusKm}
              onChange={(e) =>
                setParams((p) => ({ ...p, radiusKm: Number(e.target.value) }))
              }
            >
              {[25, 50, 100, 200].map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Livestock
            <select
              className={input}
              value={params.category || ""}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  category: (e.target.value || undefined) as
                    Category | undefined,
                }))
              }
            >
              <option value="">All livestock</option>
              <option value="cattle">Cattle</option>
              <option value="sheep">Sheep</option>
              <option value="goats">Goats / pudi</option>
            </select>
          </label>
          <label className="text-sm font-semibold">
            Purpose
            <select
              className={input}
              value={params.purpose || ""}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  purpose: (e.target.value || undefined) as Purpose | undefined,
                }))
              }
            >
              <option value="">Any purpose</option>
              <option value="breeding">Breeding</option>
              <option value="slaughter">Slaughter</option>
              <option value="ceremonial">Ceremonial</option>
              <option value="lobola">Lobola</option>
            </select>
          </label>
          <button className="min-h-11 rounded-lg bg-[#A8442F] px-5 text-sm font-semibold text-white sm:col-span-2 lg:col-span-5 lg:justify-self-end">
            Apply coordinates
          </button>
          {coordinateError && (
            <p
              role="alert"
              className="text-sm text-[#A8442F] sm:col-span-2 lg:col-span-5"
            >
              {coordinateError}
            </p>
          )}
        </form>
        <label className="mb-7 flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={params.verifiedOnly}
            onChange={(e) =>
              setParams((p) => ({ ...p, verifiedOnly: e.target.checked }))
            }
            className="h-5 w-5 accent-[#37533B]"
          />
          Only identity-verified sellers
        </label>
        <div className="grid items-start gap-7 lg:grid-cols-[1.1fr_.9fr]">
          <section aria-label="Livestock results" aria-busy={loading}>
            <p role="status" className="mb-4 text-sm text-[#5E675E]">
              {loading
                ? "Loading livestock…"
                : `${data?.features.length ?? 0} listings loaded`}
            </p>
            {error && (
              <div
                role="alert"
                className="mb-5 rounded-lg border border-[#A8442F] p-4 text-sm"
              >
                <p>{error}</p>
                <button
                  className="mt-3 min-h-11 rounded bg-[#A8442F] px-4 text-white"
                  onClick={retry}
                >
                  Try again
                </button>
              </div>
            )}
            <div className="grid gap-6 sm:grid-cols-2">
              {data?.features.map((f) => (
                <LivestockCard
                  key={f.id}
                  listing={f as ListingFeature}
                  onSelect={setSelected}
                />
              ))}
              {loading &&
                Array.from({ length: 4 }, (_, i) => (
                  <LivestockCardSkeleton key={`skeleton-${i}`} />
                ))}
            </div>
            {!loading && !error && data && !data.features.length && (
              <p className="rounded-lg border border-dashed border-[#D5D9CD] p-8">
                No livestock matches this search. Try a wider radius or another
                purpose.
              </p>
            )}
            {data?.next_cursor && (
              <button
                disabled={loading}
                onClick={loadMore}
                className="mt-5 min-h-11 rounded-lg border border-[#37533B] px-5 text-sm"
              >
                Load more listings
              </button>
            )}
          </section>
          <div className="lg:sticky lg:top-6">
            <LivestockMap data={data} buyer={params} onSelect={setSelected} />
          </div>
        </div>
        <dialog
          ref={dialog}
          onCancel={() => setSelected(null)}
          onClick={(e) => {
            if (e.target === dialog.current) setSelected(null);
          }}
          aria-labelledby="detail-title"
          className="fixed inset-0 m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-xl bg-[#F6F2E9] p-6 backdrop:bg-black/50"
        >
          {selected && (
            <>
              <button
                aria-label="Close listing"
                onClick={() => setSelected(null)}
                className="float-right min-h-11 min-w-11 text-2xl"
              >
                ×
              </button>
              <h2 id="detail-title" className="pr-10 font-serif text-3xl">
                {selected.properties.title}
              </h2>
              <p className="mt-4 text-xl font-semibold">
                {money(selected.properties.price_cents)} / animal
              </p>
              <p className="mt-3 text-sm">
                {selected.properties.town} · {selected.properties.quantity}{" "}
                available
              </p>
              <p className="mt-4 text-sm text-[#5E675E]">
                Identity verification does not establish animal ownership or
                health. Ask for records and inspect livestock before agreeing a
                purchase.
              </p>
              <ChatPanel listingId={selected.id} />
            </>
          )}
        </dialog>
      </main>
    </>
  );
}
