# Zusammenfassung

> Kurzfassung des Vorhabens. Details in [PLAN.md](PLAN.md) (Englisch).
> **Stand 2026-10-26:** Pipeline lokal getestet (auch das komplette nächtliche Skript mit einem Ordner statt R2), Hetzner und R2 noch nicht echt gelaufen.

## Worum geht es?

Ein Dienst, der **einmal täglich** aktuelle OSM-Daten vorhält und daraus
**projektspezifische Ausschnitte** (`.osm.pbf`) erzeugt — gefiltert nach
**Region** (Polygon) und nach **Tags** (osmium-Filter). Die Ausschnitte stehen
über **stabile öffentliche Download-URLs** bereit.

Alles wird über **dieses Git-Repository** gesteuert: Konfiguration als Dateien,
Ausführung über **GitHub Actions**. Ziel ist **möglichst wenig manuelle
Server-Arbeit**: es läuft kein dauerhafter Server.

## Wie funktioniert es?

1. **Eingabe:** statt des ganzen Planeten die **Kontinent-Extrakte von
   Geofabrik** ("Quellen"). Zunächst nur **Europa** (~35 GB); weitere Kontinente
   sind vorbereitet. Die Dateien liegen zwischen den Läufen in einem **Cloudflare-R2-Bucket** und
   werden **täglich** mit Geofabriks Diffs (`pyosmium-up-to-date`) aktualisiert. Fehlende Quellen
   werden automatisch geladen, ein Neu-Download läuft manuell über den Workflow-Parameter `reseed`.
2. **Danach:** Ein Python-Skript liest alle Projekt-Konfigurationen, ermittelt
   welche Quellen/Länder überhaupt gebraucht werden, und berechnet pro Ebene die
   **Vereinigung der benötigten Tags**. Es wird von oben nach unten extrahiert
   (`Quelle → Land → Projekt`), eine Quelle nach der anderen mit Aufräumen
   dazwischen. Projekte mit `area: {region: world}` werden aus allen Quellen
   gefiltert und zusammengeführt (`osmium merge` + `time-filter`).
3. **Ergebnis:** Pro Projekt eine `latest.osm.pbf` plus `status.json`
   (Datenalter, Lauf-Zeitpunkte, Dauer). Konfiguration und Status werden
   eingecheckt → in Git **nachvollziehbar**, Logs **sichtbar in den Actions**.

## Was bedeutet das für den Server?

- **Kein dauerhafter Server** (zu teuer: ein CPX42 mit 8 vCPU/16 GB kostet
  ca. 83 €/Monat inkl. MwSt.; die günstige CX-Reihe ist derzeit nicht verfügbar).
  Stattdessen legt `daily.yml` (täglich 02:17 UTC, normaler GitHub-Runner) jede
  Nacht einen **Wegwerf-Server bei Hetzner** an (cpx42/ccx33/cpx52, je nach
  Verfügbarkeit), installiert das Werkzeug per **Ansible-Rolle**, baut die
  Ausschnitte, lädt alles nach R2 und **löscht den Server immer** wieder.
- **Speicher und Auslieferung: Cloudflare R2** (Bucket `osm-extracts`,
  vorerst öffentlich über r2.dev, später eigene Domain). Kein nginx. R2 statt
  Hetzner-Volume: kein Standort-Zwang, ca. 0,015 $/GB, Downloads kostenlos.
- **Kosten:** Server ca. 0,13 €/h × 1–2 h pro Nacht (ca. 4–8 €/Monat) plus R2
  ca. 1–2 $/Monat. Gemessen lokal (Deutschland als Europa-Ersatz): 5 Projekte in
  ~8,5 Minuten, 5,3 GB RAM-Spitze.
- **Sicherheit:** Es gibt keinen self-hosted Runner mehr. Wichtig sind die
  GitHub-Secrets (`HCLOUD_TOKEN`, `SSH_PRIVATE_KEY`, R2-Zugangsdaten) und dass
  Fremd-PRs sie nie sehen — die GitHub-Einstellungen dafür sind gesetzt.
  Einrichtung Schritt für Schritt: [docs/setup.md](docs/setup.md).
- **FOSSGIS-uMap-Server:** diese Variante ist **pausiert**. Abgestimmt mit den
  FOSSGIS-Admins: sie bekäme später eine **eigene Ansible-Rolle** mit eigenen
  Ordnern und Nutzern, getrennt von uMap. Die Rolle hat dafür einen
  Dauerbetrieb-Modus (`osm_serve: true`: nginx, Firewall, TLS).

## Offene Punkte

1. **Einrichtung durchführen** (R2-Bucket, Tokens, Secrets) und den ersten
   echten Lauf mit Europa machen (Laufzeit, RAM, welche Servertypen verfügbar sind).
2. **Eigene Domain** für den Bucket statt r2.dev (später).
3. Falls FOSSGIS zurückkommt: zweiter Admin mit Root-Zugriff als Vertretung.

Kosten- und Hosting-Vergleich: [docs/poc-hosting.md](docs/poc-hosting.md).
