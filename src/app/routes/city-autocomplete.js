const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const https = require('https');

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
    
    // Fuzzy match (for similar names)
    const words = cityLower.split(/\s+/);
    const queryWords = queryLower.split(/\s+/);
    
    // Check if any word starts with any query word
    for (const word of words) {
        for (const queryWord of queryWords) {
            if (word.startsWith(queryWord)) return 0.5;
        }
    }
    
    // No match
    return 0.2;
}

// Function to get location from IP using IP-API
function getLocationFromIP(ip) {
    return new Promise((resolve) => {
        // Remove IPv6 prefix if present
        ip = ip.replace('::ffff:', '');
        
        // For local development, use a default location
        if (ip === '127.0.0.1' || ip.startsWith('172.') || ip.startsWith('192.168.')) {
            console.log('Using default location for local IP:', ip);
            resolve({
                lat: 50.6333,  // Default to Lille, France
                lon: 3.0667
            });
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
                        resolve({
                            lat: result.lat,
                            lon: result.lon
                        });
                    } else {
                        console.log('No location data in response, using default location');
                        resolve({
                            lat: 50.6333,  // Default to Lille, France
                            lon: 3.0667
                        });
                    }
                } catch (error) {
                    console.error('Error parsing location response, using default location');
                    resolve({
                        lat: 50.6333,  // Default to Lille, France
                        lon: 3.0667
                    });
                }
            });
        });

        req.on('error', (error) => {
            console.error('Error getting location, using default location:', error);
            resolve({
                lat: 50.6333,  // Default to Lille, France
                lon: 3.0667
            });
        });

        req.end();
    });
}

router.get('/', async (req, res) => {
    const { query, page = 1, limit = 10 } = req.query;
    
    if (!query) {
        return res.status(400).json({
            error: 'Query parameter is required'
        });
    }

    try {
        // Get user's location from IP
        let userLocation = null;
        try {
            // Get the real IP address (considering proxy headers)
            const userIp = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
            console.log('Detected IP:', userIp);
            
            userLocation = await getLocationFromIP(userIp);
            if (userLocation) {
                console.log('Detected location:', userLocation);
            } else {
                console.log('Could not detect location from IP');
            }
        } catch (error) {
            console.error('Error in IP geolocation:', error);
        }

        // If no location found, use a neutral score for distance
        const useDistanceScoring = !!userLocation;

        // Get total count for pagination
        const countQuery = `
            SELECT COUNT(*) 
            FROM cities 
            WHERE LOWER(city_name) LIKE LOWER($1)
        `;
        const countResult = await pool.query(countQuery, [`%${query}%`]);
        const totalResults = parseInt(countResult.rows[0].count);

        // Get max population for normalization
        const maxPopQuery = `SELECT MAX(population) FROM cities`;
        const maxPopResult = await pool.query(maxPopQuery);
        const maxPopulation = maxPopResult.rows[0].max;

        // Get initial results
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
            WHERE LOWER(city_name) LIKE LOWER($1) OR LOWER(city_name) LIKE LOWER($2)
            ORDER BY 
                CASE 
                    WHEN LOWER(city_name) = LOWER($3) THEN 1
                    WHEN LOWER(city_name) LIKE LOWER($4) THEN 2
                    ELSE 3
                END,
                population DESC
            LIMIT $5 OFFSET $6
        `;

        const offset = (page - 1) * limit;
        const searchResults = await pool.query(searchQuery, [
            `%${query}%`,
            `${query}%`,
            query,
            `${query}%`,
            limit * 2, // Get more results to sort
            offset
        ]);

        // Calculate scores and sort
        const scoredResults = searchResults.rows.map(city => {
            const populationScore = normalizePopulation(city.population, maxPopulation);
            const textMatchScore = calculateTextMatchScore(city.city_name, query);
            
            // Calculate distance score if we have user location
            let distanceScore = 0.5; // Neutral score if no location
            let distance = null;
            
            if (userLocation) {
                distance = calculateDistance(
                    userLocation.lat,
                    userLocation.lon,
                    parseFloat(city.latitude),
                    parseFloat(city.longitude)
                );
                // Normalize distance score with better scaling for local results
                // Cities within 50km get full score, gradually decreasing to 0 at 1000km
                distanceScore = Math.max(0, 1 - (distance / 1000));
                console.log(`Distance to ${city.city_name}: ${distance.toFixed(2)}km, score: ${distanceScore.toFixed(2)}`);
            }

            // Weighted scoring with adjusted weights
            const finalScore = 
                (populationScore * 0.3) + 
                (textMatchScore * 0.5) + 
                (distanceScore * 0.2);

            return {
                ...city,
                score: finalScore,
                debug: {
                    populationScore,
                    textMatchScore,
                    distanceScore,
                    distance: distance ? distance.toFixed(2) : null,
                    userLocation,
                    useDistanceScoring
                }
            };
        });

        // Sort by final score and take top results
        const sortedResults = scoredResults
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        res.json({
            data: sortedResults,
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