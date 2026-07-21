# ⚡ Gestionale Cantieri

App gestionale pensata per un **elettricista / impresa di ristrutturazioni**.
Permette di organizzare tutti i cantieri per categorie, archiviare quelli
completati con la relativa fattura, e tenere sotto controllo lo **scarico
dell'IVA** su materiali e utensili.

L'app è **completamente autonoma**: nessun server, nessun account, nessun
abbonamento. Tutti i dati restano **sul tuo dispositivo**.

---

## Cosa fa

- 🏗️ **Cantieri organizzati per categorie** — categorie sempre modificabili
  (crea, rinomina, cambia colore, elimina) dalla schermata principale.
- ✅ **Archivio cantieri completati** — con tutte le informazioni e la fattura
  allegata; un cantiere si può riaprire in qualsiasi momento.
- 🧾 **Fattura d'origine + spese** — per ogni cantiere alleghi la fattura emessa
  al cliente e tutte le spese di **materiali** e **utensili**.
- 💶 **Scarico IVA automatico** — l'app calcola:
  - **IVA a debito** = IVA della fattura d'origine (incassata dal cliente)
  - **IVA a credito** = somma dell'IVA delle spese di materiali/utensili
  - **IVA netta** = debito − credito → quanto devi **versare** (o quanto hai a
    **credito**)
  - **Margine** = ricavi − costi (imponibile)

  Il calcolo è mostrato **sia nella schermata principale** (totale dell'intera
  azienda) **sia dentro ogni cantiere**.
- 📷 **Allegati** — foto della fattura scattata al momento o file PDF.
- 💾 **Backup e ripristino** — esporta tutti i dati (compresi gli allegati) in un
  unico file, per non perderli o spostarli su un altro dispositivo.
- 📱 **Funziona offline** e si può "aggiungere alla schermata Home" come un'app.

- 📅 **Riepilogo IVA per trimestre e anno** — liquidazione IVA (debito/credito/netta)
  suddivisa per i 4 trimestri, con totale annuo. Utile per il commercialista.
- 📄 **Esportazione** — stampa/PDF della scheda cantiere e del riepilogo, più
  esportazione **CSV** (apribile in Excel) di riepilogo IVA e movimenti.
- 💰 **Scadenzario pagamenti** — fatture **da incassare** e spese **da pagare**,
  con un tocco per segnarle saldate; totali sempre in vista.
- 📝 **Preventivi** — crea un preventivo con voci di lavoro e, quando il cliente
  accetta, **convertilo in fattura d'origine** con un tocco.
- 🖼️ **Galleria foto per cantiere** — documenta i lavori (prima/durante/dopo).
- 📈 **Statistiche azienda** — fatturato per categoria, ripartizione costi
  (materiali/utensili), margine medio e **report annuale/complessivo in PDF**.
- 🔢 **Numerazione automatica** — numero di fattura e preventivo proposto in
  automatico (progressivo per anno), sempre modificabile.
- 🏢 **Dati e logo impresa nei PDF** — logo, P.IVA, indirizzo e contatti
  compaiono in cima a scheda cantiere e report.
- 🧮 **Ritenuta d'acconto** — campo opzionale sulla fattura (es. 4% ritenuta
  condominiale); l'app calcola il **netto a incassare** e lo usa nello scadenzario.

---

## Come si usa

### Aprirla
- **Sul computer:** apri il file `index.html` con un doppio clic.
- **Sul telefono/tablet:** vedi "Installazione sul telefono" più sotto.

### Operazioni principali
1. **Nuovo cantiere** → pulsante **＋** in basso a destra.
2. **Aprire un cantiere** → tocca la sua scheda.
3. Dentro il cantiere:
   - **Allega fattura d'origine** (numero, data, imponibile, aliquota IVA, foto/PDF).
   - **Aggiungi spesa** materiale o utensile (imponibile + aliquota → l'IVA viene
     scalata in automatico).
   - Vedi il **riepilogo IVA** del cantiere in alto.
   - **✅ Segna come completato** → il cantiere finisce in **Archivio**.
4. **Categorie** → chip "⚙️ Categorie" nella schermata principale.
5. **Impostazioni / Backup** → icona **⚙️** in alto a destra (nome impresa,
   esporta/importa backup, totali).

---

## Installazione sul telefono (consigliata)

Per usarla come una vera app e scattare le foto delle fatture al volo, va servita
via web (anche gratis). Due modi semplici:

**A) Hosting gratuito (GitHub Pages)**
1. Attiva GitHub Pages sul branch di questo repository (Settings → Pages).
2. Apri l'URL fornito dal telefono.
3. **iPhone (Safari):** Condividi → *Aggiungi a Home*.
   **Android (Chrome):** menu ⋮ → *Installa app / Aggiungi a schermata Home*.

**B) In locale, senza internet**
```bash
cd Nuovo
python3 -m http.server 8080
```
Poi apri `http://<ip-del-pc>:8080` dal telefono sulla stessa rete Wi-Fi.

> Nota: aprendo `index.html` con doppio clic (`file://`) l'app funziona lo stesso,
> ma il salvataggio offline avanzato (service worker) e la fotocamera diretta
> funzionano al meglio quando è servita via `http/https`.

---

## Dove finiscono i dati

Tutto è salvato **localmente** nel browser del dispositivo (tecnologia
IndexedDB): dati dei cantieri **e** allegati. Non vengono inviati da nessuna
parte.

⚠️ **Fai il backup periodico** (Impostazioni → *Esporta backup*): se cancelli i
dati del browser o cambi dispositivo senza backup, i dati vanno persi. Il file di
backup contiene tutto e si ripristina con *Importa backup*.

---

## Struttura del progetto

```
index.html              Pagina principale
assets/styles.css       Stile (mobile-first, tema chiaro/scuro)
assets/db.js            Salvataggio locale (IndexedDB) + backup/ripristino
assets/app.js           Logica dell'app e calcolo IVA
manifest.webmanifest    Configurazione "app installabile"
sw.js                   Service worker (uso offline)
icons/                  Icone dell'app
```

Nessuna libreria esterna: **JavaScript, HTML e CSS puri**.
