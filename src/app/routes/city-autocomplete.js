const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const https = require('https');

// Simple in-memory cache for filters
const filtersCache = {
    data: null,
    timestamp: null,
    ttl: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
};

// Initialize PostgreSQL connection
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'cities_db',
    password: process.env.DB_PASSWORD || 'postgres',
    port: process.env.DB_PORT || 5432,
});

// Cache for IP geolocation
const ipLocationCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Cache for states by country
const statesCache = {
    data: new Map(),
    ttl: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
};

// Enable pg_trgm extension and test connection
(async () => {
    try {
        const client = await pool.connect();
        try {
            // Enable pg_trgm extension
            await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
            
            // Create optimized indexes
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_cities_exact_match ON cities (LOWER(city_name));
                
                CREATE INDEX IF NOT EXISTS idx_cities_fuzzy_search ON cities 
                USING gin (LOWER(city_name) gin_trgm_ops);
                
                CREATE INDEX IF NOT EXISTS idx_cities_population ON cities (population DESC);
            `);
            
            console.log('Database connection successful and indexes created');
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error connecting to database:', error);
    }
})();

// Helper function to calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Helper function to normalize population score (0-1)
function normalizePopulation(population, maxPopulation) {
    if (!population || population === 0) return 0;
    return Math.log10(population) / Math.log10(maxPopulation);
}

// Helper function to calculate text match score
function calculateTextMatchScore(cityName, query) {
    const cityLower = cityName.toLowerCase();
    const queryLower = query.toLowerCase();
    
    // Exact match (case insensitive)
    if (cityLower === queryLower) return 1.0;
    
    // City name starts with query (highest priority after exact match)
    if (cityLower.startsWith(queryLower)) return 0.95;
    
    // City name contains query as a whole word
    if (cityLower.includes(` ${queryLower} `) || 
        cityLower.startsWith(`${queryLower} `) || 
        cityLower.endsWith(` ${queryLower}`)) {
        return 0.8;
    }
    
    // City name contains query as part of a word
    if (cityLower.includes(queryLower)) return 0.6;
    
    // Calculate Levenshtein distance for fuzzy matching
    function levenshteinDistance(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        
        const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
        
        for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
        
        for (let j = 1; j <= b.length; j++) {
            for (let i = 1; i <= a.length; i++) {
                const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i] + 1,
                    matrix[j - 1][i - 1] + substitutionCost
                );
            }
        }
        
        return matrix[b.length][a.length];
    }
    
    // Check for fuzzy matches using Levenshtein distance
    const maxDistance = Math.max(2, Math.floor(queryLower.length * 0.3)); // Allow up to 30% of query length as distance
    const distance = levenshteinDistance(cityLower, queryLower);
    
    if (distance <= maxDistance) {
        // Calculate similarity score based on distance
        const similarity = 1 - (distance / Math.max(cityLower.length, queryLower.length));
        return 0.4 + (similarity * 0.2); // Score between 0.4 and 0.6 for fuzzy matches
    }
    
    // Check if any word starts with any query word
    const words = cityLower.split(/\s+/);
    const queryWords = queryLower.split(/\s+/);
    
    for (const word of words) {
        for (const queryWord of queryWords) {
            if (word.startsWith(queryWord)) return 0.5;
            // Check for fuzzy word matches
            if (levenshteinDistance(word, queryWord) <= Math.max(2, Math.floor(queryWord.length * 0.3))) {
                return 0.4;
            }
        }
    }
    
    // No match
    return 0.2;
}

// Function to get location from IP using IP-API with caching
function getLocationFromIP(ip) {
    return new Promise((resolve) => {
        // Remove IPv6 prefix if present
        ip = ip.replace('::ffff:', '');
        
        // Check cache first
        const cached = ipLocationCache.get(ip);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            console.log('Using cached location for IP:', ip);
            resolve(cached.location);
            return;
        }
        
        // For local development, use a default location
        if (ip === '127.0.0.1' || ip.startsWith('172.') || ip.startsWith('192.168.')) {
            console.log('Using default location for local IP:', ip);
            const defaultLocation = {
                lat: 50.6333,  // Default to Lille, France
                lon: 3.0667
            };
            ipLocationCache.set(ip, { location: defaultLocation, timestamp: Date.now() });
            resolve(defaultLocation);
            return;
        }

        const options = {
            hostname: 'ip-api.com',
            path: `/json/${ip}`,
            method: 'GET'
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result && result.lat && result.lon) {
                        console.log('Location found:', result);
                        const location = {
                            lat: result.lat,
                            lon: result.lon
                        };
                        ipLocationCache.set(ip, { location, timestamp: Date.now() });
                        resolve(location);
                    } else {
                        console.log('No location data in response, using default location');
                        const defaultLocation = {
                            lat: 50.6333,
                            lon: 3.0667
                        };
                        ipLocationCache.set(ip, { location: defaultLocation, timestamp: Date.now() });
                        resolve(defaultLocation);
                    }
                } catch (error) {
                    console.error('Error parsing location response, using default location');
                    const defaultLocation = {
                        lat: 50.6333,
                        lon: 3.0667
                    };
                    ipLocationCache.set(ip, { location: defaultLocation, timestamp: Date.now() });
                    resolve(defaultLocation);
                }
            });
        });

        req.on('error', (error) => {
            console.error('Error getting location, using default location:', error);
            const defaultLocation = {
                lat: 50.6333,
                lon: 3.0667
            };
            ipLocationCache.set(ip, { location: defaultLocation, timestamp: Date.now() });
            resolve(defaultLocation);
        });

        req.end();
    });
}

router.get('/', async (req, res) => {
    const startTime = process.hrtime();
    const { query, offset = 0, useLocation = false, country_code, state_code } = req.query;
    const limit = 10; // Fixed limit of 10 results per page
    
    try {
        // Get user's location from IP only if requested
        let userLocation = null;
        if (useLocation === 'true') {
            const userIp = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
            userLocation = await getLocationFromIP(userIp);
        }

        // Build the WHERE clause based on filters
        let whereClause = "";
        const queryParams = [];
        let paramIndex = 1;

        if (query) {
            whereClause = "WHERE LOWER(cities.city_name) LIKE '%' || LOWER($1) || '%'";
            queryParams.push(query);
            paramIndex++;
        }

        if (country_code) {
            whereClause += whereClause ? " AND" : "WHERE";
            whereClause += ` cities.country_code = $${paramIndex}`;
            queryParams.push(country_code.toUpperCase());
            paramIndex++;
        }

        if (state_code) {
            whereClause += whereClause ? " AND" : "WHERE";
            whereClause += ` cities.state_code = $${paramIndex}`;
            queryParams.push(state_code.toUpperCase());
            paramIndex++;
        }

        // Add location parameters if needed
        if (userLocation) {
            queryParams.push(userLocation.lat, userLocation.lon);
        } else {
            queryParams.push(null, null);
        }

        // Add pagination parameters
        queryParams.push(limit, offset);

        // Optimized query with pagination and filters
        const searchQuery = `
            WITH search_results AS (
                SELECT 
                    cities.*,
                    CASE 
                        WHEN $1::text IS NOT NULL AND LOWER(cities.city_name) = LOWER($1::text) THEN 1.0
                        WHEN $1::text IS NOT NULL AND LOWER(cities.city_name) LIKE LOWER($1::text) || '%' THEN 0.9
                        WHEN $1::text IS NOT NULL AND LOWER(cities.city_name) LIKE '%' || LOWER($1::text) || '%' THEN 0.8
                        ELSE 1.0
                    END as match_score,
                    CASE 
                        WHEN $${paramIndex}::float IS NOT NULL AND $${paramIndex + 1}::float IS NOT NULL 
                        THEN point($${paramIndex}::float, $${paramIndex + 1}::float) <-> point(cities.latitude::float, cities.longitude::float)
                        ELSE NULL
                    END as distance
                FROM cities
                ${whereClause}
                ORDER BY 
                    match_score DESC,
                    cities.population DESC NULLS LAST,
                    distance ASC NULLS LAST
                LIMIT $${paramIndex + 2} OFFSET $${paramIndex + 3}
            )
            SELECT 
                *,
                (SELECT COUNT(*) FROM cities 
                 ${whereClause}) as total_count
            FROM search_results;
        `;

        const searchResults = await pool.query(searchQuery, queryParams);

        // Calculate scores and sort
        const scoredResults = searchResults.rows.map(city => {
            const populationScore = normalizePopulation(city.population, 10000000);
            const textMatchScore = city.match_score;
            const distanceScore = city.distance ? Math.max(0, 1 - (city.distance / 1000)) : 0.5;

            const finalScore = 
                (populationScore * 0.2) + 
                (textMatchScore * 0.7) + 
                (distanceScore * 0.1);

            return {
                geoname_id: city.geoname_id,
                city_name: city.city_name,
                country_code: city.country_code,
                state_code: city.state_code,
                state_name: city.state_name,
                latitude: city.latitude,
                longitude: city.longitude,
                population: city.population,
                score: finalScore || 0,
                ...(useLocation === 'true' ? {
                    debug: {
                        populationScore: populationScore || 0,
                        textMatchScore,
                        distanceScore,
                        distance: city.distance ? city.distance.toFixed(2) : null,
                        userLocation,
                        useDistanceScoring: !!userLocation
                    }
                } : {})
            };
        });

        // Sort by final score
        const sortedResults = scoredResults.sort((a, b) => b.score - a.score);

        const response = {
            data: sortedResults,
            pagination: {
                offset: parseInt(offset),
                limit: limit,
                total: searchResults.rows[0]?.total_count || 0,
                hasMore: (parseInt(offset) + limit) < (searchResults.rows[0]?.total_count || 0)
            },
            debug: {
                requestTime: `${(process.hrtime(startTime)[0] * 1000 + process.hrtime(startTime)[1] / 1000000).toFixed(2)}ms`
            }
        };

        res.json(response);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({
            error: 'An error occurred while searching for cities',
            details: error.message
        });
    }
});

// Get available countries and states
router.get('/filters', async (req, res) => {
    const startTime = process.hrtime();
    
    // Check cache first
    if (filtersCache.data && filtersCache.timestamp && 
        (Date.now() - filtersCache.timestamp) < filtersCache.ttl) {
        const endTime = process.hrtime(startTime);
        const executionTime = (endTime[0] * 1000 + endTime[1] / 1000000).toFixed(2);
        
        return res.json({
            ...filtersCache.data,
            debug: {
                ...filtersCache.data.debug,
                executionTime: `${executionTime}ms`,
                cacheHit: true
            }
        });
    }

    try {
        // Get unique countries
        const countriesQuery = `
            SELECT DISTINCT country_code 
            FROM cities 
            WHERE country_code IS NOT NULL 
            ORDER BY country_code ASC
        `;
        const countriesResult = await pool.query(countriesQuery);
        
        // Get unique states for each country
        const statesQuery = `
            SELECT DISTINCT country_code, state_code, state_name 
            FROM cities 
            WHERE state_code IS NOT NULL AND state_name IS NOT NULL 
            ORDER BY country_code, state_name ASC
        `;
        const statesResult = await pool.query(statesQuery);
        
        // Organize states by country
        const statesByCountry = {};
        statesResult.rows.forEach(state => {
            if (!statesByCountry[state.country_code]) {
                statesByCountry[state.country_code] = [];
            }
            statesByCountry[state.country_code].push({
                code: state.state_code,
                name: state.state_name
            });
        });

        const endTime = process.hrtime(startTime);
        const executionTime = (endTime[0] * 1000 + endTime[1] / 1000000).toFixed(2);
        
        const response = {
            countries: countriesResult.rows.map(country => ({
                code: country.country_code
            })),
            states: statesByCountry,
            debug: {
                executionTime: `${executionTime}ms`,
                countriesCount: countriesResult.rows.length,
                statesCount: statesResult.rows.length,
                cacheHit: false
            }
        };

        // Update cache
        filtersCache.data = response;
        filtersCache.timestamp = Date.now();

        res.json(response);
    } catch (error) {
        console.error('Error getting filters:', error);
        res.status(500).json({
            error: 'An error occurred while getting filter options',
            details: error.message
        });
    }
});

// Get states for a country
router.get('/states/:countryCode', async (req, res) => {
    const startTime = process.hrtime();
    const { countryCode } = req.params;
    
    try {
        // Check cache first
        const cachedStates = statesCache.data.get(countryCode);
        if (cachedStates && Date.now() - cachedStates.timestamp < statesCache.ttl) {
            console.log('Using cached states for country:', countryCode);
            const endTime = process.hrtime(startTime);
            const executionTime = (endTime[0] * 1000 + endTime[1] / 1000000).toFixed(2);
            return res.json({
                data: cachedStates.states,
                debug: {
                    executionTime: `${executionTime}ms`,
                    cacheHit: true
                }
            });
        }

        const client = await pool.connect();
        try {
            const result = await client.query(
                `SELECT DISTINCT state_code, state_name 
                 FROM cities 
                 WHERE country_code = $1 
                 ORDER BY state_name`,
                [countryCode.toUpperCase()]
            );

            const states = result.rows.map(row => ({
                code: row.state_code,
                name: row.state_name
            }));

            // Update cache
            statesCache.data.set(countryCode, {
                states,
                timestamp: Date.now()
            });

            const endTime = process.hrtime(startTime);
            const executionTime = (endTime[0] * 1000 + endTime[1] / 1000000).toFixed(2);

            res.json({
                data: states,
                debug: {
                    executionTime: `${executionTime}ms`,
                    cacheHit: false,
                    statesCount: states.length
                }
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error fetching states:', error);
        res.status(500).json({ error: 'Failed to fetch states' });
    }
});

module.exports = router; 