// ============================================
// KONTRO — Configurazione Supabase
// ============================================
const SUPABASE_URL = 'https://imghqxftitokjkajtjjc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltZ2hxeGZ0aXRva2prYWp0ampjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NzE5MzMsImV4cCI6MjA5MTM0NzkzM30.-K5I31r8vVLwsSGliugnb0Q0v2sxlZbS2b9d6Yrs3qY';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
