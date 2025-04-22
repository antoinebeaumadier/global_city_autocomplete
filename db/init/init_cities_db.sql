-- Database initialization script for cities data

-- Create the cities table if it doesn't exist
CREATE TABLE IF NOT EXISTS cities (
    geoname_id INTEGER PRIMARY KEY,
    city_name VARCHAR(100) NOT NULL,
    country_code CHAR(2) NOT NULL,
    latitude DECIMAL(10, 6) NOT NULL,
    longitude DECIMAL(10, 6) NOT NULL
);

-- Create indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_city_name ON cities (city_name);
CREATE INDEX IF NOT EXISTS idx_country_code ON cities (country_code);
CREATE INDEX IF NOT EXISTS idx_coordinates ON cities (latitude, longitude);

-- If there's a data file already prepared, copy it
-- This assumes the data file is mounted at /docker-entrypoint-initdb.d/data/cities_data.txt
\copy cities(geoname_id, city_name, country_code, latitude, longitude) FROM '/docker-entrypoint-initdb.d/data/cities_data.txt' WITH DELIMITER E'\t' CSV HEADER;

-- Set up user permissions if needed
-- GRANT SELECT ON cities TO app_user; 