require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const request = require('request-promise-native');
const NodeCache = require('node-cache');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const app = express();

// Import routes
const cityAutocompleteRouter = require('./routes/city-autocomplete');

const PORT = process.env.PORT || 3000;

// Configure rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: 'Too many requests from this IP, please try again later.'
});

// Apply rate limiting to all routes
app.use(limiter);


// Session configuration
app.use(session({
    secret: Math.random().toString(36).substring(2),
    resave: false,
    saveUninitialized: true
}));

// Mount routes
app.use('/api/cities', cityAutocompleteRouter);

// Start the server
app.listen(PORT, () => {
    console.log(`OAuth service running on http://localhost:${PORT}`);
});
