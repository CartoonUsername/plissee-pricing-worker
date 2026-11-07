import PRICING from "./pricing-data.json";
import FRAMES from "./frames-config.json";
import { makeFramePricer } from "./frames.js";
const framePricer = makeFramePricer(FRAMES);
const ADMIN_API_VERSION = "2025-01";
const PRODUCT_API_VERSION = "2025-07";
function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {})
  });
}
function computeUnitPrice(width, height, fabric, rail, bracket) {
  const base = PRICING.rates.baseFee + width / 100 * PRICING.rates.pricePerMeterWidth + height / 100 * PRICING.rates.pricePerMeterHeight;
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
    { key: "Stoff", value: fabric.name }
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
    customAttributes
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
const OAUTH_SCOPES = "write_draft_orders,write_products,read_publications,write_publications,read_orders";
const STATE_COOKIE = "plissee_oauth_state";
function htmlPage(title, bodyHtml, status, extraHeaders) {
  const page = '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>' + title + "</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px}code,pre{background:#f2f2f2;padding:2px 6px;border-radius:4px;word-break:break-all}pre{padding:12px;white-space:pre-wrap}</style></head><body>" + bodyHtml + "</body></html>";
  return new Response(page, {
    status: status || 200,
    headers: Object.assign(
      { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      extraHeaders || {}
    )
  });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
async function verifyShopifyHmac(url, secret) {
  const params = new URLSearchParams(url.search);
  const hmac = params.get("hmac");
  if (!hmac || !/^[0-9a-f]{64}$/i.test(hmac)) return false;
  params.delete("hmac");
  const message = Array.from(params.entries()).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([k, v]) => k + "=" + v).join("&");
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
function handleInstall(request, env) {
  if (env.SHOPIFY_ADMIN_TOKEN && env.ALLOW_REINSTALL !== "1") return alreadyInstalledPage();
  const state = crypto.randomUUID();
  const authUrl = new URL("https://" + env.SHOPIFY_SHOP_DOMAIN + "/admin/oauth/authorize");
  authUrl.search = new URLSearchParams({
    client_id: env.SHOPIFY_CLIENT_ID,
    scope: OAUTH_SCOPES,
    redirect_uri: new URL(request.url).origin + "/callback",
    state
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": STATE_COOKIE + "=" + state + "; HttpOnly; Secure; SameSite=Lax; Path=/callback; Max-Age=600",
      "Cache-Control": "no-store"
    }
  });
}
async function handleCallback(request, env) {
  if (env.SHOPIFY_ADMIN_TOKEN && env.ALLOW_REINSTALL !== "1") return alreadyInstalledPage();
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
  if (!await verifyShopifyHmac(url, env.SHOPIFY_CLIENT_SECRET)) {
    return htmlPage("Ungültige Anfrage", "<h1>Ungültige Anfrage</h1><p>Die Signatur (hmac) ist ungültig.</p>", 403, clearState);
  }
  const timestamp = Number(q.get("timestamp"));
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1e3 - timestamp) > 300) {
    return htmlPage("Abgelaufen", "<h1>Abgelaufen</h1><p>Die Anfrage ist zu alt. Bitte <code>/install</code> erneut aufrufen.</p>", 403, clearState);
  }
  const code = q.get("code");
  if (!code) return htmlPage("Ungültige Anfrage", "<h1>Ungültige Anfrage</h1><p>Kein Code übergeben.</p>", 400, clearState);
  const res = await fetch("https://" + env.SHOPIFY_SHOP_DOMAIN + "/admin/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET, code })
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(function() {
      return "";
    });
    return htmlPage("Fehler", "<h1>Token-Austausch fehlgeschlagen</h1><p>Shopify antwortete mit " + res.status + ":</p><pre>" + escapeHtml(bodyText.slice(0, 300)) + "</pre>", 502, clearState);
  }
  const data = await res.json();
  if (!data.access_token) {
    return htmlPage("Fehler", "<h1>Shopify lieferte keinen Zugangstoken.</h1>", 502, clearState);
  }
  const notes = [];
  const granted = String(data.scope || "").split(",").map((x) => x.trim());
  const missing = OAUTH_SCOPES.split(",").filter((x) => !granted.includes(x));
  if (missing.length) {
    notes.push("<p><strong>Achtung:</strong> Dem Token fehlen diese Bereiche: <code>" + escapeHtml(missing.join(", ")) + "</code> (erhalten: <code>" + escapeHtml(data.scope || "–") + "</code>). Bereiche in der App-Version ergänzen, veröffentlichen und neu installieren.</p>");
  } else {
    notes.push("<p>Alle benötigten Bereiche sind enthalten: <code>" + escapeHtml(granted.join(", ")) + "</code>.</p>");
  }
  if (data.expires_in || data.refresh_token) {
    notes.push("<p><strong>Achtung:</strong> Shopify hat einen ABLAUFENDEN Token ausgestellt (läuft nach " + escapeHtml(data.expires_in) + " s ab). Dieser Worker ist für dauerhafte Tokens gebaut — bitte melden, dann wird eine Auffrischung ergänzt.</p>");
  }
  return htmlPage(
    "Installation abgeschlossen",
    "<h1>Installation abgeschlossen</h1><p>Dieser Zugangstoken wird nur jetzt angezeigt. So tragen Sie ihn ein: Cloudflare-Dashboard → Workers &amp; Pages → plissee-pricing-worker → Einstellungen → Variablen und Geheimnisse → <code>SHOPIFY_ADMIN_TOKEN</code> bearbeiten → den Token unten einfügen → speichern/bereitstellen. (Alternativ im Terminal: <code>npx wrangler secret put SHOPIFY_ADMIN_TOKEN</code>.)</p><p>Token:</p><pre>" + escapeHtml(data.access_token) + "</pre>" + notes.join("") + "<p>Danach diese Seite schließen. Der Token ist wie ein Passwort zu behandeln.</p>",
    200,
    clearState
  );
}
async function getAccessToken(env) {
  if (env.SHOPIFY_ADMIN_TOKEN) return env.SHOPIFY_ADMIN_TOKEN;
  const res = await fetch("https://" + env.SHOPIFY_SHOP_DOMAIN + "/admin/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET
    })
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(function() {
      return "";
    });
    throw new Error("Token-Anfrage an Shopify fehlgeschlagen (" + res.status + "): " + bodyText.slice(0, 300));
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Shopify lieferte keinen Zugangstoken.");
  return data.access_token;
}
async function adminGql(env, token, query, variables) {
  const res = await fetch("https://" + env.SHOPIFY_SHOP_DOMAIN + "/admin/api/" + PRODUCT_API_VERSION + "/graphql.json", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error("Admin API " + res.status);
  const data = await res.json();
  if (data.errors && data.errors.length) throw new Error(data.errors.map((e) => e.message).join("; ").slice(0, 300));
  return data.data;
}
function userErr(payload) {
  const e = payload && payload.userErrors;
  if (e && e.length) throw new Error(e.map((x) => x.message).join("; ").slice(0, 300));
}
async function createProductsBatch(env, token, lis, opts) {
  opts = opts || {};
  const n = lis.length, out = new Array(n).fill(null), media = new Array(n).fill(void 0);
  const fail = (i, e) => {
    if (!out[i]) out[i] = { error: String(e && e.message || e).slice(0, 250) };
  };
  const withImg = [];
  lis.forEach((l, i) => {
    if (l.imageData) withImg.push(i);
  });
  if (withImg.length) {
    try {
      const bins = withImg.map((i) => {
        const bin = atob(lis[i].imageData.split(",")[1]), bytes = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        return bytes;
      });
      const st = await adminGql(
        env,
        token,
        "mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}}",
        { input: withImg.map((i, k) => ({ resource: "PRODUCT_IMAGE", filename: "rahmen-" + i + ".jpg", mimeType: "image/jpeg", httpMethod: "POST", fileSize: String(bins[k].length) })) }
      );
      userErr(st.stagedUploadsCreate);
      const targets = st.stagedUploadsCreate.stagedTargets;
      await Promise.all(withImg.map(async (i, k) => {
        try {
          const target = targets[k], form = new FormData();
          for (const p of target.parameters) form.append(p.name, p.value);
          form.append("file", new Blob([bins[k]], { type: "image/jpeg" }), "rahmen-" + i + ".jpg");
          const up = await fetch(target.url, { method: "POST", body: form });
          if (!up.ok) throw new Error("Bild-Upload " + up.status);
          media[i] = [{ originalSource: target.resourceUrl, mediaContentType: "IMAGE", alt: lis[i].title }];
        } catch (e) {
          if (opts.requireImage) fail(i, e);
        }
      }));
    } catch (e) {
      if (opts.requireImage) withImg.forEach((i) => fail(i, e));
    }
  }
  const todo = [];
  for (let i = 0; i < n; i++) if (!out[i]) todo.push(i);
  if (!todo.length) return out;
  const create = async (status) => {
    const decl2 = [], body2 = [], vars2 = {};
    todo.forEach((i, k) => {
      decl2.push("$p" + k + ":ProductCreateInput!", "$m" + k + ":[CreateMediaInput!]");
      body2.push("a" + k + ":productCreate(product:$p" + k + ",media:$m" + k + "){product{id variants(first:1){nodes{id}}} userErrors{field message}}");
      vars2["p" + k] = { title: lis[i].title, status, vendor: "emscraft24", productType: "Bilderrahmen nach Maß (Konfigurator)", tags: ["konfigurator-auto"], metafields: [{ namespace: "seo", key: "hidden", type: "number_integer", value: "1" }] };
      if (media[i]) vars2["m" + k] = media[i];
    });
    return adminGql(env, token, "mutation(" + decl2.join(",") + "){" + body2.join(" ") + "}", vars2);
  };
  let created;
  try {
    created = await create("UNLISTED");
    if (todo.every((_, k) => created["a" + k] && created["a" + k].userErrors && created["a" + k].userErrors.length)) created = await create("ACTIVE");
  } catch (e) {
    try {
      created = await create("ACTIVE");
    } catch (e2) {
      todo.forEach((i) => fail(i, e2));
      return out;
    }
  }
  const made = [];
  todo.forEach((i, k) => {
    const r = created["a" + k];
    try {
      userErr(r);
      if (!r.product) throw new Error("Produkt nicht angelegt");
      made.push({ i, k, product: r.product });
    } catch (e) {
      fail(i, e);
    }
  });
  if (!made.length) return out;
  const decl = [], body = [], vars = {};
  made.forEach((m, j) => {
    const vid = m.product.variants.nodes[0].id;
    decl.push("$id" + j + ":ID!", "$v" + j + ":[ProductVariantsBulkInput!]!");
    body.push("v" + j + ":productVariantsBulkUpdate(productId:$id" + j + ",variants:$v" + j + "){userErrors{field message}}");
    vars["id" + j] = m.product.id;
    vars["v" + j] = [{ id: vid, price: lis[m.i].originalUnitPrice, inventoryPolicy: "CONTINUE" }];
    if (opts.publicationId) {
      decl.push("$in" + j + ":[PublicationInput!]!");
      body.push("u" + j + ":publishablePublish(id:$id" + j + ",input:$in" + j + "){userErrors{field message}}");
      vars["in" + j] = [{ publicationId: opts.publicationId }];
    }
  });
  let fin = null;
  try {
    fin = await adminGql(env, token, "mutation(" + decl.join(",") + "){" + body.join(" ") + "}", vars);
  } catch (e) {
    made.forEach((m) => fail(m.i, e));
    return out;
  }
  made.forEach((m, j) => {
    try {
      userErr(fin["v" + j]);
      if (opts.publicationId) userErr(fin["u" + j]);
      out[m.i] = { productId: m.product.id, variantId: m.product.variants.nodes[0].id };
    } catch (e) {
      fail(m.i, e);
    }
  });
  if (opts.waitMedia) {
    const pend = made.filter((m) => media[m.i] && out[m.i] && !out[m.i].error);
    for (let round = 0; round < 6 && pend.length; round++) {
      try {
        const d = await adminGql(env, token, "query(" + pend.map((_, j) => "$i" + j + ":ID!").join(",") + "){" + pend.map((_, j) => "q" + j + ":product(id:$i" + j + "){featuredMedia{status}}").join(" ") + "}", Object.fromEntries(pend.map((m, j) => ["i" + j, m.product.id])));
        for (let j = pend.length - 1; j >= 0; j--) {
          const st = d["q" + j] && d["q" + j].featuredMedia && d["q" + j].featuredMedia.status;
          if (st === "READY" || st === "FAILED") pend.splice(j, 1);
        }
      } catch (e) {
        break;
      }
      if (pend.length) await new Promise((r) => setTimeout(r, 400));
    }
  }
  return out;
}
let PUBLICATION_CACHE = null;
async function onlineStorePublicationId(env, token) {
  if (PUBLICATION_CACHE) return PUBLICATION_CACHE;
  const d = await adminGql(env, token, "{publications(first:20){nodes{id name}}}");
  const p = d.publications.nodes.find((n) => /online store|online-shop|onlineshop/i.test(n.name));
  if (!p) throw new Error("Verkaufskanal Online-Shop nicht gefunden");
  return PUBLICATION_CACHE = p.id;
}
async function withProductImages(env, lineItems) {
  const withImg = lineItems.filter((l) => l.imageData).length;
  const strip = (l) => ({ title: l.title, quantity: l.quantity, originalUnitPrice: l.originalUnitPrice, customAttributes: l.customAttributes });
  if (!withImg) return { lines: lineItems.map(strip), note: "kein Bild mitgeschickt" };
  let token;
  try {
    token = await getAccessToken(env);
  } catch (e) {
    return { lines: lineItems.map(strip), note: "kein Token" };
  }
  const idx = [];
  lineItems.forEach((l, i) => {
    if (l.imageData && idx.length < 6) idx.push(i);
  });
  let res = [], firstErr = null;
  try {
    res = await createProductsBatch(env, token, idx.map((i) => lineItems[i]), { requireImage: true, waitMedia: true });
  } catch (e) {
    firstErr = e.message;
  }
  let ok = 0;
  const byIdx = {};
  idx.forEach((i, k) => {
    const r = res[k];
    if (r && !r.error) {
      ok++;
      byIdx[i] = { variantId: r.variantId, quantity: lineItems[i].quantity, customAttributes: lineItems[i].customAttributes };
    } else if (r && r.error) firstErr = firstErr || r.error;
  });
  const lines = lineItems.map((l, i) => byIdx[i] || strip(l));
  return { lines, note: ok + " von " + withImg + " Bildern übernommen" + (firstErr ? " (Fehler: " + firstErr + ")" : "") };
}
async function createDraftOrder(env, lineItems) {
  const accessToken = await getAccessToken(env);
  const res = await fetch("https://" + env.SHOPIFY_SHOP_DOMAIN + "/admin/api/" + ADMIN_API_VERSION + "/graphql.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken
    },
    body: JSON.stringify({
      query: DRAFT_ORDER_MUTATION,
      variables: { input: { lineItems } }
    })
  });
  if (!res.ok) throw new Error("Shopify Admin API antwortete mit " + res.status);
  const data = await res.json();
  const errs = data.errors || data.data && data.data.draftOrderCreate && data.data.draftOrderCreate.userErrors;
  if (errs && errs.length) throw new Error("Shopify: " + errs.map((e) => e.message).join("; "));
  return data.data.draftOrderCreate.draftOrder;
}
const AUTO_TAG = "konfigurator-auto";
const CLEANUP_DAYS = 3;
const ORDER_DELETE_DELAY_MS = 2e4;
async function verifyShopifyWebhook(rawBody, hmacB64, secret) {
  if (!hmacB64 || !secret) return false;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(hmacB64), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", key, sig, rawBody);
  } catch (e) {
    return false;
  }
}
async function deleteAutoProduct(env, token, gid) {
  const d = await adminGql(env, token, "query($id:ID!){product(id:$id){id tags}}", { id: gid });
  if (!d.product || !d.product.tags.includes(AUTO_TAG)) return false;
  const r = await adminGql(env, token, "mutation($input:ProductDeleteInput!){productDelete(input:$input){deletedProductId userErrors{field message}}}", { input: { id: gid } });
  userErr(r.productDelete);
  return true;
}
async function handleOrderWebhook(request, env, ctx) {
  const raw = await request.arrayBuffer();
  const ok = await verifyShopifyWebhook(raw, request.headers.get("X-Shopify-Hmac-Sha256"), env.SHOPIFY_CLIENT_SECRET);
  if (!ok) return new Response("ungültige Signatur", { status: 401 });
  let order;
  try {
    order = JSON.parse(new TextDecoder().decode(raw));
  } catch (e) {
    return new Response("kein JSON", { status: 400 });
  }
  const ids = [...new Set((order.line_items || []).map((l) => l.product_id).filter(Boolean))];
  if (ids.length) {
    ctx.waitUntil((async () => {
      await new Promise((r) => setTimeout(r, ORDER_DELETE_DELAY_MS));
      const token = await getAccessToken(env);
      for (const id of ids) {
        try {
          await deleteAutoProduct(env, token, "gid://shopify/Product/" + id);
        } catch (e) {
        }
      }
    })());
  }
  return new Response("ok", { status: 200 });
}
async function ensureOrderWebhook(env, token) {
  if (!env.WORKER_URL) return "keine WORKER_URL";
  const url = env.WORKER_URL.replace(/\/+$/, "") + "/webhook/orders";
  const d = await adminGql(env, token, "{webhookSubscriptions(first:50,topics:[ORDERS_CREATE]){nodes{id endpoint{__typename ... on WebhookHttpEndpoint{callbackUrl}}}}}");
  if (d.webhookSubscriptions.nodes.some((n) => n.endpoint && n.endpoint.callbackUrl === url)) return "vorhanden";
  const r = await adminGql(env, token, "mutation($u:URL!){webhookSubscriptionCreate(topic:ORDERS_CREATE,webhookSubscription:{callbackUrl:$u,format:JSON}){webhookSubscription{id} userErrors{field message}}}", { u: url });
  userErr(r.webhookSubscriptionCreate);
  return "angelegt";
}
async function cleanupOldAutoProducts(env, token) {
  const cutoff = new Date(Date.now() - CLEANUP_DAYS * 864e5).toISOString().slice(0, 10);
  let n = 0;
  for (let round = 0; round < 4; round++) {
    const d = await adminGql(env, token, "query($q:String!){products(first:50,query:$q){nodes{id tags}}}", { q: "tag:" + AUTO_TAG + " created_at:<" + cutoff });
    const nodes = d.products.nodes.filter((p) => p.tags.includes(AUTO_TAG));
    if (!nodes.length) break;
    for (const p of nodes) {
      try {
        if (await deleteAutoProduct(env, token, p.id)) n++;
      } catch (e) {
      }
    }
  }
  return n;
}
async function scheduledJob(env) {
  const token = await getAccessToken(env), out = {};
  try {
    out.webhook = await ensureOrderWebhook(env, token);
  } catch (e) {
    out.webhook = "Fehler: " + String(e.message || e).slice(0, 120);
  }
  try {
    out.geloescht = await cleanupOldAutoProducts(env, token);
  } catch (e) {
    out.cleanup = "Fehler: " + String(e.message || e).slice(0, 120);
  }
  console.log("Aufräum-Job", JSON.stringify(out));
  return out;
}
const SHARE_MAX_KV = 9e6, SHARE_MAX_META = 19e5, SHARE_TAG = "konfigurator-speicher";
let SHARE_PRODUCT = null;
async function shareProductId(env, token) {
  if (SHARE_PRODUCT) return SHARE_PRODUCT;
  const q = await adminGql(env, token, "query($q:String!){products(first:1,query:$q){nodes{id}}}", { q: "tag:" + SHARE_TAG });
  if (q.products.nodes.length) return SHARE_PRODUCT = q.products.nodes[0].id;
  const r = await adminGql(
    env,
    token,
    "mutation($p:ProductCreateInput!){productCreate(product:$p){product{id} userErrors{field message}}}",
    { p: { title: "Konfigurator Teilen-Speicher (bitte nicht löschen)", status: "DRAFT", vendor: "emscraft24", productType: "Bilderrahmen nach Maß (Konfigurator)", tags: [SHARE_TAG], descriptionHtml: "Technisches Produkt: speichert geteilte Konfigurator-Links. Nicht löschen." } }
  );
  userErr(r.productCreate);
  return SHARE_PRODUCT = r.productCreate.product.id;
}
async function handleShare(request, env, corsHeaders, pathname) {
  const useKV = !!env.SHARES;
  if (request.method === "GET") {
    const id2 = pathname.split("/")[2] || "";
    if (!/^[A-Za-z0-9]{8,32}$/.test(id2)) return json({ error: "ungültig" }, 400, corsHeaders);
    let v = null;
    try {
      if (useKV) v = await env.SHARES.get("s:" + id2);
      else {
        const token = await getAccessToken(env), pid = await shareProductId(env, token);
        const d = await adminGql(env, token, 'query($id:ID!,$k:String!){product(id:$id){metafield(namespace:"bf_share",key:$k){value}}}', { id: pid, k: id2 });
        v = d.product && d.product.metafield ? d.product.metafield.value : null;
      }
    } catch (e) {
      return json({ error: "Speicher nicht erreichbar" }, 502, corsHeaders);
    }
    if (!v) return json({ error: "nicht gefunden" }, 404, corsHeaders);
    return new Response(v, { status: 200, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" }, corsHeaders) });
  }
  if (request.method !== "POST") return json({ error: "Methode nicht erlaubt" }, 405, corsHeaders);
  const origin = request.headers.get("Origin") || "";
  if (!(env.ALLOWED_ORIGIN || "").split(",").map((x) => x.trim()).filter(Boolean).includes(origin)) return json({ error: "Herkunft nicht erlaubt" }, 403, corsHeaders);
  const MAX = useKV ? SHARE_MAX_KV : SHARE_MAX_META;
  if (Number(request.headers.get("content-length") || 0) > MAX + 2e3) return json({ error: "zu groß" }, 413, corsHeaders);
  const text = await request.text();
  let p;
  try {
    p = JSON.parse(text);
  } catch (e) {
    return json({ error: "kein JSON" }, 400, corsHeaders);
  }
  if (!p || typeof p.data !== "object" || !p.data || p.data.v !== 1) return json({ error: "ungültig" }, 400, corsHeaders);
  const imgs = p.imgs && typeof p.imgs === "object" ? p.imgs : {}, keys = Object.keys(imgs);
  if (keys.length > 40) return json({ error: "zu viele Bilder" }, 400, corsHeaders);
  for (const k of keys) {
    const v = imgs[k];
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(k) || typeof v !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(v)) return json({ error: "Bild ungültig" }, 400, corsHeaders);
  }
  const value = JSON.stringify({ data: p.data, imgs });
  if (value.length > MAX) return json({ error: "zu groß" }, 413, corsHeaders);
  const b = crypto.getRandomValues(new Uint8Array(12)), ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (const x of b) id += ABC[x % ABC.length];
  try {
    if (useKV) await env.SHARES.put("s:" + id, value, { expirationTtl: 60 * 60 * 24 * 180 });
    else {
      const token = await getAccessToken(env), pid = await shareProductId(env, token);
      const r = await adminGql(env, token, "mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{field message}}}", { m: [{ ownerId: pid, namespace: "bf_share", key: id, type: "json", value }] });
      userErr(r.metafieldsSet);
    }
  } catch (e) {
    return json({ error: "Speichern nicht möglich: " + String(e.message || e).slice(0, 120) }, 502, corsHeaders);
  }
  return json({ id }, 200, corsHeaders);
}
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledJob(env));
  },
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = cors(origin, env);
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/status") {
      try {
        const token = await getAccessToken(env);
        const d = await adminGql(env, token, "{currentAppInstallation{accessScopes{handle}}}");
        const scopes = d.currentAppInstallation.accessScopes.map((x) => x.handle);
        return json({ ok: true, scopes, bilderMoeglich: scopes.includes("write_products"), warenkorbMoeglich: scopes.includes("write_products") && scopes.includes("write_publications") && scopes.includes("read_publications"), sofortLoeschenMoeglich: scopes.includes("read_orders") && scopes.includes("write_products") }, 200, corsHeaders);
      } catch (e) {
        return json({ ok: false, error: String(e.message || e).slice(0, 200) }, 200, corsHeaders);
      }
    }
    if (pathname === "/share" || pathname.startsWith("/share/")) {
      if (request.method !== "OPTIONS") return handleShare(request, env, corsHeaders, pathname);
    }
    if (request.method === "GET" && pathname === "/install") return handleInstall(request, env);
    if (request.method === "GET" && pathname === "/callback") return handleCallback(request, env);
    if (request.method === "POST" && pathname === "/webhook/orders") return handleOrderWebhook(request, env, ctx);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return json({ error: "Nur POST erlaubt." }, 405, corsHeaders);
    const isFrames = pathname === "/frames";
    const priceItem = isFrames ? framePricer.validateAndPriceFrame : validateAndPrice;
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
      lineItems = rawItems.map(priceItem);
    } catch (err) {
      return json({ error: err.message }, 400, corsHeaders);
    }
    let cartNote;
    if (isFrames && body.mode === "cart") {
      if (lineItems.length > 5) return json({ error: "Bitte höchstens 5 Rahmen je Anfrage." }, 400, corsHeaders);
      try {
        const token = await getAccessToken(env), publicationId = await onlineStorePublicationId(env, token);
        const made = await createProductsBatch(env, token, lineItems, { publicationId, waitMedia: false });
        const bad = made.find((m) => !m || m.error);
        if (bad) throw new Error(bad && bad.error || "Produkt nicht angelegt");
        const lines = lineItems.map((l, i) => {
          const props = {};
          for (const a of l.customAttributes) props[a.key] = a.value;
          return { variantId: Number(String(made[i].variantId).split("/").pop()), quantity: l.quantity, properties: props, title: l.title, hasImage: !!l.imageData };
        });
        return json({ mode: "cart", lines }, 200, corsHeaders);
      } catch (err) {
        cartNote = String(err.message || err).slice(0, 250);
      }
    }
    try {
      let note;
      if (isFrames) {
        const r = await withProductImages(env, lineItems);
        lineItems = r.lines;
        note = r.note;
      }
      const draftOrder = await createDraftOrder(env, lineItems);
      return json({ mode: "draft", invoiceUrl: draftOrder.invoiceUrl, imageNote: note, cartNote }, 200, corsHeaders);
    } catch (err) {
      return json({ error: err.message }, 502, corsHeaders);
    }
  }
};
