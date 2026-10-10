import type { Feature, FeatureCollection, Point } from "geojson";
export type Category = "cattle" | "sheep" | "goats";
export type Purpose = "breeding" | "slaughter" | "ceremonial" | "lobola";
export type ListingProperties = {
  title: string;
  category: Category;
  breed: string;
  town: string;
  price_cents: number;
  quantity: number;
  image_url: string | null;
  purpose: Purpose[];
  seller_name: string;
  is_verified_seller: boolean;
  distance_km: number;
};
export type ListingFeature = Feature<Point, ListingProperties> & { id: string };
export type ListingCollection = FeatureCollection<Point, ListingProperties> & {
  next_cursor: string | null;
  location_precision: "approximate";
};
export type SearchParams = {
  longitude: number;
  latitude: number;
  radiusKm: number;
  category?: Category;
  purpose?: Purpose;
  verifiedOnly: boolean;
};
export type ChatMessage = {
  type: "message";
  id: string;
  conversation_id: string;
  sender_id: string;
  client_message_id: string;
  body: string;
  created_at: string;
};
export const money = (cents: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    cents / 100,
  );
