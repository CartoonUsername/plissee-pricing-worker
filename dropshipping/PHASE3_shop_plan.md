# Phase 3: Shop-Aufbauplan (Entwurf, **nichts angelegt, Shop nicht live**)

Status 2026-10-07: TikTok-Werbekonto verbunden (advertiser_id 7693815558239961089, noch kein Pixel). Shopify-Connector in der Sitzung noch **nicht authentifiziert** -> Shop-Anlage/Produkte/Theme folgen, sobald `get-shop-info` funktioniert. Bis dahin: alles unten als Datei vorbereitet.

## 1. Marke (Arbeitstitel, vom Assistenten gewählt, Nutzer darf ändern)
**"Tavilo"**: frei erfundenes, kurzes, gut sprechbares Wort ohne Produktbezug, damit wir Haustier-, Poster- und weitere Linien unter einer Marke führen können.
- "Pfotenpost" verworfen (Domain pfotenpost.ch existiert). "Eigenart", "Sternenpfote" verworfen (bestehende Geschäfte bzw. falscher Ton). Ebenfalls verworfen: "Kuvira" (Figur aus einer Serie), "Nuvea" (zu nah an Nivea), "Miravo" (zu nah an Miravia), "Lunaro" (bestehende Sportart/Begriff).
- **Nicht geprüft/nicht freigegeben:** Die Websuche fand keinen Shop namens "Tavilo" in Deutschland; Domain-Abfrage war in dieser Sitzung nicht möglich. **Vor Kauf prüfen:** tavilo.de / tavilo.shop (Domain-Anbieter), DPMA- und EUIPO-Markenrecherche (Klassen 16, 18, 20, 21, 35), Social-Handle `tavilo` auf TikTok/Instagram.
- Linien: "Tavilo Pets" (A, Haustier-Personalisierung) und "Tavilo Sterne" (B, nur mit Haustier-Bezug).
- Alternativen falls belegt: "Tavrio", "Mellivo", "Orvina".
Palette: Creme #FAF7F2, Tiefblau #1E2A47, Akzent Terrakotta #D9774A. Schrift: Serif (Überschriften) + Sans (Text).

## 2. Struktur
- Ein Shop, zwei Kollektionen: "Für dein Tier" (A), "Sternenkarten" (B). Startseite: Hero, beide Kollektionen, so funktioniert's (3 Schritte), echte FAQ.
- Produktseiten (Entwurf, Inhalte erst mit Sample-Fotos): Nutzen-Titel, 5 Nutzenpunkte, Konfigurator (Name/Foto/Datum+Ort mit Live-Vorschau), Produktionszeit + Lieferzeit + Rückgabeinfo über dem Fold, FAQ, nur echte Vertrauenselemente (keine Fake-Reviews/-Timer/-Streichpreise).
- Konfigurator: Eingaben -> Vorschau -> Bestellung mit Personalisierungsdaten als Line-Item-Properties; nutzbare Basis: vorhandene eigene Konfigurator-Erfahrung (Plissee-Konfigurator), Umsetzung nach Shopify-Zugang.

## 3. Pflichtseiten (Entwürfe in `legal/`, **anwaltliche Prüfung nötig**)
Impressum, Datenschutz, AGB, Widerrufsbelehrung + Muster-Widerrufsformular, Versand & Lieferzeiten, Kontakt, Zahlungsarten. Kleinunternehmer-Hinweis §19 UStG (keine MwSt.). Hinweis auf Ausnahme vom Widerruf bei personalisierter Ware (§312g Abs. 2 Nr. 1 BGB) klar im Checkout. Button "zahlungspflichtig bestellen". Cookie-Consent vor Pixel. GPSR-Angaben (Hersteller/EU-Verantwortlicher) je Produkt vom Lieferanten einholen.

## 4. Checkout
Shopify Payments, PayPal, Klarna (Freischaltung/KYC macht der Nutzer selbst). Steuer: Kleinunternehmer-Einstellung (keine Steuer ausweisen) und Versand DE. **Zahlungs-/Steuereinstellungen nur nach deinem "Ja"**.

## 5. Automatisierung
Gelato/Printful-App verbinden (Konto durch Nutzer) -> Auto-Fulfillment nach "Go live" (Dauerfreigabe liegt vor, vorher inaktiv). E-Mails: Bestellbestätigung (mit Produktionszeit), Versand mit Tracking, Warenkorb-Abbruch (nur ehrliche Texte, rechtlich zulässig/Consent beachten). Support-Textbausteine in `legal/support_textbausteine.md`.

## 6. Tracking
TikTok-Pixel + Events API (ViewContent, AddToCart, InitiateCheckout, Purchase) über Shopify-TikTok-App, erst nach Consent; Testlauf mit Test-Events-Tool vor Go live. Pixel existiert noch nicht (Liste leer), Anlage nach "Ja".

## Offene Entscheidungen / Blocker
1. Markenname (siehe oben).
2. Shopify: Store anlegen (durch dich) + Connector neu authentifizieren/neue Sitzung.
3. Gelato/Printful-Konto + Sample-Preise (durch dich).
