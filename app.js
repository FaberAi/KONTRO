const supabase = window.supabase.createClient(
  "https://imghqxftitokjkajtjjc.supabase.co",
  "INCOLLA_LA_TUA_ANON_KEY"
);

function aggiungiMovimento() {
  supabase.from("movimenti").insert([{
    descrizione: "test",
    importo: 10,
    data: new Date().toISOString()
  }]).then(({ error }) => {
    if (error) {
      alert(error.message);
    } else {
      alert("ok salvato");
    }
  });
}
