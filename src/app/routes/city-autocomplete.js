const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// Initialize PostgreSQL connection
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'cities_db',
    password: process.env.DB_PASSWORD || 'postgres',
    port: process.env.DB_PORT || 5432,
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to the database:', err);
        return;
    }
    console.log('Successfully connected to the database');
    release();
});

router.get('/', async (req, res) => {
    const { query, page = 1, limit = 10 } = req.query;
    
    if (!query) {
        return res.status(400).json({
            error: 'Query parameter is required'
        });
    }

    try {
        // Get total count for pagination
        const countQuery = `
            SELECT COUNT(*) 
            FROM cities 
            WHERE LOWER(city_name) LIKE LOWER($1)
        `;
        const countResult = await pool.query(countQuery, [`%${query}%`]);
        const totalResults = parseInt(countResult.rows[0].count);

        // Get paginated results with fuzzy matching, sorted by population
        const searchQuery = `
            SELECT 
                geoname_id,
                city_name,
                country_code,
                state_code,
                state_name,
                latitude,
                longitude,
                population
            FROM cities 
            WHERE LOWER(city_name) LIKE LOWER($1)
            ORDER BY 
                CASE 
                    WHEN LOWER(city_name) = LOWER($2) THEN 1
                    WHEN LOWER(city_name) LIKE LOWER($3) THEN 2
                    ELSE 3
                END,
                population DESC
            LIMIT $4 OFFSET $5
        `;

        const offset = (page - 1) * limit;
        const searchResults = await pool.query(searchQuery, [
            `%${query}%`,
            query,
            `${query}%`,
            limit,
            offset
        ]);

        res.json({
            data: searchResults.rows,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalResults / limit),
                totalResults: totalResults,
                resultsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({
            error: 'An error occurred while searching for cities',
            details: error.message
        });
    }
});

module.exports = router; 