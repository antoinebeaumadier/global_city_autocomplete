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

// Enable pg_trgm extension and test connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to the database:', err);
        return;
    }
    console.log('Successfully connected to the database');
    
    // Enable pg_trgm extension if not already enabled
    client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm', (err) => {
        if (err) {
            console.error('Error enabling pg_trgm extension:', err);
        } else {
            console.log('pg_trgm extension enabled');
        }
        release();
    });
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
                population,
                similarity(LOWER(city_name), LOWER($1)) as similarity_score,
                CASE 
                    WHEN LOWER(city_name) = LOWER($1) THEN 1.0
                    ELSE similarity(LOWER(city_name), LOWER($1))
                END as match_score
            FROM cities 
            WHERE similarity(LOWER(city_name), LOWER($1)) > 0.3
            ORDER BY 
                match_score DESC,
                population DESC
            LIMIT $2 OFFSET $3
        `;

        const offset = (page - 1) * limit;
        const searchResults = await pool.query(searchQuery, [
            query,
            limit * 2,
            offset
        ]);

        // Calculate scores and sort
        const scoredResults = searchResults.rows.map(city => {
            const populationScore = normalizePopulation(city.population, maxPopulation);
            const textMatchScore = city.match_score;
            
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
                (populationScore * 0.2) + 
                (textMatchScore * 0.7) + 
                (distanceScore * 0.1);

            return {
                ...city,
                score: finalScore || 0, // Ensure we never return null
                debug: {
                    populationScore: populationScore || 0, // Ensure we never return null
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