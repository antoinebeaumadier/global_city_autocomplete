-- Database initialization script for cities data

\echo 'Starting database initialization...'

-- Enable verbose error reporting
\set VERBOSITY verbose
\set ON_ERROR_STOP on

-- Create the cities table
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

\echo 'Table created successfully'

-- Import data
\echo 'Starting data import...'
BEGIN;

-- Create a temporary table for raw data
CREATE TEMP TABLE temp_cities (LIKE cities);

-- Import raw data
\echo 'Importing raw data...'
COPY temp_cities FROM '/docker-entrypoint-initdb.d/data/cities_data.txt' 
WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '', ENCODING 'UTF8');

-- Insert cleaned data into final table
\echo 'Cleaning and inserting data...'
INSERT INTO cities 
SELECT 
    geoname_id,
    TRIM(city_name),
    TRIM(country_code),
    NULLIF(TRIM(state_code), ''),
    NULLIF(TRIM(state_name), ''),
    latitude,
    longitude,
    NULLIF(population, 0)
FROM temp_cities;

COMMIT;

\echo 'Data import completed'

-- Create indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_city_name ON cities (city_name);
CREATE INDEX IF NOT EXISTS idx_country_code ON cities (country_code);
CREATE INDEX IF NOT EXISTS idx_state_code ON cities (state_code);
CREATE INDEX IF NOT EXISTS idx_state_name ON cities (state_name);
CREATE INDEX IF NOT EXISTS idx_coordinates ON cities (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_population ON cities (population);

\echo 'Index créés'


-- Verify import
SELECT COUNT(*) as total_cities FROM cities;
\echo 'Database initialization completed successfully'

