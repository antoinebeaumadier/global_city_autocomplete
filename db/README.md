# Database Setup and Management

This directory contains all the necessary files for setting up and managing the cities database.

## Directory Structure

- `init/`: Contains database initialization scripts
- `data/`: Contains pre-processed data files
  - `cities_data.txt`: The main data file containing city information

## Setup Instructions

1. Make sure Docker and Docker Compose are installed on your system

2. Run the setup script from the project root:
```bash
./setup.sh
```

This will:
- Create a PostgreSQL container
- Initialize the database with the pre-processed cities data
- Set up all necessary indexes

## Database Structure

The database contains a single table optimized for city lookups:
```sql
CREATE TABLE cities (
    geoname_id INTEGER PRIMARY KEY,
    city_name VARCHAR(100) NOT NULL,
    country_code CHAR(2) NOT NULL,
    latitude DECIMAL(10, 6) NOT NULL,
    longitude DECIMAL(10, 6) NOT NULL
);
```

### Indexes
- `idx_city_name`: For fast name searches
- `idx_country_code`: For filtering by country
- `idx_coordinates`: For geo queries

## Example Queries

```sql
-- Find cities by name
SELECT * FROM cities WHERE city_name = 'Paris';

-- Find cities in a specific country
SELECT * FROM cities WHERE country_code = 'FR';

-- Find cities within a geographic area
SELECT * FROM cities 
WHERE latitude BETWEEN 48.0 AND 49.0 
AND longitude BETWEEN 2.0 AND 3.0;
```

## Data Format

The data file (`cities_data.txt`) is a tab-separated file with the following columns:
1. geoname_id
2. city_name
3. country_code
4. latitude
5. longitude

## Maintenance

### Backup
To backup the database:
```bash
docker exec cities_postgres pg_dump -U postgres cities_db > backup.sql
```

### Restore
To restore from a backup:
```bash
docker exec -i cities_postgres psql -U postgres cities_db < backup.sql
```

### Monitoring
To check database health:
```bash
docker-compose ps
```

## Troubleshooting

If you encounter any issues:
1. Check the Docker logs: `docker-compose logs db`
2. Verify the data file format in `db/data/cities_data.txt`
3. Ensure the database container is running: `docker-compose ps` 


Create the city table db can be done that way : 

docker exec cities_postgres psql -U postgres -d cities_db -c "CREATE TABLE IF NOT EXISTS cities (geoname_id INTEGER PRIMARY KEY, city_name VARCHAR(200) NOT NULL, country_code CHAR(2) NOT NULL, state_code VARCHAR(10), state_name VARCHAR(100), latitude DECIMAL(10, 6) NOT NULL, longitude DECIMAL(10, 6) NOT NULL, population INTEGER);"

Loading cities_data into it : 

docker exec cities_postgres psql -U postgres -d cities_db -c "COPY cities(geoname_id, city_name, country_code, state_code, state_name, latitude, longitude, population) FROM '/docker-entrypoint-initdb.d/data/cities_data.txt' WITH DELIMITER E'\t' CSV HEADER;"

docker-compose restart app to not reload the db