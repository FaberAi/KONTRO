async function aggiungi() {
  const descrizione = document.getElementById("desc").value;
  const importo = parseFloat(document.getElementById("imp").value);

  if (!descrizione || !importo) {
    alert("Compila i campi");
    return;
  }

  const { error } = await client
    .from("movimenti")
    .insert([{
      descrizione,
      importo,
      data: new Date().toISOString()
    }]);

  if (error) {
    alert(error.message);
    return;
  }

  document.getElementById("desc").value = "";
  document.getElementById("imp").value = "";

  carica();
}
