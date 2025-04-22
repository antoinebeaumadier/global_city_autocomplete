require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const request = require('request-promise-native');
const NodeCache = require('node-cache');
const session = require('express-session');
const app = express();

const PORT = process.env.PORT || 3000;

// Token storage
const refreshTokenStore = {};
const accessTokenCache = new NodeCache({ deleteOnExpire: true });

// Validate environment variables
if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
    throw new Error('Missing CLIENT_ID or CLIENT_SECRET environment variable.');
}

// HubSpot OAuth configuration
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SCOPES = process.env.SCOPE ? process.env.SCOPE.split(/[,\s]+/).join(' ') : 'crm.objects.contacts.read';
const REDIRECT_URI = `http://localhost:${PORT}/oauth-callback`;

// Session configuration
app.use(session({
    secret: Math.random().toString(36).substring(2),
    resave: false,
    saveUninitialized: true
}));

// Build authorization URL
const authUrl = 'https://app.hubspot.com/oauth/authorize' +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

// OAuth endpoints
app.get('/install', (req, res) => {
    console.log('Initiating OAuth flow with HubSpot');
    res.redirect(authUrl);
});

app.get('/oauth-callback', async (req, res) => {
    if (req.query.code) {
        const authCodeProof = {
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,
            code: req.query.code
        };

        try {
            const token = await exchangeForTokens(req.sessionID, authCodeProof);
            if (token.message) {
                return res.redirect(`/error?msg=${token.message}`);
            }
            res.redirect('/');
        } catch (error) {
            res.redirect(`/error?msg=${error.message}`);
        }
    }
});

// Token management functions
const exchangeForTokens = async (userId, exchangeProof) => {
    try {
        const responseBody = await request.post('https://api.hubapi.com/oauth/v1/token', {
            form: exchangeProof
        });
        const tokens = JSON.parse(responseBody);
        refreshTokenStore[userId] = tokens.refresh_token;
        accessTokenCache.set(userId, tokens.access_token, Math.round(tokens.expires_in * 0.75));
        return tokens.access_token;
    } catch (e) {
        console.error(`Error exchanging ${exchangeProof.grant_type} for access token`);
        return JSON.parse(e.response.body);
    }
};

const refreshAccessToken = async (userId) => {
    const refreshTokenProof = {
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        refresh_token: refreshTokenStore[userId]
    };
    return await exchangeForTokens(userId, refreshTokenProof);
};

const getAccessToken = async (userId) => {
    if (!accessTokenCache.get(userId)) {
        console.log('Refreshing expired access token');
        await refreshAccessToken(userId);
    }
    return accessTokenCache.get(userId);
};

const isAuthorized = (userId) => {
    return refreshTokenStore[userId] ? true : false;
};

// API endpoints
app.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.write(`<h2>HubSpot OAuth Service</h2>`);
    if (isAuthorized(req.sessionID)) {
        const accessToken = await getAccessToken(req.sessionID);
        res.write(`<h4>Access token: ${accessToken}</h4>`);
    } else {
        res.write(`<a href="/install"><h3>Install the app</h3></a>`);
    }
    res.end();
});

app.get('/error', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.write(`<h4>Error: ${req.query.msg}</h4>`);
    res.end();
});

// Start the server
app.listen(PORT, () => {
    console.log(`OAuth service running on http://localhost:${PORT}`);
});

module.exports = {
    getAccessToken,
    isAuthorized
};