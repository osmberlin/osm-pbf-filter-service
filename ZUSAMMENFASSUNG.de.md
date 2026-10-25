# Zusammenfassung

> Kurzfassung des Vorhabens. Details in [PLAN.md](PLAN.md) (Englisch).
> **Stand 2026-10-25:** Pipeline lokal getestet, auf dem Server noch nicht gelaufen.

## Worum geht es?

Ein Dienst, der **einmal täglich** aktuelle OSM-Daten vorhält und daraus
**projektspezifische Ausschnitte** (`.osm.pbf`) erzeugt — gefiltert nach
**Region** (Polygon) und nach **Tags** (osmium-Filter). Die Ausschnitte stehen
über **stabile öffentliche Download-URLs** bereit.

Alles wird über **dieses Git-Repository** gesteuert: Konfiguration als Dateien,
Ausführung über **GitHub Actions auf einem self-hosted Runner**. Ziel ist
**möglichst wenig manuelle Server-Arbeit**.

## Wie funktioniert es?

1. **Eingabe:** statt des ganzen Planeten die **Kontinent-Extrakte von
   Geofabrik** ("Quellen"). Zunächst nur **Europa** (~35 GB); weitere Kontinente
   sind vorbereitet. Die Dateien liegen auf dem Server und werden **täglich** mit
   Geofabriks Diffs (`pyosmium-up-to-date`) aktualisiert. Fehlende Quellen
   werden automatisch geladen, ein Neu-Download läuft manuell auf Knopfdruck.
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

- **Eigener Hetzner-Cloud-Server CX43** (8 vCPU, 16 GB RAM, 160 GB NVMe,
  ca. 16 €/Monat, dauerhaft an), Debian 12. nginx liefert die Dateien aus, kein
  S3. Gemessen lokal (Deutschland als Europa-Ersatz): 5 Projekte in ~8,5 Minuten,
  5,3 GB RAM-Spitze.
- Einmalige Provisionierung per **Ansible-Rolle** (`server/ansible/`): Pakete,
  Nutzer, Verzeichnisse, nginx. Nur die **Runner-Registrierung** bleibt manuell.
  Danach läuft alles über die Workflows (`daily.yml` täglich 02:17 UTC).
- **Wichtig (Sicherheit):** Repo ist öffentlich, der Runner muss abgesichert
  sein (keine Fremd-PRs ausführen, eigener unprivilegierter Nutzer, kein freies
  `sudo`) — siehe PLAN.md §A3. Die GitHub-Einstellungen dafür sind gesetzt.
- **FOSSGIS-uMap-Server:** diese Variante ist **pausiert**. Abgestimmt mit den
  FOSSGIS-Admins: sie bekäme später eine **eigene Ansible-Rolle** mit eigenen
  Ordnern und Nutzern, getrennt von uMap. Der Umzug ist im Kern ein anderes
  Inventory.

## Offene Punkte

1. **Subdomain + TLS** für die Downloads.
2. **Erster echter Lauf mit Europa** (Laufzeit, RAM) auf dem Server.
3. Ein zweiter Admin mit Root-Zugriff als Vertretung.

Kosten- und Hosting-Vergleich: [docs/poc-hosting.md](docs/poc-hosting.md).
