import { useEffect, useState } from "react";
import type { ListingCollection, SearchParams } from "./types";
export function useNearbyListings(params: SearchParams) {
  const [data, setData] = useState<ListingCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const { longitude, latitude, radiusKm, category, purpose, verifiedOnly } =
    params;
  const searchKey = JSON.stringify([
    longitude,
    latitude,
    radiusKm,
    category,
    purpose,
    verifiedOnly,
  ]);
  const [activeKey, setActiveKey] = useState(searchKey);
  useEffect(() => {
    setCursor(null);
    setData(null);
    setActiveKey(searchKey);
  }, [searchKey]);
  useEffect(() => {
    // Wait for the reset when filters change; never append a page to another search.
    if (activeKey !== searchKey) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), 15000);
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({
      longitude: String(longitude),
      latitude: String(latitude),
      radius_km: String(radiusKm),
      verified_only: String(verifiedOnly),
      limit: "50",
    });
    if (category) query.set("category", category);
    if (purpose) query.set("purpose", purpose);
    if (cursor) query.set("cursor", cursor);
    (async () => {
      try {
        const response = await fetch(`/api/listings/nearby?${query}`, {
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            response.status === 400
              ? "This result page expired. Start a new search."
              : `Search failed (${response.status}). Try again.`,
          );
        const incoming: ListingCollection = await response.json();
        if (
          incoming.type !== "FeatureCollection" ||
          !Array.isArray(incoming.features) ||
          incoming.features.some(
            (f) =>
              f.geometry?.type !== "Point" ||
              f.geometry.coordinates.length < 2 ||
              f.geometry.coordinates.some((n) => !Number.isFinite(n)),
          )
        )
          throw new Error("The server returned invalid map data.");
        if (controller.signal.aborted) return;
        setData((prev) =>
          cursor && prev
            ? {
                ...incoming,
                features: [
                  ...new Map(
                    [...prev.features, ...incoming.features].map((f) => [
                      f.id,
                      f,
                    ]),
                  ).values(),
                ],
              }
            : incoming,
        );
      } catch (err) {
        if (controller.signal.aborted && controller.signal.reason !== "timeout")
          return;
        setError(
          controller.signal.reason === "timeout"
            ? "The connection is taking too long. Try again."
            : err instanceof Error
              ? err.message
              : "Search unavailable.",
        );
      } finally {
        clearTimeout(timer);
        if (
          !controller.signal.aborted ||
          controller.signal.reason === "timeout"
        )
          setLoading(false);
      }
    })();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    longitude,
    latitude,
    radiusKm,
    category,
    purpose,
    verifiedOnly,
    cursor,
    retry,
    activeKey,
    searchKey,
  ]);
  return {
    data,
    loading,
    error,
    retry: () => setRetry((n) => n + 1),
    loadMore: () => {
      if (!loading && data?.next_cursor) setCursor(data.next_cursor);
    },
  };
}
