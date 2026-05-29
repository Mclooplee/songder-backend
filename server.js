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
from: 'Songder <hello@songder.app>',      to: email,
      subject: "You're on the list. 🎵",
      html: `<div style="background:#050507;color:#f0f0f5;padding:48px;font-family:sans-serif;max-width:520px"><h1 style="font-size:40px;font-weight:900;letter-spacing:-1px;margin-bottom:8px">SONG<span style="color:#00aaff">DER</span></h1><p style="color:#a0a0b5;font-size:13px;margin-bottom:32px;letter-spacing:2px;text-transform:uppercase">What music makes you feel</p><h2 style="font-size:22px;margin-bottom:12px">You're on the list ✓ 🎵</h2><p style="color:#a0a0b5;line-height:1.8;margin-bottom:16px">Thank you so much for joining Songder 🙏 You're one of the first people to believe in this project — and that means everything to us.</p><p style="color:#a0a0b5;line-height:1.8;margin-bottom:16px">Every sign-up helps us build the app 🚀 You'll be among the very first to know when we launch.</p><p style="color:#a0a0b5;line-height:1.8;margin-bottom:32px">In the meantime, try our beta and share what a song makes you feel 🎶</p><a href="https://songder.app" style="display:inline-block;background:#00aaff;color:#050507;padding:14px 28px;font-weight:700;font-size:12px;letter-spacing:2px;text-transform:uppercase;text-decoration:none">Try the beta →</a><hr style="border:none;border-top:1px solid #2a2a35;margin:32px 0"><p style="color:#a0a0b5;line-height:1.8;margin-bottom:16px;font-size:13px">Merci infiniment de rejoindre Songder 🙏 Tu fais partie des premiers à croire en ce projet — et ça compte énormément pour nous.</p><p style="color:#a0a0b5;line-height:1.8;margin-bottom:16px;font-size:13px">Chaque inscription nous aide à construire l'app 🚀 Tu seras parmi les tout premiers informés du lancement.</p><p style="color:#5a5a6a;font-size:11px;margin-top:32px;letter-spacing:1px">with ❤️ by looplee · songder.app</p></div>`,

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