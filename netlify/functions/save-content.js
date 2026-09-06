// Netlify Function: δέχεται αλλαγές από τον συνδεδεμένο διαχειριστή
// και τις κάνει commit στο GitHub repo, στο αρχείο content/data.json.
//
// Χρειάζεται ένα environment variable GITHUB_TOKEN
// (Site settings > Environment variables στο Netlify dashboard).

const https = require('https');

const OWNER = 'pkerasias-dev';
const REPO = 'texnourgeion-site';
const BRANCH = 'main';
const FILE_PATH = 'data.json';

function githubRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: Object.assign(
        {
          'User-Agent': 'texnourgeion-site-admin',
          'Authorization': 'token ' + token,
          'Accept': 'application/vnd.github+json'
        },
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
      )
    };
    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(chunks); } catch (e) { parsed = chunks; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error('GitHub API error ' + res.statusCode + ': ' + JSON.stringify(parsed)));
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Netlify γεμίζει αυτόματα το context.clientContext.user
  // όταν ο client στέλνει το Identity JWT στο header Authorization.
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: 'Πρέπει να είσαι συνδεδεμένος ως διαχειριστής.' };
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { statusCode: 500, body: 'Λείπει το GITHUB_TOKEN από τις μεταβλητές περιβάλλοντος του Netlify.' };
  }

  let patch;
  try {
    patch = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Μη έγκυρο JSON.' };
  }

  try {
    const getPath = '/repos/' + OWNER + '/' + REPO + '/contents/' + FILE_PATH + '?ref=' + BRANCH;
    let current = {};
    let sha = null;
    try {
      const file = await githubRequest('GET', getPath, token);
      sha = file.sha;
      current = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
    } catch (e) {
      // Το αρχείο ίσως δεν υπάρχει ακόμα· ξεκινάμε από κενό αντικείμενο.
    }

    const merged = Object.assign({}, current);
    Object.keys(patch).forEach((key) => {
      var val = patch[key];
      // The browser storage snapshot is authoritative: it must also be able
      // to persist deletions, so do not merge its keys with the old snapshot.
      if (key === 'storage') {
        merged.storage = val || {};
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        merged[key] = Object.assign({}, current[key] || {}, val);
      } else {
        merged[key] = val;
      }
    });

    const putBody = {
      message: 'Ενημέρωση περιεχομένου από ' + (user.email || 'admin'),
      content: Buffer.from(JSON.stringify(merged, null, 2), 'utf-8').toString('base64'),
      branch: BRANCH
    };
    if (sha) putBody.sha = sha;

    await githubRequest('PUT', '/repos/' + OWNER + '/' + REPO + '/contents/' + FILE_PATH, token, putBody);

    return { statusCode: 200, body: JSON.stringify({ ok: true, data: merged }) };
  } catch (err) {
    return { statusCode: 500, body: 'Σφάλμα αποθήκευσης: ' + err.message };
  }
};
