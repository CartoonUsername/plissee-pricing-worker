/**
 * Plissee-Preis-Checkout — Cloudflare Worker
 *
 * Grund für dieses Backend: Shopify-Basic-Plan kann Zeilenpreise im
 * Warenkorb NICHT per Cart-Transform-Function anpassen (das "update"-
 * Operation ist Shopify-Plus-exklusiv). Ohne diesen Umweg würde der
 * konfigurierte Preis nur angezeigt, beim Checkout aber immer der feste
 * Preis der einen Produktvariante berechnet — unabhängig von Maßen/Stoff.
 *
 * Ablauf: Der Kunde konfiguriert im Theme (plissee-configurator.js), klickt
 * "In den Warenkorb" → das Theme schickt NICHT an /cart/add, sondern hierher
 * (siehe assets/plissee-pricing-integration.js im Theme). Dieser Worker
 * berechnet den Preis SELBST aus rohen Eingaben (Breite/Höhe/IDs) — er
 * vertraut NIE einem vom Client mitgeschickten Endpreis — und legt darauf
 * eine Shopify-Entwurfsbestellung (Draft Order) mit exakt diesem Preis an.
 * Der Kunde wird zur echten Shopify-Kasse dieser Entwurfsbestellung
 * weitergeleitet und bezahlt dort ganz normal.
 *
 * Restrisiko (bewusst in Kauf genommen, wie bei den meisten Shops mit
 * Maßanfertigung): Breite/Höhe kommen vom Client und werden hier nur auf den
 * erlaubten Bereich (min/max) geprüft, nicht kryptografisch verifiziert. Nur
 * Stoff/Schiene/Klemmträger-Aufpreise sind vor Manipulation sicher, weil sie
 * per ID aus PRICING.items nachgeschlagen werden, nie vom Client übernommen.
 */
import PRICING from "./pricing-data.json";

const ADMIN_API_VERSION = "2025-01";

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
  });
}

/** Exakt dieselbe Formel wie computeUnitPrice() in plissee-configurator.js —
 * bei Änderungen dort IMMER auch hier nachziehen. */
function computeUnitPrice(width, height, fabric, rail, bracket) {
  const base = PRICING.rates.baseFee + (width / 100) * PRICING.rates.pricePerMeterWidth + (height / 100) * PRICING.rates.pricePerMeterHeight;
  const surcharge = (fabric ? fabric.surcharge : 0) + (rail ? rail.surcharge : 0) + (bracket ? bracket.surcharge : 0);
  const unit = Math.max(base + surcharge, PRICING.rates.minPrice);
  return Math.round(unit * 100) / 100;
}

function validateAndPrice(rawItem) {
  const width = Number(rawItem.width);
  const height = Number(rawItem.height);
  const quantity = Math.max(1, Math.min(20, Math.round(Number(rawItem.quantity) || 1)));

  if (!Number.isFinite(width) || width < PRICING.rates.minWidth || width > PRICING.rates.maxWidth) {
    throw new Error("Breite außerhalb des gültigen Bereichs.");
  }
  if (!Number.isFinite(height) || height < PRICING.rates.minHeight || height > PRICING.rates.maxHeight) {
    throw new Error("Höhe außerhalb des gültigen Bereichs.");
  }

  const fabric = PRICING.items[rawItem.fabricId];
  if (!fabric || fabric.type !== "fabric") throw new Error("Unbekannter Stoff.");
  const rail = rawItem.railId ? PRICING.items[rawItem.railId] : null;
  if (rawItem.railId && (!rail || rail.type !== "rail")) throw new Error("Unbekannte Schiene.");
  const bracket = rawItem.bracketId ? PRICING.items[rawItem.bracketId] : null;
  if (rawItem.bracketId && (!bracket || bracket.type !== "bracket")) throw new Error("Unbekannter Klemmträger.");

  const unitPrice = computeUnitPrice(width, height, fabric, rail, bracket);

  const title = "Plissee " + width.toFixed(0) + "×" + height.toFixed(0) + " cm – " + fabric.name;
  const customAttributes = [
    { key: "Breite", value: width.toFixed(1) + " cm" },
    { key: "Höhe", value: height.toFixed(1) + " cm" },
    { key: "Stoff", value: fabric.name },
  ];
  if (rail) customAttributes.push({ key: "Schiene", value: rail.name });
  if (bracket) customAttributes.push({ key: "Klemmträger", value: bracket.name });
  if (rawItem.type === "tuer") customAttributes.push({ key: "Typ", value: "Glastür (bodentief)" });
  if (rawItem.room) customAttributes.push({ key: "Raum", value: String(rawItem.room).slice(0, 60) });
  if (rawItem.note) customAttributes.push({ key: "Anmerkung", value: String(rawItem.note).slice(0, 500) });

  return {
    title,
    quantity,
    originalUnitPrice: unitPrice.toFixed(2),
    customAttributes,
  };
}

const DRAFT_ORDER_MUTATION = `
  mutation plisseeDraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id invoiceUrl }
      userErrors { field message }
    }
  }
`;

/** Das neuere "Dev Dashboard"-App-Modell (Client-ID + Client-Secret) gibt
 * KEINEN dauerhaften Admin-API-Token mehr direkt im Adminbereich aus (anders
 * als die alten "Custom Apps"). Für eine App, die nur auf dem EIGENEN Shop
 * läuft, ist der "Client Credentials Grant" der richtige Weg: bei jedem
 * Aufruf einen kurzlebigen Token (24 Std. gültig) live anfordern, statt
 * einen fest gespeicherten Token zu nutzen. Da dieser Worker nur bei
 * "In den Warenkorb"-Klicks läuft (kein Hochfrequenz-Traffic), lohnt sich
 * Caching hier nicht — einfach jedes Mal frisch anfordern.
 * https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens */
async function getAccessToken(env) {
  const res = await fetch("https://" + env.SHOPIFY_SHOP_DOMAIN + "/admin/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(function () { return ""; });
    throw new Error("Token-Anfrage an Shopify fehlgeschlagen (" + res.status + "): " + bodyText.slice(0, 300));
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Shopify lieferte keinen Zugangstoken.");
  return data.access_token;
}

async function createDraftOrder(env, lineItems) {
  const accessToken = await getAccessToken(env);
  const res = await fetch("https://" + env.SHOPIFY_SHOP_DOMAIN + "/admin/api/" + ADMIN_API_VERSION + "/graphql.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: DRAFT_ORDER_MUTATION,
      variables: { input: { lineItems } },
    }),
  });
  if (!res.ok) throw new Error("Shopify Admin API antwortete mit " + res.status);
  const data = await res.json();
  const errs = data.errors || (data.data && data.data.draftOrderCreate && data.data.draftOrderCreate.userErrors);
  if (errs && errs.length) throw new Error("Shopify: " + errs.map((e) => e.message).join("; "));
  return data.data.draftOrderCreate.draftOrder;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = cors(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return json({ error: "Nur POST erlaubt." }, 405, corsHeaders);

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "Ungültiges JSON." }, 400, corsHeaders);
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length || rawItems.length > 30) {
      return json({ error: "Ungültige Anzahl Positionen." }, 400, corsHeaders);
    }

    let lineItems;
    try {
      lineItems = rawItems.map(validateAndPrice);
    } catch (err) {
      return json({ error: err.message }, 400, corsHeaders);
    }

    try {
      const draftOrder = await createDraftOrder(env, lineItems);
      return json({ invoiceUrl: draftOrder.invoiceUrl }, 200, corsHeaders);
    } catch (err) {
      return json({ error: err.message }, 502, corsHeaders);
    }
  },
};
