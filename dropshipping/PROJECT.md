# PROJECT: Dropshipping-Shop DE (Shopify + Higgsfield + TikTok)

Status: Phase 0 (Klärung). Stand: 2026-10-06

## Ziel
Shopify-Shop in einer Nische aufbauen, organisch über TikTok starten, erste echte Verkäufe in den ersten Wochen. Wiederholbarer, möglichst automatisierter Ablauf.

## Harte Regeln (Kurzfassung)
1. Keine Zugangsdaten im Chat; nur `.env` (gitignored) / Umgebungsvariablen, minimale Rechte.
2. Freigabe ("Ja") vor jeder Aktion mit Außenwirkung (Shop live, TikTok-Posts, Ads, Nachrichten, Zahlungs-/Steuereinstellungen).
3. Kein Geld ohne Freigabe; Limits unten.
4. Rechtssicher DE/EU (Impressum, DSE, AGB, Widerruf, Preisangaben, Button-Lösung, Cookie-Consent, GPSR/CE). Kein Anwalt – alles markieren, was geprüft werden muss.
5. Keine Täuschung (Fake-Reviews, Fake-Timer, falsche Streichpreise, geschützte Marken).
6. Nur erlaubte, sichere Produkte.
7. Ehrliche, konservative Zahlen.

## Limits (vom Nutzer festzulegen)
- Gesamtbudget Tests: 500 EUR
- Tägliches Werbelimit: 20 EUR
- Zeit pro Woche: 10 Stunden

## Rahmenbedingungen (offen)
- Gewerbe: vorhanden, Kleinunternehmer (§19 UStG: keine MwSt. ausweisen, Hinweis im Shop nötig; Umsatzgrenze beachten)
- Markt: nur Deutschland
- Tabus: keine (harte Regeln 5+6 gelten trotzdem)

## Verbindungen (Stand 2026-10-06)
| Dienst | Status |
|---|---|
| Higgsfield | verbunden, Plan "plus", 1134,73 Credits |
| TikTok (via Higgsfield-Connector) | Konnektor vorhanden, **kein Account verbunden** |
| Shopify | **kein Connector/Tool verfügbar** (Alternative: Admin API mit minimalen Scopes via `.env` oder Shopify CLI) |

## Entscheidungen
- 2026-10-06 Produktwahl: Nr. 2 Hoodie-Kuscheldecke (Zielpreis 39 EUR). Phase 2 siehe PHASE2_unit_economics.md.

## Automatisierungs-Modell (Stand 2026-10-06)
Ziel: Aufbau bis erste Bestellung weitgehend automatisch, Bestellweiterleitung an den Produzenten ohne manuelles Versenden.
- Bestellweiterleitung: **POD-App im Shopify** (Gelato oder Printful) leitet bezahlte Bestellungen automatisch an die Produktion und schickt Tracking zurück. Einmalige Einrichtung + einmalige Freigabe durch den Nutzer, danach läuft es ohne Einzel-Freigabe.
- Von mir automatisierbar: Shop-Aufbau im Entwurfsmodus, Produkt-/Pflichtseiten-Entwürfe, Konfigurator, E-Mail-Flows, Tracking-Setup, Content (Skripte, Higgsfield mit Kostenfreigabe), Wochenberichte.
- Nur der Nutzer kann: Konten anlegen/Bezahlmethoden hinterlegen (Anbieter, Shopify Payments/KYC), rechtliche Texte final prüfen lassen, "Go live", Ads-Budget freigeben.
- Dauerfreigabe-Vorschlag: Auto-Fulfillment innerhalb des Budgets (500 EUR gesamt) nach Go live; Posts und Ads weiterhin pro Freigabe.
- Blocker: Shopify-Connector in dieser Sitzung nicht authentifiziert; kein TikTok-Werbekonto. (TikTok-Creator seit 2026-10-07 verbunden.)

## Dauerfreigabe (vom Nutzer erteilt am 2026-10-06)
"Dauerfreigabe Auto-Fulfillment nach Go live":
- Gilt NUR für die automatische Weiterleitung bezahlter Kundenbestellungen an den POD-Produzenten (Gelato/Printful-App) NACH ausdrücklichem "Go live" des Nutzers.
- Rahmen: Gesamtbudget 500 EUR; Produktionskosten bezahlter Bestellungen werden aus Kundenzahlungen gedeckt.
- Gilt NICHT für: Go live selbst, TikTok-Posts, Ads/Werbebudget, Nachrichten an Lieferanten/Kunden, Zahlungs-/Steuereinstellungen. Dafür weiter Freigabe pro Fall.
- Vor Go live: nicht aktiv.
