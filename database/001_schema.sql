BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE livestock_category AS ENUM ('cattle', 'sheep', 'goats');
CREATE TYPE listing_purpose AS ENUM ('breeding', 'slaughter', 'ceremonial', 'lobola');
CREATE TYPE listing_status AS ENUM ('active', 'sold', 'withdrawn');

CREATE TABLE app_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
    seller_verified_at timestamptz,
    disabled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Your trusted login service creates these after authenticating a user.
-- Store only SHA-256 of a cryptographically random, 32-byte-or-longer token.
CREATE TABLE auth_sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id uuid NOT NULL REFERENCES app_users(id),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);

CREATE TABLE livestock_listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id uuid NOT NULL REFERENCES app_users(id),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
    category livestock_category NOT NULL,
    breed text NOT NULL CHECK (char_length(breed) BETWEEN 1 AND 100),
    town text NOT NULL CHECK (char_length(town) BETWEEN 1 AND 100),
    price_zar numeric(12,2) NOT NULL CHECK (price_zar > 0),
    quantity integer NOT NULL CHECK (quantity > 0),
    image_url text CHECK (image_url IS NULL OR image_url LIKE 'https://%'),
    purpose listing_purpose[] NOT NULL,
    is_verified_seller boolean NOT NULL DEFAULT false,
    status listing_status NOT NULL DEFAULT 'active',
    -- Longitude first, latitude second. WGS84 geometry uses degrees.
    location geometry(Point,4326) NOT NULL,
    -- Coarse public pin; never return the private location in discovery.
    display_location geometry(Point,4326)
      GENERATED ALWAYS AS (ST_SnapToGrid(location, 0.02)) STORED,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(id, seller_id),
    CHECK (NOT ST_IsEmpty(location)),
    CHECK (ST_X(location) BETWEEN -180 AND 180),
    CHECK (ST_Y(location) BETWEEN -90 AND 90),
    CHECK (cardinality(purpose) >= 1 AND array_position(purpose, NULL) IS NULL)
);

-- The exact geometry GiST index requested.
CREATE INDEX livestock_location_gist
    ON livestock_listings USING GIST (location);

-- The radius query casts to geography, so it needs this matching expression
-- index. The ordinary geometry index does not accelerate that cast.
CREATE INDEX livestock_active_geography_gist
    ON livestock_listings USING GIST ((location::geography))
    WHERE status = 'active';
CREATE INDEX livestock_purpose_gin
    ON livestock_listings USING GIN (purpose) WHERE status = 'active';
CREATE INDEX livestock_seller_idx ON livestock_listings(seller_id);

-- Verification is sourced from the user record, never from listing input.
CREATE FUNCTION normalize_listing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    SELECT seller_verified_at IS NOT NULL INTO NEW.is_verified_seller
    FROM app_users WHERE id = NEW.seller_id;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER listing_normalization BEFORE INSERT OR UPDATE
ON livestock_listings FOR EACH ROW EXECUTE FUNCTION normalize_listing();

CREATE FUNCTION mirror_seller_verification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE livestock_listings
    SET is_verified_seller = (NEW.seller_verified_at IS NOT NULL)
    WHERE seller_id = NEW.id;
    RETURN NEW;
END;
$$;
CREATE TRIGGER seller_verification_changed AFTER UPDATE OF seller_verified_at
ON app_users FOR EACH ROW WHEN (OLD.seller_verified_at IS DISTINCT FROM NEW.seller_verified_at)
EXECUTE FUNCTION mirror_seller_verification();

CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL,
    buyer_id uuid NOT NULL REFERENCES app_users(id),
    seller_id uuid NOT NULL REFERENCES app_users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(listing_id, buyer_id),
    FOREIGN KEY (listing_id,seller_id) REFERENCES livestock_listings(id,seller_id),
    CHECK (buyer_id <> seller_id)
);
CREATE INDEX conversations_buyer_idx ON conversations(buyer_id);
CREATE INDEX conversations_seller_idx ON conversations(seller_id);

CREATE TABLE chat_messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    sender_id uuid NOT NULL REFERENCES app_users(id),
    client_message_id uuid NOT NULL,
    body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(conversation_id,sender_id,client_message_id)
);
CREATE INDEX chat_history_idx ON chat_messages(conversation_id,id);

CREATE FUNCTION check_chat_participant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM conversations
        WHERE id = NEW.conversation_id
          AND NEW.sender_id IN (buyer_id,seller_id)
    ) THEN
        RAISE EXCEPTION 'Sender is not a conversation participant' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER chat_participant_guard BEFORE INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION check_chat_participant();

-- Durable relay outbox. Publishing is retried; history is authoritative.
CREATE TABLE chat_outbox (
    message_id bigint PRIMARY KEY REFERENCES chat_messages(id),
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    payload jsonb NOT NULL,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_outbox_pending_idx ON chat_outbox(message_id)
    WHERE delivered_at IS NULL;
COMMIT;
