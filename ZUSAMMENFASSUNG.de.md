# Zusammenfassung (für die FOSSGIS-Runde)

> Kurzfassung des Vorhabens. Details in [PLAN.md](PLAN.md) (Englisch).
> **Status:** Konzept + Entwurfsgerüst, noch nicht produktiv.

## Worum geht es?

Ein Dienst, der auf einem Server **einmal täglich** eine aktuelle weltweite
OSM-Datei vorhält und daraus **projektspezifische Ausschnitte** (`.osm.pbf`)
erzeugt — gefiltert nach **Region** (Polygon) und nach **Tags** (osmium-Filter).
Die Ausschnitte stehen über **stabile öffentliche Download-URLs** bereit.

Alles wird über **dieses Git-Repository** gesteuert: Konfiguration als Dateien,
Ausführung über **GitHub Actions auf einem self-hosted Runner**. Ziel ist
**möglichst wenig manuelle Server-Arbeit**.

## Wie funktioniert es?

1. **Täglich:** Die weltweite Datei (`planet.osm.pbf`, ~87 GB) wird per
   `pyosmium-up-to-date` mit den OSMF-Diffs aktualisiert. Ein **Neu-Download**
   läuft nur manuell auf Knopfdruck.
2. **Danach:** Ein Bun-Skript liest alle Projekt-Konfigurationen, ermittelt
   welche Kontinente/Länder überhaupt gebraucht werden, und berechnet pro Ebene
   die **Vereinigung der benötigten Tags**. So wird von oben nach unten
   extrahiert (`Welt → Kontinent → Land → Projekt`) und jede Zwischenstufe bleibt
   klein und schnell.
3. **Ergebnis:** Pro Projekt eine `latest.osm.pbf` plus `status.json`
   (Datenalter, Lauf-Zeitpunkte, Dauer). Konfiguration und Status werden
   eingecheckt → in Git **nachvollziehbar**, Logs **sichtbar in den Actions**.

## Was bedeutet das für den Server?

- Läuft auf dem bestehenden **FOSSGIS-uMap-Server bei Hetzner** (geteilt mit
  uMap), **~585 GB Platte**. 87-GB-Planet + Zwischen-/Endausschnitte passen
  komfortabel; eng wird es nur kurz beim Neu-Download (~2× Planet).
- Einmalige Provisionierung per **Ansible-Rolle** (`server/ansible/`, soll in das
  FOSSGIS-Setup eingebunden werden): Pakete, Nutzer, Verzeichnisse, nginx. Nur die
  **Runner-Registrierung** bleibt manuell. Danach läuft alles über die Workflows.
- **Wichtig (Sicherheit):** Repo ist öffentlich + Server geteilt mit uMap. Der
  Runner muss abgesichert werden (keine Fremd-PRs ausführen, eigener
  unprivilegierter Nutzer, kein freies `sudo`) — siehe PLAN.md §A3.

## Was wir von euch brauchen

1. **Abstimmung mit Lars Lingner / den FOSSGIS-OSM-Server-Admins** zur
   Runner-Einrichtung und Koexistenz mit uMap (Platte/IO).
2. **Server-Eckdaten** (CPU/RAM, SSD oder HDD) — stehen nicht im öffentlichen
   Wiki, vermutlich im FOSSGIS-GitLab.
3. Eine **Subdomain + TLS** für die Downloads (evtl. vom uMap-Host ableitbar).

## Quellen (Server)

- [Förderantrag uMap-Instanz](https://www.fossgis.de/wiki/F%C3%B6rderantr%C3%A4ge/umap_instanz)
- [FOSSGIS IT-Technik](https://www.fossgis.de/wiki/IT-Technik)
- [OSM-Wiki: FOSSGIS/Server](https://wiki.openstreetmap.org/wiki/FOSSGIS/Server)
