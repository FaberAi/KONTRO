const client = window.supabase.createClient(
  "https://imghqxftitokjkajtjjc.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltZ2hxeGZ0aXRva2prYWp0ampjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NzE5MzMsImV4cCI6MjA5MTM0NzkzM30.-K5I31r8vVLwsSGliugnb0Q0v2sxlZbS2b9d6Yrs3qY"
);

async function aggiungiMovimento() {
  alert("click ricevuto");

  const { error } = await client
    .from("movimenti")
    .insert([{
      descrizione: "test",
      importo: 10,
      data: new Date().toISOString()
    }]);

  if (error) {
    alert("Errore: " + error.message);
    return;
  }

  alert("ok salvato");
}
