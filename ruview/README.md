# 📡 RuView Monitor

Pannello professionale per **[RuView](https://github.com/ruvnet/RuView)**, il
sistema che trasforma il Wi-Fi in un sensore: nodi **ESP32** leggono come il
corpo disturba le onde radio (CSI) e il **sensing-server** di RuView ne ricava
presenza, persone, movimento, respiro, battito e posa — senza telecamere.

RuView Monitor si collega al sensing-server e rende queste funzioni usabili ogni
giorno: stato chiaro, allarmi, storico, registrazioni e report. Interfaccia in
italiano, funziona su telefono, tablet e PC, installabile come app.

**🌐 Online:** https://bombertronick.github.io/Nuovo/ruview/ — con **Prova la demo**
la vedi funzionare subito, senza hardware.

> Client indipendente e non ufficiale, compatibile con le API v1 del
> sensing-server di RuView. **Non è un dispositivo medico**: respiro e battito
> sono stime contactless.

---

## Cosa fa

| Sezione | Funzioni |
|---|---|
| **Stato** | Presenza (nessuno / ferma / in movimento), numero di persone, affidabilità, postura, respiro, battito, segnale, qualità, nodi attivi, frame al secondo, ultimi eventi |
| **Vitali** | Grafici di respiro e battito con fascia di normalità, movimento, RSSI e qualità; finestre 1 / 5 / 30 min; min-media-max; **report PDF** |
| **Spazio** | Scheletro a 17 punti (COCO) per ogni persona, mappa del campo del segnale vista dall'alto con il punto di massima perturbazione, elenco persone con posizione e movimento |
| **Nodi** | Ogni ESP32: attivo/inattivo, RSSI con andamento, frame/s, ultimo frame, novità, posizione, sottoportanti, parametri vitali calcolati sul nodo |
| **Eventi** | Registro di allarmi e avvisi, conferma, filtri, esportazione CSV |
| **Registrazioni** | Sessioni salvate sul dispositivo (CSV/JSONL, report PDF) e gestione delle registrazioni **sul server** RuView (avvio, stop, elenco, eliminazione) |
| **Impostazioni** | Server, token, verifica connessione passo per passo, soglie di allarme, avvisi (suono, notifiche), tema, backup |
| **Guida** | Installazione, rete, sicurezza, risoluzione problemi |

### Allarmi
- ⚠ **Possibile caduta** (dai nodi ESP32): banner rosso fisso finché non premi *Ho verificato*, suono e notifica.
- ♥ **Respiro / battito fuori soglia** — solo se la stima è affidabile (soglia regolabile) e resta fuori intervallo per un tempo minimo.
- ⏱ **Inattività prolungata** con persona presente (es. 30 min).
- 👤 Ingressi / uscite, numero di persone, ⌖ nodi che smettono di trasmettere, 📡 flusso dati interrotto, cambio di origine dei dati.

### Onestà dei dati
La stessa regola del progetto RuView: **i dati sintetici non vengono mai mostrati
come misure**. L'app legge lo stato ufficiale dell'origine (`source_state` da
`/api/v1/status`) e lo mostra sempre:

| Indicatore | Significato |
|---|---|
| 🟢 **LIVE** | Dati reali dai nodi sensore |
| 🟠 **SIMULATO** | Il server genera dati finti (`--source simulate`) |
| 🔴 **SENSORI FERMI / NESSUN DATO** | Server raggiungibile ma nessun frame recente |
| 🟣 **DEMO** | Dati generati dall'app stessa per mostrarne il funzionamento |

Eventi, registrazioni, esportazioni e report da dati demo o sintetici sono
etichettati (anche nel nome del file) e **non** fanno suonare allarmi.

---

## Come si usa

### 1. Avvia RuView
Senza hardware (Docker, dati simulati):
```bash
docker pull ruvnet/wifi-densepose:latest
export RUVIEW_API_TOKEN=$(openssl rand -hex 32)
docker run -p 127.0.0.1:3000:3000 -e RUVIEW_API_TOKEN ruvnet/wifi-densepose:latest
```
Con i nodi ESP32 (firmware e provisioning: vedi la documentazione di RuView):
```bash
cd v2 && cargo build --release -p wifi-densepose-sensing-server
./target/release/sensing-server --source esp32 --bind-addr 0.0.0.0 --http-port 8080 --ui-path ../ui
```

### 2. Apri RuView Monitor dal server (consigliato)
Copia questa cartella dentro `ui/` di RuView con il nome `monitor` e apri
`http://IP-DEL-SERVER:8080/ui/monitor/` (Docker: porta 3000, montando la cartella
con `-v "$PWD/ruview:/app/ui/monitor:ro"`). L'app si collega da sola al server
che la ospita: token, stato, nodi e registrazioni sul server funzionano da
qualsiasi dispositivo della rete.

Per l'accesso da altri dispositivi: `--bind-addr 0.0.0.0` e, se serve,
`--allowed-host 192.168.1.50` (o `SENSING_ALLOWED_HOSTS`).

### Altri modi
- **Versione online (HTTPS)** — funziona con un server sullo stesso computer
  (`http://localhost:8080`) o pubblicato in HTTPS; verso un IP della rete locale
  il browser blocca la connessione (contenuto misto) e l'app lo spiega.
- **In locale** — `cd ruview && python3 -m http.server 5500`. La diretta funziona;
  le API REST richiedono la stessa origine (il server non abilita CORS).
- **Link preconfigurato** — `…/ruview/?server=http://192.168.1.50:8080`,
  `?demo=1` per la demo, `?kiosk=1` per lo schermo a parete.

---

## Come si collega a RuView

| Funzione | Endpoint del sensing-server |
|---|---|
| Diretta | WebSocket `/ws/sensing` sulla porta HTTP (alternativa: porta WS dedicata 8765 / 3001) |
| Autenticazione | `POST /api/v1/ws-ticket` con `Authorization: Bearer` → ticket monouso `?ticket=` |
| Origine dei dati | `GET /api/v1/status` (`source_state`) |
| Nodi | `GET /api/v1/nodes` + `node_features` nei frame |
| Allarmi dai nodi | messaggi `edge_vitals`, `edge_fused_vitals`, `wasm_event` |
| Registrazioni | `/api/v1/recording/list`, `start`, `stop`, `DELETE /api/v1/recording/{id}` |

Riconnessione automatica con attesa crescente, rilevamento di token mancante o
rifiutato, controllo del flusso fermo. Il token resta sul dispositivo e non
finisce mai in un indirizzo.

---

## Sviluppo

Nessuna dipendenza: **JavaScript, HTML e CSS puri**.

```
index.html              Struttura della pagina
assets/styles.css       Stile (mobile-first, tema chiaro/scuro)
assets/store.js         Archivio locale (IndexedDB): impostazioni, eventi, registrazioni
assets/client.js        Connessione a RuView, normalizzazione dati, sorgente demo
assets/charts.js        Grafici su canvas: serie, mappa del campo, scheletro
assets/app.js           Interfaccia, allarmi, registrazioni, report
sw.js                   Uso offline dell'interfaccia
tools/mock-server.mjs   Finto sensing-server per sviluppo e test
```

Per provare senza hardware né Docker c'è un finto sensing-server con gli stessi
endpoint e formati del server Rust:
```bash
node ruview/tools/mock-server.mjs --port 8080 --source simulated   # oppure esp32
node ruview/tools/mock-server.mjs --port 8080 --token segreto      # con autenticazione
# apri http://localhost:8080/ui/monitor/
```
