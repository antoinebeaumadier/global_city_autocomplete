#!/bin/bash
# Database setup script for cities data

# Create required directories if they don't exist
mkdir -p db/init db/data

# Copy the SQL initialization script to the init directory
cp init_cities_db.sql db/init/

echo "Starting database container..."

# Start the database
docker-compose up -d

echo "Database setup complete! Cities data is now available in PostgreSQL."
echo "You can connect to the database with:"
echo "  psql -h localhost -U postgres -d cities_db" 