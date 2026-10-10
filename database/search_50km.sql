-- asyncpg parameters: $1 = buyer longitude; $2 = buyer latitude.
WITH buyer AS (
    SELECT ST_SetSRID(ST_MakePoint($1::double precision,$2::double precision),4326)::geography AS point
)
SELECT l.id, l.title, l.category, l.purpose, l.price_zar,
       (u.seller_verified_at IS NOT NULL) AS is_verified_seller,
       ST_Distance(l.location::geography,b.point)/1000.0 AS distance_km
FROM livestock_listings l
JOIN app_users u ON u.id = l.seller_id AND u.disabled_at IS NULL
CROSS JOIN buyer b
WHERE l.status = 'active'
  AND ST_DWithin(l.location::geography,b.point,50000)
ORDER BY distance_km,l.id
LIMIT 100;

-- After bulk imports, run ANALYZE livestock_listings.
-- Use EXPLAIN (ANALYZE, BUFFERS) with representative coordinates and row counts.
