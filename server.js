const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const resend = new Resend(RESEND_API_KEY);

// ── TEST ROUTE ────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'Songder backend is running!' });
});

// ── WAITLIST ──────────────────────────────────────────
app.post('/waitlist', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const { error } = await supabase.from('waitlist').insert({ email });
  if (error) return res.status(400).json({ error: 'Already registered or invalid email' });

  try {
    const emailResult = await resend.emails.send({
      from: 'Songder <onboarding@resend.dev>',
      to: email,
      subject: "You're on the list. 🎵",
      html: '<p>Welcome to Songder!</p>'
    });
    console.log('Email sent:', JSON.stringify(emailResult));
  } catch(err) {
    console.log('Email error:', err.message);
  }

  res.json({ success: true });
});

// ── COMMENTAIRES ──────────────────────────────────────
app.post('/comments', async (req, res) => {
  const { song, feeling, mood } = req.body;
  if (!song || !feeling) return res.status(400).json({ error: 'Missing fields' });

  const { data, error } = await supabase
    .from('comments')
    .insert({ song, feeling, mood })
    .select().single();

  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.get('/comments', async (req, res) => {
  const { sort, mood, search } = req.query;
  let query = supabase.from('comments').select('*');

  if (mood) query = query.eq('mood', mood);
  if (search) query = query.or(`song.ilike.%${search}%,feeling.ilike.%${search}%`);

  if (sort === 'recent') query = query.order('created_at', { ascending: false });
  else if (sort === 'alpha') query = query.order('song', { ascending: true });
  else query = query.order('votes', { ascending: false });

  const { data, error } = await query;
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ── VOTES ─────────────────────────────────────────────
app.post('/comments/:id/vote', async (req, res) => {
  const { fingerprint } = req.body;
  const { id } = req.params;

  const { data: existing } = await supabase
    .from('votes').select().eq('comment_id', id).eq('fingerprint', fingerprint).single();

  if (existing) return res.status(400).json({ error: 'Already voted' });

  await supabase.from('votes').insert({ comment_id: id, fingerprint });

  const { data: comment } = await supabase.from('comments').select('votes').eq('id', id).single();
  await supabase.from('comments').update({ votes: (comment.votes || 0) + 1 }).eq('id', id);

  res.json({ success: true });
});

// ── REPLIES ───────────────────────────────────────────
app.post('/comments/:id/reply', async (req, res) => {
  const { text } = req.body;
  const { id } = req.params;
  if (!text) return res.status(400).json({ error: 'Missing text' });

  const { data, error } = await supabase
    .from('replies').insert({ comment_id: id, text }).select().single();

  if (error) return res.status(500).json({ error });
  res.json(data);
});

// ── AUTOCOMPLETE ──────────────────────────────────────
app.get('/search-music', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&limit=6&fmt=json`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Songder/1.0 (contact@songder.app)' }
  });
  const data = await response.json();

  const results = (data.recordings || []).map(r => ({
    song: r.title,
    artist: r['artist-credit']?.[0]?.artist?.name || '',
    label: `${r.title} — ${r['artist-credit']?.[0]?.artist?.name || ''}`
  }));
  res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Songder backend running on port ' + PORT));