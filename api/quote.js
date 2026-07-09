// Vercel Serverless Function — save & look up quotes in Airtable.
// Configure these in Vercel → Project → Settings → Environment Variables:
//   AIRTABLE_TOKEN     (Airtable personal access token, kept secret on the server)
//   AIRTABLE_BASE_ID   (e.g. appXXXXXXXXXXXXXX)
//   AIRTABLE_TABLE     (table name, defaults to "Quotes")
// Until those are set, the endpoint returns 503 and the site falls back to email.

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE = process.env.AIRTABLE_TABLE || 'Quotes';

// Email (Resend) — optional. When RESEND_API_KEY is set, the function emails Juan + the customer on each quote.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.QUOTE_FROM_EMAIL || 'Juan Knife Sharpening <quotes@juanknifesharpening.com>';
const NOTIFY_EMAIL = process.env.QUOTE_NOTIFY_EMAIL || 'juan@juanknifesharpening.com';

async function sendEmail(to, subject, text, attachments) {
  if (!RESEND_API_KEY || !to) return;
  try {
    const payload = { from: FROM_EMAIL, to: [to], subject: subject, text: text };
    if (attachments && attachments.length) payload.attachments = attachments;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // best-effort: never fail the request because an email didn't send
  }
}

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

      // Fire off notification + confirmation emails (best-effort; won't block or fail the save).
      const num = String(b.number || '');
      const juanBody =
        'New sharpening quote request:\n\n' +
        'Quote #: ' + num + '\n' +
        'Name: ' + fields.Name + '\n' +
        'Email: ' + fields.Email + '\n' +
        'Phone: ' + fields.Phone + '\n' +
        'Knives: ' + fields.Knives + '\n' +
        'Estimated total: ' + fields.Estimate + '\n' +
        'Preferred dates: ' + fields.Dates + '\n';
      const custBody =
        'Hi ' + (fields.Name || 'there') + ',\n\n' +
        'Thanks for your request! Here is your quote:\n\n' +
        'Quote #: ' + num + '\n' +
        'Knives: ' + fields.Knives + '\n' +
        'Estimated total: ' + fields.Estimate + '\n' +
        'Your preferred dates: ' + fields.Dates + '\n\n' +
        'Juan will reach out to confirm one of your dates. You can check your quote status anytime at ' +
        'https://www.juanknifesharpening.com using your quote number.\n\n' +
        '— Juan Knife Sharpening\n(872) 237-1005';
      const attachments = [];
      if (b.beforeImage) attachments.push({ filename: 'before.jpg', content: String(b.beforeImage) });
      if (b.afterImage) attachments.push({ filename: 'after.jpg', content: String(b.afterImage) });
      await Promise.all([
        sendEmail(NOTIFY_EMAIL, 'New quote request ' + num, juanBody, attachments),
        sendEmail(fields.Email, 'Your Juan Knife Sharpening quote ' + num, custBody, attachments),
      ]);

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
