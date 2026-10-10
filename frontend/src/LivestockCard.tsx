import type { ReactNode } from "react";
import type { ListingFeature } from "./types";
import { money } from "./types";
export function CardFrame({
  image,
  children,
}: {
  image: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="h-full overflow-hidden rounded-xl border border-[#D5D9CD] bg-[#FFFDF8]">
      <div className="aspect-[4/3] overflow-hidden bg-[#DCE5D6]">{image}</div>
      <div className="space-y-3 p-5">{children}</div>
    </article>
  );
}
export function LivestockCard({
  listing,
  onSelect,
}: {
  listing: ListingFeature;
  onSelect: (l: ListingFeature) => void;
}) {
  const p = listing.properties;
  return (
    <CardFrame
      image={
        p.image_url ? (
          <img
            loading="lazy"
            src={p.image_url}
            alt={`${p.breed} ${p.category}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[#37533B]">
            Seller has not added a photo
          </div>
        )
      }
    >
      <p className="flex justify-between gap-2 text-xs text-[#5E675E]">
        <span>{p.town}</span>
        <span>{p.distance_km} km away</span>
      </p>
      <h2 className="min-h-14 text-lg font-semibold leading-7">
        <button
          onClick={() => onSelect(listing)}
          className="text-left hover:text-[#A8442F]"
        >
          {p.title}
        </button>
      </h2>
      <p className="text-xl font-semibold">
        {money(p.price_cents)}{" "}
        <span className="text-xs font-normal">/ animal</span>
      </p>
      <p className="min-h-6 text-sm capitalize text-[#5E675E]">
        {p.purpose.join(" · ")} · {p.quantity} available
      </p>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-t border-[#D5D9CD] pt-3 text-xs">
        <span>{p.seller_name}</span>
        {p.is_verified_seller && (
          <span className="font-semibold text-[#37533B]">Identity checked</span>
        )}
      </div>
    </CardFrame>
  );
}
