-- Database initialization script for cities data

\echo 'Début de l''initialisation de la base de données'

-- Drop existing objects if they exist
DROP TABLE IF EXISTS cities CASCADE;

\echo 'Objets existants supprimés'

-- Create the cities table if it doesn't exist
CREATE TABLE IF NOT EXISTS cities (
    geoname_id INTEGER PRIMARY KEY,
    city_name VARCHAR(200) NOT NULL,
    country_code CHAR(2) NOT NULL,
    state_code VARCHAR(10),
    state_name VARCHAR(100),
    latitude DECIMAL(10, 6) NOT NULL,
    longitude DECIMAL(10, 6) NOT NULL,
    population INTEGER
);

\echo 'Table cities créée'

-- Create indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_city_name ON cities (city_name);
CREATE INDEX IF NOT EXISTS idx_cities_name_trgm ON cities USING gin (city_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_country_code ON cities (country_code);
CREATE INDEX IF NOT EXISTS idx_state_code ON cities (state_code);
CREATE INDEX IF NOT EXISTS idx_state_name ON cities (state_name);
CREATE INDEX IF NOT EXISTS idx_coordinates ON cities (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_cities_population ON cities (population DESC);

\echo 'Index créés'

-- Import data from the mounted data file
\echo 'Starting data import...'
\set ON_ERROR_STOP on
BEGIN;
COPY cities(geoname_id, city_name, country_code, state_code, state_name, latitude, longitude, population) 
FROM '/docker-entrypoint-initdb.d/data/cities_data.txt' 
WITH DELIMITER E'\t' CSV HEADER;
COMMIT;
\echo 'Data import completed'

-- Set up user permissions if needed
-- GRANT SELECT ON cities TO app_user;

-- Create a functional index for case-insensitive city name searches
CREATE INDEX IF NOT EXISTS idx_city_name_lower ON cities (LOWER(city_name));

-- Create a view for the most populated cities per country
CREATE OR REPLACE VIEW popular_cities AS
SELECT c.*
FROM cities c
JOIN (
    SELECT country_code, state_code, MAX(population) as max_pop
    FROM cities
    WHERE population > 0
    GROUP BY country_code, state_code
) m ON c.country_code = m.country_code AND c.state_code = m.state_code AND c.population = m.max_pop
ORDER BY c.population DESC;

\echo 'Vue popular_cities créée'

-- Add a comment to the table for documentation
COMMENT ON TABLE cities IS 'Contains global city data with geographic coordinates and administrative divisions';

