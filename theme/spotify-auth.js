#!/usr/bin/env node
// One-time helper: prints the Spotify refresh token that theme/build.js needs for the NOW PLAYING card.
//   1. Create an app at https://developer.spotify.com/dashboard and add the redirect URI
//      http://127.0.0.1:8888/callback (Web API).
//   2. node theme/spotify-auth.js <client id> <client secret>
//   3. Open the printed URL, approve, then save the three values it prints as repository secrets.
'use strict';

const http = require('http');

const [id, secret] = process.argv.slice(2);
if (!id || !secret) {
  console.error('usage: node theme/spotify-auth.js <client id> <client secret>');
  process.exit(1);
}
const PORT = 8888;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'user-read-currently-playing user-read-recently-played';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== '/callback') return res.writeHead(404).end();
  const code = url.searchParams.get('code');
  if (!code) {
    res.end(`Authorization failed: ${url.searchParams.get('error') || 'no code'}`);
    return server.close();
  }
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }),
  });
  const body = await r.json();
  if (!r.ok || !body.refresh_token) {
    res.end('Token exchange failed — see the terminal.');
    console.error(body);
  } else {
    res.end('Done — you can close this tab and go back to the terminal.');
    console.log('\nAdd these as repository secrets (Settings → Secrets and variables → Actions):\n');
    console.log(`SPOTIFY_CLIENT_ID=${id}`);
    console.log(`SPOTIFY_CLIENT_SECRET=${secret}`);
    console.log(`SPOTIFY_REFRESH_TOKEN=${body.refresh_token}\n`);
  }
  server.close();
});

server.listen(PORT, '127.0.0.1', () => {
  const q = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES });
  console.log(`Open this URL and approve access:\n\nhttps://accounts.spotify.com/authorize?${q}\n`);
});
