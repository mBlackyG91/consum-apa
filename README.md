# Consum apă – evidență lunară și înștiințări

Aplicație web simplă (fără server, fără instalare de programe) pentru:

- evidența lunară a indexurilor de apă rece pentru unul sau mai multe apartamente;
- calculul automat al consumului;
- tipărirea formularului „ÎNȘTINȚARE LUNARĂ CONSUM DE APĂ” (2 sau 3 pe o foaie A4), sau PDF;
- sincronizarea datelor între telefon și calculator prin **Google Drive** (un singur fișier `evidenta-apa.json`).

Funcționează și fără internet. Se poate „instala” pe telefon ca aplicație (PWA).

> **Datele personale nu stau în cod.** Numele proprietarului și numerele apartamentelor le introduci în aplicație; ele ajung doar în browserul tău și în fișierul din Google Drive-ul tău. Depozitul de cod poate fi public. (Fișierul `tests/date-test.json` conține doar nume inventate, pentru teste.)

---

## Cuprins

1. [Ce fișiere are proiectul](#1-ce-fișiere-are-proiectul)
2. [Publicarea pe GitHub Pages](#2-publicarea-pe-github-pages)
3. [Proiectul în Google Cloud Console și Google Drive API](#3-proiectul-în-google-cloud-console-și-google-drive-api)
4. [Ecranul de consimțământ OAuth („Testing” vs „In production”)](#4-ecranul-de-consimțământ-oauth)
5. [Crearea OAuth Client ID](#5-crearea-oauth-client-id)
6. [Punerea Client ID-ului în aplicație](#6-punerea-client-id-ului-în-aplicație)
7. [Instalarea pe telefon și pe calculator](#7-instalarea-pe-telefon-și-pe-calculator)
8. [Utilizare](#8-utilizare)
9. [Tipărire (calculator, Android, iPhone)](#9-tipărire)
10. [Sincronizare: cum funcționează](#10-sincronizare-cum-funcționează)
11. [Actualizarea aplicației](#11-actualizarea-aplicației)
12. [Testare locală (opțional)](#12-testare-locală-opțional)
13. [Probleme frecvente](#13-probleme-frecvente)

---

## 1. Ce fișiere are proiectul

| Fișier | Rol |
|---|---|
| `index.html` | Pagina aplicației |
| `styles.css` | Aspectul pe ecran și **la tipărire** (`@media print`) |
| `app.js` | Logica: apartamente, luni, calcule, validări, istoric, tipărire, PDF |
| `drive.js` | Autentificare Google și sincronizare cu Drive |
| `pdf.js` | Generator PDF (fără biblioteci externe) |
| `config.js` | **Singurul fișier pe care îl modifici**: Client ID-ul Google |
| `privacy.html` | Politica de confidențialitate (cerută de Google pentru „In production”) |
| `sw.js` | Service worker: funcționare offline |
| `manifest.json`, `icons/` | Instalare ca aplicație pe telefon |
| `tests/` | Pagina de test a sincronizării și date de test inventate |

---

## 2. Publicarea pe GitHub Pages

Facem asta **înainte** de Google Cloud, pentru că avem nevoie de adresa la care va fi aplicația.

1. Fă-ți cont pe <https://github.com> (dacă nu ai). Reține **numele de utilizator** (ex. `ionpopescu`).
2. Sus-dreapta, **+** → **New repository**.
   - *Repository name*: de exemplu `consum-apa`.
   - Lasă **Public** (GitHub Pages gratuit cere depozit public; în cod nu există date personale).
   - Apasă **Create repository**.
3. Pe pagina depozitului: **Add file** → **Upload files**. Trage în fereastră **toate fișierele și folderele** proiectului (`index.html`, `styles.css`, `app.js`, `drive.js`, `pdf.js`, `config.js`, `sw.js`, `manifest.json`, folderul `icons`, folderul `tests`, `README.md`). Jos apasă **Commit changes**.
   - Nu urca folderele `.claude` sau `tests/out` (nu sunt necesare).
4. **Settings** (al depozitului) → în stânga **Pages**.
   - *Source*: **Deploy from a branch**.
   - *Branch*: **main**, folder **/ (root)** → **Save**.
5. După 1–2 minute apare sus: *Your site is live at* `https://NUMELE-TAU.github.io/consum-apa/`.
   Aceasta este **adresa aplicației**. Origin-ul ei (necesar la pasul 5) este doar partea `https://NUMELE-TAU.github.io` — **fără** `/consum-apa/` la final.

Până la pasul 6 aplicația merge deja, dar doar „local” (datele stau numai în browserul respectiv).

**Alternative gratuite:** Netlify, Cloudflare Pages sau Vercel (trage folderul în pagina lor de „deploy”). Pașii Google de mai jos rămân aceiași, doar origin-ul diferă.

---

## 3. Proiectul în Google Cloud Console și Google Drive API

1. Intră pe <https://console.cloud.google.com/> cu contul Google în al cărui Drive vrei să stea datele.
   La prima intrare acceptă termenii (țara: România).
2. Sus, lângă logo-ul „Google Cloud”, apasă pe selectorul de proiect → **New project** (Proiect nou).
   - *Project name*: `Consum apa` → **Create**.
   - Așteaptă notificarea, apoi asigură-te că proiectul nou este **selectat** în selectorul de sus.
3. Activează Google Drive API:
   - Meniul ☰ → **APIs & Services** → **Library** (Bibliotecă).
   - Caută **Google Drive API** → deschide → **Enable** (Activează).

Nu este nevoie de cont de facturare (billing) și nu se plătește nimic.

---

## 4. Ecranul de consimțământ OAuth

Este ecranul pe care Google ți-l arată când aplicația cere acces („Aplicația Consum apă vrea să…”).
În consola nouă se numește **Google Auth Platform**; în unele conturi apare încă **OAuth consent screen**.

1. Meniul ☰ → **APIs & Services** → **OAuth consent screen** (sau **Google Auth Platform**) → **Get started**.
2. **App information**: *App name* `Consum apă`, *User support email* = adresa ta → **Next**.
3. **Audience**: alege **External** → **Next**.
   (*Internal* există doar pentru conturi Google Workspace de firmă.)
4. **Contact information**: adresa ta de e-mail → **Next** → bifează acordul → **Create**.
5. **Data access** (sau *Scopes*) → **Add or remove scopes** → caută `drive.file` și bifează
   `https://www.googleapis.com/auth/drive.file` („See, edit, create and delete only the specific Google Drive files you use with this app”) → **Update** → **Save**.
   Aplicația vede **doar fișierele create de ea**, nu restul Drive-ului tău.
6. **Audience** → secțiunea **Test users** → **Add users** → adaugă adresa ta Gmail (și a oricui altcuiva va folosi aplicația) → **Save**.
   Nu încărca un logo: logo-ul declanșează o verificare suplimentară din partea Google.

### „Testing” versus „In production”

În **Audience** vezi *Publishing status*:

- **Testing** (implicit)
  - Doar utilizatorii adăugați la *Test users* (max. 100) se pot conecta.
  - La conectare apare un avertisment „Google hasn't verified this app” → apasă **Continue** (este aplicația ta).
  - **Autorizarea expiră după 7 zile**: Google îți va cere din nou acordul (ecranul de consimțământ) aproximativ o dată pe săptămână când apeși „Reconectează”. Datele nu se pierd.
- **In production** (butonul **Publish app**)
  - Autorizarea nu mai expiră după 7 zile; acordul îl dai o singură dată pe cont.
  - Deoarece aplicația folosește doar scope-ul `drive.file` (considerat de Google *non-sensitive*), în mod normal **nu** este necesară procedura de verificare. Este posibil să vezi în continuare un avertisment la prima conectare.
  - Recomandare: începe în **Testing**, verifică faptul că totul merge, apoi apasă **Publish app** ca să scapi de reconfirmarea săptămânală.
  - Pentru **Publish app**, Google cere în **Branding**: *Application home page* = adresa aplicației (ex. `https://NUMELE-TAU.github.io/consum-apa/`), *Application privacy policy link* = `https://NUMELE-TAU.github.io/consum-apa/privacy.html` (pagina e inclusă în proiect) și, la *Authorized domains*, `NUMELE-TAU.github.io`.

Indiferent de mod, **tokenul de acces durează ~1 oră** (regulă Google pentru aplicațiile fără server). După expirare, insigna din colțul aplicației arată „Reconectează Google Drive”: o atingere și fereastra Google se închide singură (dacă acordul este încă valabil). Modificările făcute între timp rămân salvate pe dispozitiv și se trimit imediat după reconectare.

---

## 5. Crearea OAuth Client ID

1. ☰ → **APIs & Services** → **Credentials** (sau **Google Auth Platform** → **Clients**).
2. **+ Create credentials** → **OAuth client ID** (sau **Create client**).
3. *Application type*: **Web application**. *Name*: `Consum apa web`.
4. **Authorized JavaScript origins** → **+ Add URI**:
   - `https://NUMELE-TAU.github.io` ← adresa de la pasul 2, **fără** cale și fără `/` la final;
   - opțional, pentru teste pe calculator: `http://localhost:8765`.
5. **Authorized redirect URIs**: lasă **gol** (nu sunt necesare).
6. **Create**. Copiază **Client ID** (arată ca `123456789012-abcdefg....apps.googleusercontent.com`).
   *Client secret* nu se folosește și nu trebuie pus nicăieri.

Modificările de origini pot dura câteva minute (uneori până la o oră) până intră în vigoare.

---

## 6. Punerea Client ID-ului în aplicație

1. În GitHub, deschide fișierul `config.js` → iconița creion (**Edit this file**).
2. Înlocuiește `PUNE_AICI_CLIENT_ID.apps.googleusercontent.com` cu Client ID-ul tău, păstrând ghilimelele:
   ```js
   GOOGLE_CLIENT_ID: '123456789012-abcdefg....apps.googleusercontent.com',
   ```
3. **Commit changes**. După ~1 minut GitHub Pages publică versiunea nouă.

Client ID-ul **nu este secret** (este vizibil oricum în browser); e normal să stea într-un depozit public. Fără originea autorizată (pasul 5), nimeni nu îl poate folosi de pe alt site.

---

## 7. Instalarea pe telefon și pe calculator

Deschide adresa aplicației (`https://NUMELE-TAU.github.io/consum-apa/`).

- **Android (Chrome)**: meniul ⋮ → **Instalează aplicația** / **Adaugă pe ecranul de pornire**.
- **iPhone/iPad (Safari)**: butonul Partajare (pătrat cu săgeată) → **Adaugă pe ecranul principal**.
- **Calculator (Chrome/Edge)**: iconița de instalare din bara de adresă, sau meniul → *Instalează Consum apă*.

Apoi, pe **fiecare** dispozitiv: secțiunea **Date** → **Conectează Google Drive** → alege contul → **Continue/Permite**.

- Primul dispozitiv creează fișierul `evidenta-apa.json` în Drive (în rădăcina „My Drive”).
- Pe celelalte dispozitive, dacă nu ai introdus încă nimic, datele se preiau automat din Drive. Dacă ai introdus deja date și pe acel dispozitiv, aplicația te întreabă ce versiune păstrezi.

> Pe iPhone, aplicația instalată pe ecranul principal are spațiu de stocare separat de Safari: conectează Drive-ul din aplicația instalată.

---

## 8. Utilizare

**Apartamente** – pornește cu 2 apartamente goale. Completează: nr. apartament, numele proprietarului, numărul implicit de persoane, contoarele active (Bucătărie, Baie, Baie de serviciu) și „Include la tipărire”. Poți adăuga sau șterge apartamente.

**Lună** – implicit luna anterioară (cea pentru care predai indexurile).
- *Perioada consumului* se completează automat („octombrie 2026”); o poți modifica, iar butonul **Automat** revine la textul implicit.
- Introduci doar **indexul nou**, ca număr întreg de m³ (ex. `123`), fără virgulă și fără zecimale. Pe telefon apare tastatura cu cifre.
- *Indexul vechi* se preia din indexul nou al lunii anterioare (scrie sub câmp de unde a fost preluat). La prima lună îl introduci manual; orice index vechi poate fi suprascris (apare „introdus manual · revino la automat”).
- *Numărul de persoane* se preia din luna anterioară (sau numărul implicit) și se poate schimba pentru luna respectivă.
- Consumul și totalul apei reci se calculează automat.
- Mesaje, fără să blocheze introducerea: **roșu** = index nou mai mic decât cel vechi; **galben** = consum de peste 2 ori media lunilor anterioare, sau contor lipsă într-o lună începută.

**Istoric** – tabel pe apartament (index nou, consum, total, persoane). „Deschide” te duce la luna respectivă pentru corecturi. Dacă corectezi o lună veche, luna următoare își actualizează automat indexul vechi.

**Date** – starea sincronizării, „Sincronizează acum”, „Deconectează”, **Exportă JSON** / **Importă JSON** (copie de siguranță; importul cere confirmare și înlocuiește toate datele).

Insigna din colțul de sus arată mereu starea: **Sincronizat**, **Se salvează…**, **Offline, se va sincroniza**, **Eroare de sincronizare, încearcă din nou** (atinge-o pentru reîncercare), **Reconectează Google Drive** (atinge-o), **Conflict: alege versiunea**.

---

## 9. Tipărire

Secțiunea **Tipărire** folosește luna selectată în secțiunea **Lună**.

- **Formulare pe foaie**: 2 (sloturi de 148,5 mm) sau 3 (sloturi de 99 mm). Între formulare este o linie punctată de tăiere (nu și după ultimul). Dacă sunt mai multe apartamente decât sloturi, se continuă pe foaia următoare.
- Bifează ce apartamente intră la tipărire.
- **Previzualizarea** de pe ecran este exact foaia A4 care se tipărește.
- Câmpurile necompletate apar ca linii `____`; „Semnătură” rămâne goală.

**Pe calculator** – **Tipărește** → în dialog: *Destinație* imprimanta sau „Salvează ca PDF”, *Aspect* Portret, *Hârtie* A4, *Margini* Niciuna (sau Implicite), *Scalare* 100% / „Implicit”, debifează *Anteturi și subsoluri* dacă apare.

**Android (Chrome)** – **Tipărește** deschide dialogul Android: alege imprimanta sau „Salvează ca PDF”, hârtie A4. Dacă dialogul nu apare (unele versiuni, în aplicația instalată), folosește **Descarcă PDF** sau **Trimite PDF**.

**iPhone/iPad** – din Safari, **Tipărește** deschide AirPrint. Din aplicația instalată pe ecranul principal, iOS poate ignora comanda de tipărire: folosește **Trimite PDF** → **Tipărește** (sau *Salvează în Fișiere* și tipărește de acolo).

**Descarcă PDF / Trimite PDF** – PDF-ul este generat în aplicație (A4, 200 dpi), are același conținut și aceeași așezare ca foaia tipărită și merge și offline. Îl poți trimite pe e-mail sau WhatsApp, ori la o imprimantă/centru de copiere.

---

## 10. Sincronizare: cum funcționează

- Orice modificare se salvează **imediat** pe dispozitiv (localStorage), apoi în Drive după **2 secunde** de pauză.
- La pornire, la reconectarea la internet și când revii în aplicație, ea verifică dacă fișierul din Drive s-a schimbat (după versiunea fișierului).
- Dacă Drive-ul a fost modificat de pe alt dispozitiv **și** ai modificări nesincronizate aici, aplicația **nu suprascrie nimic**: îți arată ambele versiuni și alegi „Folosește versiunea din Drive” sau „Păstrează versiunea locală” (poți exporta întâi copia locală).
- Fișierul `evidenta-apa.json` din Drive este text JSON; nu îl edita manual decât dacă știi ce faci. Dacă îl ștergi din Drive, aplicația îl recreează din datele locale.

---

## 11. Actualizarea aplicației

Încarcă fișierele modificate în GitHub (Add file → Upload files, peste cele vechi). Aplicația instalată își actualizează fișierele în fundal: versiunea nouă apare **la a doua deschidere**.
Dacă adaugi fișiere noi în aplicație, adaugă-le și în lista `ASSETS` din `sw.js` și schimbă `consum-apa-v6` în `consum-apa-v7`.

---

## 12. Testare locală (opțional)

Ai nevoie de Python instalat. În folderul proiectului:

```bash
python -m http.server 8765
```

Deschide <http://localhost:8765>. Pentru Drive, adaugă `http://localhost:8765` la *Authorized JavaScript origins* (pasul 5).

Testul automat al sincronizării (cu un Drive **simulat**, fără cont Google): <http://localhost:8765/tests/sync-test.html> – trebuie să afișeze „TOATE TESTELE AU TRECUT”.

---

## 13. Probleme frecvente

| Simptom | Cauză / soluție |
|---|---|
| „Doar local (Drive neconfigurat)” | Client ID-ul nu a fost pus în `config.js` (pasul 6). |
| Eroare Google `origin_mismatch` / „redirect_uri_mismatch” | Origin-ul din pasul 5 nu coincide exact cu adresa site-ului (`https://NUMELE-TAU.github.io`, fără cale, fără `/`). Așteaptă câteva minute după modificare. |
| `access_denied` / „app is being tested” | Contul tău nu e la *Test users* (pasul 4.6), sau publică aplicația. |
| Fereastra Google nu se deschide | Browserul blochează ferestrele pop-up: permite-le pentru site. |
| Cer reconectare des | Normal: tokenul Google durează ~1 oră. În modul *Testing* se cere și reconfirmare la 7 zile. |
| Pagina tipărită are o foaie goală în plus sau antet/subsol | Setează *Margini: Niciuna*, *Scalare 100%*, dezactivează *Anteturi și subsoluri*; sau folosește PDF-ul. |
| Am pierdut datele de pe telefon | Dacă erau sincronizate, reconectează Drive și se preiau. Altfel, importă ultimul export JSON. |
