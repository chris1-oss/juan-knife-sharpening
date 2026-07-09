// Vercel Serverless Function — save & look up quotes in Airtable.
// Configure these in Vercel → Project → Settings → Environment Variables:
//   AIRTABLE_TOKEN     (Airtable personal access token, kept secret on the server)
//   AIRTABLE_BASE_ID   (e.g. appXXXXXXXXXXXXXX)
//   AIRTABLE_TABLE     (table name, defaults to "Quotes")
// Until those are set, the endpoint returns 503 and the site falls back to email.

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE = process.env.AIRTABLE_TABLE || 'Quotes';

function airtable(path, options) {
  return fetch(
    'https://api.airtable.com/v0/' + BASE_ID + '/' + encodeURIComponent(TABLE) + path,
    Object.assign({}, options, {
      headers: Object.assign(
        {
          Authorization: 'Bearer ' + AIRTABLE_TOKEN,
          'Content-Type': 'application/json',
        },
        options && options.headers
      ),
    })
  );
}

module.exports = async (req, res) => {
  if (!AIRTABLE_TOKEN || !BASE_ID) {
    res.status(503).json({ error: 'Quote storage is not configured yet.' });
    return;
  }

  try {
    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') {
        try { b = JSON.parse(b); } catch (e) { b = {}; }
      }
      if (!b || typeof b !== 'object') b = {};
      const fields = {
        'Quote #': String(b.number || ''),
        Name: String(b.name || ''),
        Email: String(b.email || ''),
        Phone: String(b.phone || ''),
        Knives: String(b.knives || ''),
        Estimate: String(b.estimate || ''),
        Dates: String(b.dates || ''),
        Status: 'New',
      };
      const r = await airtable('', {
        method: 'POST',
        body: JSON.stringify({ fields: fields, typecast: true }),
      });
      const txt = await r.text();
      if (!r.ok) {
        res.status(r.status).json({ error: 'save_failed', airtableStatus: r.status, detail: txt });
        return;
      }
      res.status(200).json({ ok: true, number: b.number });
      return;
    }

    if (req.method === 'GET') {
      const number = String((req.query && req.query.number) || '').trim();
      if (!number) {
        res.status(400).json({ error: 'missing_number' });
        return;
      }
      const safe = number.replace(/['"\\]/g, '');
      const formula = encodeURIComponent("{Quote #}='" + safe + "'");
      const r = await airtable('?filterByFormula=' + formula + '&maxRecords=1', { method: 'GET' });
      const data = await r.json();
      if (!data.records || !data.records.length) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const f = data.records[0].fields;
      res.status(200).json({
        number: f['Quote #'] || number,
        status: f.Status || 'New',
        name: f.Name || '',
        estimate: f.Estimate || '',
        dates: f.Dates || '',
      });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e) });
  }
};
