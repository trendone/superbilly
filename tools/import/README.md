# Import-Pipeline (Billy-Liste → Zoho-Matching → Supabase)

Bringt die Excel-Planung (**Mitarbeiter, Buchungen, Projekte**) in superbilly und
verknüpft die Excel-Projekte mit den echten **Zoho-Deals**. Matching **und** DB-Import
sind fertig und reproduzierbar (siehe [§6](#6-echter-import--delta)).

Die Analyse-Schritte (A–D) sind **Dry-Run** (lesen nur). Nur `import-to-db.mjs --apply`
(Schritt E) schreibt – idempotent und transaktional.

---

## 1. Datenfluss

```
BILLY LIST ….xlsx
   │  gen_import.py        (im Repo ../ressourcenplanung/tools)
   ▼
import-data.js            {employees, projects, tasks}  – deterministischer Excel-Export
   │                       ┌─ analyze.mjs   → reports/report.md       (Validierung Mitarbeiter/Projekte)
   ├───────────────────────┤
   │                       └─ match-zoho.mjs → reports/match-zoho.md   (lesbarer Report)
   │  zoho-projects.json                      reports/match-map.json   (maschinenlesbare Zuordnung)
   ▲
   │  export-zoho.sh        (SELECT auf Supabase: projects mit external_id)
projects (Supabase)  ←  sync-zoho Edge Function  ←  Zoho CRM
```

> **Excel-Quelle:** Stand jetzt liefert die alte `../ressourcenplanung/import-data.js`
> die Excel-Daten (deterministisch aus der xlsx gebaut). Sie ist der **Proxy** für die
> Excel — Projekt-/Mitarbeiter-/Buchungsnamen sind identisch. Bei neueren Daten einfach
> `gen_import.py` mit der neuen xlsx neu laufen lassen (Schritt A).

---

## 2. Dateien

| Datei | Zweck |
|---|---|
| `../ressourcenplanung/tools/gen_import.py` | baut `import-data.js` aus der xlsx (deterministisch) |
| `analyze.mjs` | Validierung: Mitarbeiter-Hinweise, Projekt-Dedup, Sonderfälle → `reports/report.md` |
| `export-zoho.sh` | exportiert Zoho-Projekte aus Supabase → `zoho-projects.json` |
| `match-zoho.mjs` | matcht Excel-Projekte ↔ Zoho-Deals → `reports/match-zoho.md` + `reports/match-map.json` |
| `overrides.json` | manuelle Excel→Zoho-Zuordnungen (überleben Re-Runs, siehe [§7](#7-manuelle-overrides-overridesjson--überleben-re-runs)) |
| `zoho-projects.json` | Snapshot der Zoho-Projekte (Input fürs Matching, von `export-zoho.sh`) |
| `reports/match-map.json` | **maschinenlesbare** Zuordnung inkl. `projectDispositions` – Input für den Writer |
| `import-to-db.mjs` | **Writer:** import-data.js + match-map.json → idempotentes SQL → Supabase |
| `reports/import.sql` | das generierte SQL (review-bar vor `--apply`) |
| `supabase/migrations/…190000_excel_import.sql` | `source='excel'` erlauben + partieller Unique-Index `bookings.external_id` |

Secrets (DB-Zugang) liegen in `../.secrets` (`SUPABASE_DB_URL`); nicht committen.

---

## 3. Komplettlauf (auch für neuere Daten)

```bash
# A) Excel → import-data.js  (nur nötig, wenn eine NEUE xlsx vorliegt)
cd ../ressourcenplanung
BILLY_XLSX="/Pfad/zur/BILLY LIST ….xlsx" python3 tools/gen_import.py
cd ../superbilly

# B) Zoho-Projekte aus Supabase ziehen (sync-zoho hält projects aktuell)
bash tools/import/export-zoho.sh

# C) Validierung (Mitarbeiter/Projekte) – optional, aber empfohlen
node tools/import/analyze.mjs

# D) Zoho-Matching
node tools/import/match-zoho.mjs

# E) Import nach Supabase  (erst Migration einspielen, dann anwenden)
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260629190000_excel_import.sql   # einmalig
set -a; . ./.secrets; set +a
node tools/import/import-to-db.mjs            # nur SQL schreiben -> reports/import.sql (review)
node tools/import/import-to-db.mjs --apply    # SQL schreiben UND anwenden
```

Ergebnis: `reports/match-zoho.md` (lesen), `reports/match-map.json` (Import-Input),
Daten in Supabase. Alle Schritte sind **idempotent** und beliebig oft wiederholbar.

---

## 4. Wie das Matching entscheidet

Pro Excel-Projekt wird der beste Zoho-Deal gesucht – in dieser Reihenfolge:

1. **Name (Token-Containment + Anker).** Excel-Namen sind kurz (`Straumann`), Zoho-Namen
   lange Deal-Namen (`Straumann- Front End/Innovation Portfolio …`). Wir tokenisieren beide,
   werfen Stopwords/Monate/Zahlen raus und messen, wie viele Excel-Tokens im Zoho-Namen
   stecken. Das längste Token (meist die Firma) muss treffen.
2. **Token-Fuzzy.** Tippfehler/Varianten werden per Levenshtein toleriert
   (≤4 Zeichen exakt, 5–7 → 1 Edit, ab 8 → 2 Edits): `Jungheirnich`→`Jungheinrich`,
   `AviAliance`→`AviAlliance`, `Digethics`→`Digethic`, `List Trendttag`→`Trendtag`.
3. **Datum (Tie-Breaker bei Mehrdeutigkeit).** Hat eine Firma mehrere Deals mit ähnlichem
   Namens-Score (Hochland, KPMG, edding, LivaNova …), entscheidet das **Buchungsdatum**.
   Zoho liefert nur das **Leistungsdatum** (`end_date`, kein Start) – Arbeit wird davor
   gebucht, also bekommt jede Buchung den Deal mit dem nächsten *kommenden* Leistungstermin.
4. **Split-Day-Kombis.** Excel-Einträge wie `Rauch / Amprion` (mehrere Kunden an einem Tag)
   werden am `/` getrennt, jede Seite einzeln gematcht, die Buchungszeit anteilig verteilt.

**Konfidenz-Buckets** (in `match-map.json` als `verdict`):

| Bucket | Bedeutung | Beim Import |
|---|---|---|
| `SICHER` | eindeutig (Name ≥75 % & Abstand, oder per Datum aufgelöst) | automatisch übernehmen |
| `SPLIT` | Firma streut über mehrere Deals/Termine | buchungsweise nach Datum aufteilen |
| `UNSICHER` | schwacher/mehrdeutiger Treffer | **manuell** prüfen (Top-3 in `candidates`) |
| `KEIN` | interne Kategorie / kein Zoho-Deal (Sales/Admin/TS/Intern/Akquise) | als Nicht-Zoho-Projekt anlegen oder ignorieren |

**Aktueller Stand** (153 Kandidaten ↔ 74 Zoho-Deals):
`SICHER 39 · SPLIT 3 · UNSICHER 9 · KEIN 88` · 22 Kombis aufgelöst.

Tuning-Schrauben oben in `match-zoho.mjs`: `SURE`, `MAYBE`, `PLAUS_MARGIN`, `DOMINANT`,
`fuzzyMax()`, `STOP` (Stopword-Liste).

> **Bekannte Grenzfälle:** `La Futura`→`Futuro` (Fuzzy-Zufall, korrekt als UNSICHER
> abgefangen), `Support Nils …`→ÖBB (Generik-Token „support", 1 Buchung). Solche Fälle
> landen bewusst nicht automatisch in SICHER.

---

## 5. `match-map.json` – das Übergabeformat

```jsonc
{
  "generatedFrom": "…/import-data.js",
  "zohoCount": 74, "candidateCount": 153,
  "decisions": [
    { "key": "straumann", "display": "Straumann", "aliases": ["Straumann"],
      "bookings": 60, "verdict": "SICHER", "by": "name",
      "match": { "zohoId": "…", "zohoName": "Straumann- Front End…", "offer": "A - 7821" },
      "split": null, "candidates": null },
    { "key": "edding", "verdict": "SPLIT", "by": "datum",
      "split": [ { "zohoId": "…", "zohoName": "Edding-Trend…", "days": 20 },
                 { "zohoId": "…", "zohoName": "edding_Strategic…", "days": 13 } ] },
    { "key": "straumann zdf", "verdict": "UNSICHER",
      "candidates": [ { "zohoName": "Straumann- Front End…", "score": 0.5 } ] }
  ],
  "combos": [ { "name": "Rauch / Amprion", "parts": ["rauch","amprion"] } ]
}
```

`key` = token-normalisierter Name → stabiler, deterministischer Schlüssel je Excel-Projekt
(eignet sich als Dedup-/Idempotenz-Key für Nicht-Zoho-Projekte).

---

## 6. Echter Import & Delta

**Status: gebaut & angewandt** (`import-to-db.mjs`). Erster Lauf: **20 Mitarbeiter,
101 Excel-Projekte, 3063 Buchungen** (2499 Projekt-Tasks, 1080 System, 143 übersprungen).
Verifiziert idempotent (2. Lauf → unverändert) und auf den echten Zoho-Projekten verbucht
(Beumer 68, Straumann 60, LivaNova 51 …).

**Was der Writer tut:**
1. **Mitarbeiter** – Insert-wenn-nicht-vorhanden (Dedup über Name; Excel hat keine Mail).
2. **Projekte** – SICHER/SPLIT referenzieren den bestehenden Supabase-Projekt-Eintrag direkt
   über `projects.id` (in `match-map` als `zohoId` geführt – das ist die **UUID**, nicht die
   Zoho-external_id!). UNSICHER/KEIN → `source='excel'`-Projekt mit `external_id='excel:<key>'`.
   System (Urlaub/Krank/Frei/Kurzarbeit/Admin) → bestehende `is_system`-Projekte über Name.
3. **Buchungen** – je Task; deterministischer `external_id = billy:<emp>:<start>:<end>:<ziel>`,
   `source='excel'`. Upsert über den **partiellen** Unique-Index → `on conflict (external_id)
   where external_id is not null`.

**Wichtige Normalisierungen/Regeln (im Writer):**
- **Budget** auf das App-Modell **{0.5, 1}** gezwungen (`bookings.budget`-CHECK) – Excel-Werte
  >1 → 1, Kombi-Anteil → 0,5 Tag. Über das App-Modell hinausgehende Überbuchungen gehen verloren.
- **Kombi-Split nur bei Zoho-Treffer:** `Rauch / Amprion` wird gesplittet; rein interne Kombis
  wie `Admin/Sales` bleiben **ein** Excel-Projekt (sonst Verdopplung + Dummy-„admin").
- **Skip:** Feiertag (App rechnet Feiertage selbst) + Müll (reine Zahlen/Datumsfragmente).
- **Dedup:** mehrere Frei-/Ausgleich-Varianten am selben Tag/Mitarbeiter → eine System-Buchung.

**Delta / Re-Import mit neueren Daten** – Pipeline A–E erneut laufen lassen:
- `bookings.external_id` ist inhaltsbasiert (Name+Datum+Ziel) → **stabil über Neugenerierungen**;
  gleiche Buchung = Update, neue = Insert.
- Vor jedem Lauf `export-zoho.sh` neu ziehen, damit neue/aktualisierte Zoho-Deals im Matching sind.

**Parallelbetrieb mit Google Docs (`--prune`)** – für den Zeitraum, in dem noch im Google-Docs
weitergeplant wird und die App nicht die Quelle der Wahrheit ist:
- Ohne prune ist der Import **rein additiv**: eine im Doc *verschobene*, *umgewidmete* oder
  *gelöschte* Buchung hinterlässt eine **Waise** in Supabase (der neue Inhalt bekommt einen neuen
  `external_id`, der alte bleibt stehen) → die App läuft mit Doppelbuchungen voll.
- `node tools/import/import-to-db.mjs --prune [--apply]` löscht deshalb im **importierten
  Datumsfenster** (`min(start) .. max(end)` der aktuellen xlsx, derzeit nur 2026-Tabs) alle
  `source='excel'`-Buchungen, deren `external_id` im aktuellen Lauf **nicht** mehr vorkommt.
  Ergebnis: Supabase spiegelt exakt den aktuellen Google-Docs-Stand.
- **Unberührt bleiben:** app-native Buchungen (`source<>'excel'`) und alle Zoho-Projekte
  (nur der Buchungs-Payload wird gepruned, nie `projects`). Schutz: bei 0 Buchungen im Lauf
  wird prune übersprungen (keine Totallöschung).
- Empfohlener Loop bei jeder Google-Docs-Änderung: xlsx exportieren → A, B, D, dann
  `import-to-db.mjs --prune --apply`.

**Offen / Verbesserungen:**
- **Excel „Admin"-Kategorie vs. System „Admin":** existieren parallel (Excel-Kategorie ≠ UNI→Admin).
  Bei Bedarf in der App zusammenführen.

---

## 7. Manuelle Overrides (`overrides.json`) – überleben Re-Runs

UNSICHER-Fälle (und falsche SICHER/SPLIT) lassen sich manuell festklopfen, ohne die Heuristik
anzufassen. `match-zoho.mjs` liest `tools/import/overrides.json` und wendet sie **vor** Report +
`match-map.json` an → die Entscheidung fließt deterministisch durch die ganze Pipeline und
überlebt jeden Delta-Lauf.

**Format** (Key = normalisierter Excel-Key aus `match-map.json` `.decisions[].key`):

```jsonc
{
  "straumann zdf": "A - 7821",                        // per Angebotsnummer
  "customer development": "Livanova - Begleitung …",  // per exaktem Zoho-Deal-Namen
  "school hanne": "4f4181d2-…",                       // per projects-UUID
  "la futura": "KEIN"                                 // bewusst KEIN Zoho-Deal → eigenes Excel-Projekt
}
```

- Ziel wird gegen `zoho-projects.json` aufgelöst (**Angebotsnr → UUID → Deal-Name**, in der
  Reihenfolge). Angebotsnummer ist die robusteste Wahl (menschenlesbar + stabil).
- Overrides greifen **unabhängig vom heuristischen Verdict** – korrigieren also auch Fehltreffer.
- Keys mit führendem `_` werden ignoriert (Doku/Referenz). Die mitgelieferte Datei enthält unter
  `_kandidaten` die 9 aktuellen UNSICHER-Fälle mit Top-Vorschlag als Nachschlage-Hilfe – **bewusst
  ohne** aktive Zuordnung (mehrere Top-Kandidaten sind erkennbare Fehltreffer).
- **Keine stille Fehlerunterdrückung:** tote Keys (kein passender Excel-Kandidat) und nicht
  auflösbare Ziele werden im Report (Sektion „🔧 Manuelle Overrides") **und** auf der Konsole gewarnt.

Ablauf: Zeile in `overrides.json` eintragen → `node tools/import/match-zoho.mjs` → im Report prüfen
→ `node tools/import/import-to-db.mjs --prune --apply`.
