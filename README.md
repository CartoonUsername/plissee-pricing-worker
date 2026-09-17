# Plissee-Preis-Checkout (Cloudflare Worker)

Löst ein Problem, das nur auf Shopify-Plänen **unterhalb Plus** besteht:
Shopify kann den Warenkorb-Zeilenpreis nicht automatisch an die
Plissee-Konfiguration (Breite/Höhe/Stoff) anpassen — die
Cart-Transform-Function-`update`-Operation dafür ist Plus-exklusiv. Ohne
diesen Worker würde jeder Kunde beim Checkout immer den festen Preis der
einen Shopify-Produktvariante zahlen, unabhängig von der Konfiguration.

**Ablauf:** Kunde konfiguriert im Theme → "In den Warenkorb" ruft (falls im
Theme-Editor eine Worker-URL hinterlegt ist, siehe unten) diesen Worker auf,
statt `/cart/add` → der Worker berechnet den Preis **selbst, serverseitig,
neu** aus Breite/Höhe + Stoff-/Schienen-/Klemmträger-**ID** (nie aus einem
vom Client mitgeschickten Endpreis) → legt eine Shopify-Entwurfsbestellung
mit exakt diesem Preis an → der Kunde wird zur echten Shopify-Kasse dieser
Bestellung weitergeleitet und bezahlt dort normal.

## Voraussetzungen

- Ein (kostenloses) Cloudflare-Konto: https://dash.cloudflare.com/sign-up
- Node.js (bereits vorhanden)
- Eine Shopify-App über das **Dev Dashboard** mit Scope `write_draft_orders`
  (siehe Schritt 1) — die neueren Shopify-Apps geben KEINEN dauerhaften
  Admin-API-Token mehr direkt aus, siehe Erklärung unten.

## 1. Shopify-App erstellen (Dev Dashboard)

1. Shopify-Adminbereich → *Einstellungen* → *Apps und Vertriebskanäle* →
   *Apps entwickeln* → **"App erstellen"** → **"Vom Dev Dashboard aus
   starten"** → Namen vergeben (z. B. "Plissee Preis-Checkout") → erstellen.
2. Bei *API-Zugriff* → *Bereiche* → **`write_draft_orders`** eintragen (per
   "Bereiche auswählen" oder direkt eintippen). App-URL und
   Weiterleitungs-URL können eure normale Shop-URL sein (werden für unseren
   Zweck nicht wirklich aufgerufen).
3. Ganz unten **"Veröffentlichen"**.
4. Im App-Dashboard → **"App-Einstellungen"** → Abschnitt **"Anmeldedaten"**:
   dort stehen **Client-ID** und **Schlüssel (Client-Secret)** — beide
   kopieren.

   Wichtig: Das ist **kein** fertiger Admin-API-Token wie bei alten "Custom
   Apps" — dieser Worker holt sich bei jedem Aufruf selbst einen kurzlebigen
   Token via ["Client Credentials Grant"](https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens)
   (funktioniert nur für Apps auf dem EIGENEN Shop, genau unser Fall — kein
   zusätzlicher Installationsschritt eines Merchants nötig).

## 2. Worker konfigurieren

In `wrangler.toml` (bereits eingetragen, prüfen ob korrekt):
- `SHOPIFY_SHOP_DOMAIN`: eure `*.myshopify.com`-Domain (unten links im
  Code-Editor des Themes sichtbar, z. B. `b8x6hc-0h.myshopify.com`).
- `ALLOWED_ORIGIN`: eure echte(n) Shop-Domain(s) mit `https://`, kommagetrennt
  bei mehreren.

Client-ID/-Secret aus Schritt 1 NIEMALS hier eintragen — als Secrets setzen:

```bash
npm install
npx wrangler login          # einmalig, öffnet Browser-Login zu Cloudflare
npx wrangler secret put SHOPIFY_CLIENT_ID
# → fragt interaktiv nach dem Wert, hier die Client-ID aus Schritt 1.4 einfügen
npx wrangler secret put SHOPIFY_CLIENT_SECRET
# → hier den Schlüssel (Client-Secret) aus Schritt 1.4 einfügen
```

## 3. Deployen

```bash
npx wrangler deploy
```

Gibt am Ende eine URL aus wie
`https://plissee-pricing-worker.<dein-cloudflare-name>.workers.dev` — diese
URL im Shopify-Theme-Editor bei der Plissee-Konfigurator-Section unter
**"Preis-Checkout-Endpunkt"** eintragen. Danach läuft "In den Warenkorb"
automatisch über diesen Worker statt über den normalen Shopify-Warenkorb.

Leer lassen (Standard) = normales `/cart/add` bleibt aktiv — z. B. sinnvoll,
falls ihr später auf Shopify Plus wechselt und stattdessen eine
Cart-Transform-Function nutzen wollt.

## 4. Testen

- Auf einer Entwurfs-Theme-Vorschau eine Konfiguration durchklicken, "In den
  Warenkorb" — sollte zu einer Shopify-Kassenseite mit korrektem,
  konfigurationsabhängigem Preis weiterleiten.
- Prüfen, ob unter *Bestellungen → Entwürfe* im Adminbereich ein Eintrag mit
  den richtigen Eigenschaften (Breite, Höhe, Stoff, …) erscheint.

## Preise/Raten aktualisieren

`src/pricing-data.json` ist die **Kopie** der Preis-Formel + aller
Stoff-/Schienen-/Klemmträger-Aufpreise aus dem Theme (aus Sicherheitsgründen:
der Worker vertraut nie einem vom Browser mitgeschickten Preis, sondern
berechnet ihn aus seiner EIGENEN Kopie neu). Ändert ihr Grundpreis, Raten
oder Aufpreise im Theme-Editor, muss diese Kopie neu erzeugt und der Worker
neu deployt werden:

```bash
npm run generate-pricing   # liest ../plissee-konfigurator/sections/plissee-configurator.liquid
npx wrangler deploy
```

(Voraussetzung: der `plissee-konfigurator`-Ordner liegt wie hier im Repo
üblich als Geschwister-Ordner daneben.)

## Bekannte Grenzen

- **Breite/Höhe werden nicht kryptografisch geprüft**, nur auf den erlaubten
  Bereich (min/max) begrenzt — Stoff-/Schienen-/Klemmträger-Aufpreise dagegen
  schon (werden immer per ID aus der eigenen Kopie nachgeschlagen, nie vom
  Client übernommen). Für die allermeisten Made-to-Measure-Shops ein
  akzeptables Risiko; bei Bedarf ausbaufähig.
- CORS schützt nur Browser-Aufrufe von fremden Seiten, kein serverseitiges
  Rate-Limiting eingebaut — bei Bedarf in den Cloudflare-Dashboard-
  Einstellungen für diesen Worker eine Rate-Limiting-Regel ergänzen.
