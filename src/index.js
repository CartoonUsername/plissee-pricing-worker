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

const OAUTH_SCOPES = "write_draft_orders";
const STATE_COOKIE = "plissee_oauth_state";

function htmlPage(title, bodyHtml, status, extraHeaders) {
  const page =
    '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="robots" content="noindex">' +
    "<title>" + title + '</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px}' +
    "code,pre{background:#f2f2f2;padding:2px 6px;border-radius:4px;word-break:break-all}pre{padding:12px;white-space:pre-wrap}</style></head><body>" +
    bodyHtml + "</body></html>";
  return new Response(page, {
    status: status || 200,
    headers: Object.assign(
      { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      extraHeaders || {}
    ),
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Prüft die HMAC-Signatur, mit der Shopify den Callback-Aufruf unterschreibt
 * (alle Query-Parameter außer "hmac", nach Namen sortiert, als "k=v&k=v",
 * SHA-256 mit dem Client-Secret). crypto.subtle.verify vergleicht in
 * konstanter Zeit. */
async function verifyShopifyHmac(url, secret) {
  const params = new URLSearchParams(url.search);
  const hmac = params.get("hmac");
  if (!hmac || !/^[0-9a-f]{64}$/i.test(hmac)) return false;
  params.delete("hmac");
  const message = Array.from(params.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => k + "=" + v)
    .join("&");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, hexToBytes(hmac), new TextEncoder().encode(message));
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return "";
}

function alreadyInstalledPage() {
  return htmlPage("Bereits eingerichtet", "<h1>Bereits eingerichtet</h1><p>Für diesen Worker ist bereits ein Shopify-Zugangstoken hinterlegt (<code>SHOPIFY_ADMIN_TOKEN</code>). Die Installationsseiten sind deshalb deaktiviert.</p>", 403);
}

/** Schritt 1 der EINMALIGEN Installation (Authorization Code Grant): leitet
 * den Shop-Admin zur Shopify-Freigabeseite. Nur nötig, wenn noch kein
 * SHOPIFY_ADMIN_TOKEN gesetzt ist — danach ist die Route gesperrt, damit
 * niemand von außen einen zweiten Durchlauf anstoßen kann. */
function handleInstall(request, env) {
  if (env.SHOPIFY_ADMIN_TOKEN) return alreadyInstalledPage();
  const state = crypto.randomUUID();
  const authUrl = new URL("https://" + env.SHOPIFY_SHOP_DOMAIN + "/admin/oauth/authorize");
  authUrl.search = new URLSearchParams({
    client_id: env.SHOPIFY_CLIENT_ID,
    scope: OAUTH_SCOPES,
    redirect_uri: new URL(request.url).origin + "/callback",
    state,
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": STATE_COOKIE + "=" + state + "; HttpOnly; Secure; SameSite=Lax; Path=/callback; Max-Age=600",
      "Cache-Control": "no-store",
    },
  });
}

/** Schritt 2: Shopify ruft diese URL nach der Freigabe auf. Prüft state
 * (CSRF), Shop und HMAC, tauscht den Code gegen den dauerhaften Zugangstoken
 * und zeigt ihn EINMAL an — ein Worker kann seine eigenen Secrets nicht
 * setzen, deshalb wird der Token per "wrangler secret put" hinterlegt. */
async function handleCallback(request, env) {
  if (env.SHOPIFY_ADMIN_TOKEN) return alreadyInstalledPage();
  const url = new URL(request.url);
  const q = url.searchParams;
  const clearState = { "Set-Cookie": STATE_COOKIE + "=; HttpOnly; Secure; SameSite=Lax; Path=/callback; Max-Age=0" };

  const cookieState = readCookie(request, STATE_COOKIE);
  if (!cookieState || q.get("state") !== cookieState) {
    return htmlPage("Ungültige Anfrage", "<h1>Ungültige Anfrage</h1><p>Der Sicherheitswert (state) stimmt nicht. Bitte die Installation erneut über <code>/install</code> starten.</p>", 403, clearState);
  }
  if (q.get("shop") !== env.SHOPIFY_SHOP_DOMAIN) {
    return htmlPage("Ungültige Anfrage", "<h1>Ungültige Anfrage</h1><p>Falscher Shop.</p>", 403, clearState);
  }
  if (!(await verifyShopifyHmac(url, env.SHOPIFY_CLIENT_SECRET))) {
    return htmlPage("Ungültige Anfrage", "<h1>Ungültige Anfrage</h1><p>Die Signatur (hmac) ist ungültig.</p>", 403, clearState);
  }
  const timestamp = Number(q.get("timestamp"));
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return htmlPage("Abgelaufen", "<h1>Abgelaufen</h1><p>Die Anfrage ist zu alt. Bitte <code>/install</code> erneut aufrufen.</p>", 403, clearState);
  }
  const code = q.get("code");
  if (!code) return htmlPage("Ungültige Anfrage", "<h1>Ungültige Anfrage</h1><p>Kein Code übergeben.</p>", 400, clearState);

  const res = await fetch("https://" + env.SHOPIFY_SHOP_DOMAIN + "/admin/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET, code }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(function () { return ""; });
    return htmlPage("Fehler", "<h1>Token-Austausch fehlgeschlagen</h1><p>Shopify antwortete mit " + res.status + ":</p><pre>" + escapeHtml(bodyText.slice(0, 300)) + "</pre>", 502, clearState);
  }
  const data = await res.json();
  if (!data.access_token) {
    return htmlPage("Fehler", "<h1>Shopify lieferte keinen Zugangstoken.</h1>", 502, clearState);
  }

  const notes = [];
  if (!String(data.scope || "").split(",").includes(OAUTH_SCOPES)) {
    notes.push("<p><strong>Achtung:</strong> Der Token hat nicht den Bereich <code>" + OAUTH_SCOPES + "</code> (erhalten: <code>" + escapeHtml(data.scope || "–") + "</code>). Bereich in der App-Version ergänzen und neu installieren.</p>");
  }
  if (data.expires_in || data.refresh_token) {
    notes.push("<p><strong>Achtung:</strong> Shopify hat einen ABLAUFENDEN Token ausgestellt (läuft nach " + escapeHtml(data.expires_in) + " s ab). Dieser Worker ist für dauerhafte Tokens gebaut — bitte melden, dann wird eine Auffrischung ergänzt.</p>");
  }
  return htmlPage(
    "Installation abgeschlossen",
    "<h1>Installation abgeschlossen</h1><p>Dieser Zugangstoken wird nur jetzt angezeigt. Im Terminal im Worker-Ordner ausführen und den Token einfügen:</p>" +
      "<pre>npx wrangler secret put SHOPIFY_ADMIN_TOKEN</pre><p>Token:</p><pre>" + escapeHtml(data.access_token) + "</pre>" +
      notes.join("") + "<p>Danach diese Seite schließen. Der Token ist wie ein Passwort zu behandeln.</p>",
    200,
    clearState
  );
}

/** Bevorzugt den einmalig per /install erzeugten, dauerhaften Admin-API-Token
 * (Secret SHOPIFY_ADMIN_TOKEN) — er hängt NICHT davon ab, ob App und Shop in
 * derselben Dev-Dashboard-Organisation liegen. Nur wenn der noch fehlt, wird
 * der "Client Credentials Grant" versucht: der funktioniert ausschließlich,
 * wenn App und Shop zur selben Organisation gehören, sonst antwortet Shopify
 * mit "application_cannot_be_found".
 * https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens */
async function getAccessToken(env) {
  if (env.SHOPIFY_ADMIN_TOKEN) return env.SHOPIFY_ADMIN_TOKEN;
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

    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/install") return handleInstall(request, env);
    if (request.method === "GET" && pathname === "/callback") return handleCallback(request, env);

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
