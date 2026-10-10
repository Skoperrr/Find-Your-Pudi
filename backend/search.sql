-- $1 lng, $2 lat, $3 radius metres, $4 category, $5 purpose,
-- $6 verified-only, $7 after-distance, $8 after-id, $9 page-size + 1.
WITH buyer AS (
    SELECT ST_SetSRID(ST_MakePoint($1::double precision,$2::double precision),4326)::geography AS point
), nearby AS (
    SELECT l.id,l.title,l.category::text,l.breed,l.town,
           (l.price_zar*100)::bigint AS price_cents,l.quantity,l.image_url,
           l.purpose::text[],u.display_name AS seller_name,
           (u.seller_verified_at IS NOT NULL) AS is_verified_seller,
           ST_AsGeoJSON(l.display_location)::jsonb AS geometry,
           ST_Distance(l.location::geography,b.point) AS distance_m
    FROM livestock_listings l
    JOIN app_users u ON u.id=l.seller_id AND u.disabled_at IS NULL
    CROSS JOIN buyer b
    WHERE l.status='active'
      AND ST_DWithin(l.location::geography,b.point,$3::double precision)
      AND ($4::livestock_category IS NULL OR l.category=$4::livestock_category)
      AND ($5::listing_purpose IS NULL OR l.purpose @> ARRAY[$5::listing_purpose])
      -- User record is authoritative even if a denormalized mirror drifts.
      AND (NOT $6::boolean OR u.seller_verified_at IS NOT NULL)
)
SELECT * FROM nearby
WHERE $7::double precision IS NULL
   OR (distance_m,id)>($7::double precision,$8::uuid)
ORDER BY distance_m,id
LIMIT $9::integer;
