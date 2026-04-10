const supabase = window.supabase.createClient(
  "https://imghqxftitokjkajtjjc.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltZ2hxeGZ0aXRva2prYWp0ampjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NzE5MzMsImV4cCI6MjA5MTM0NzkzM30.-K5I31r8vVLwsSGliugnb0Q0v2sxlZbS2b9d6Yrs3qY"
);

async function aggiungiMovimento() {
  const mov = {
    descrizione: "Test movimento",
    importo: Math.floor(Math.random() * 100),
    data: new Date().toISOString()
  };

  const { error } = await supabase.from('movimenti').insert([mov]);

  if (error) {
    console.error(error);
    alert("Errore: " + error.message);
    return;
  }

  caricaMovimenti();
}

async function caricaMovimenti() {
  const { data, error } = await supabase
    .from('movimenti')
    .select('*')
    .order('data', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  document.getElementById("movimenti").innerHTML =
    data.map(m => `
      <div style="padding:10px;border-bottom:1px solid #eee">
        ${new Date(m.data).toLocaleDateString()} - 
        ${m.descrizione} - 
        €${m.importo}
      </div>
    `).join('');
}

caricaMovimenti();
