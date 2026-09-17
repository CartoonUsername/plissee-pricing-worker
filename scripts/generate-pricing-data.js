#!/usr/bin/env node
/**
 * Regeneriert src/pricing-data.json aus der Schema-Konfiguration von
 * plissee-konfigurator/sections/plissee-configurator.liquid — die einzige
 * "Quelle der Wahrheit" für Grundpreis/Raten sowie Stoff-/Schienen-/
 * Klemmträger-Aufpreise. Die IDs (z. B. "fabric_4") MÜSSEN mit den Block-IDs
 * in templates/product.plissee.json übereinstimmen — genau die IDs, die dort
 * beim Erzeugen der Vorlage synthetisch vergeben wurden (siehe
 * theme_export.../templates/product.plissee.json), sonst findet der Worker
 * beim Bestellen keine passende Preis-Zeile.
 *
 * Erneut ausführen, wann immer sich Grundpreis/Raten oder Stoff-/Schienen-/
 * Klemmträger-Aufpreise im Theme-Editor ändern, dann den Worker neu
 * deployen (siehe README.md).
 *
 * Nutzung: node scripts/generate-pricing-data.js \
 *   ../plissee-konfigurator/sections/plissee-configurator.liquid
 */
const fs = require("fs");
const path = require("path");

const sectionPath = process.argv[2] || "../plissee-konfigurator/sections/plissee-configurator.liquid";
const outPath = path.join(__dirname, "..", "src", "pricing-data.json");

const content = fs.readFileSync(sectionPath, "utf8");
const match = content.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/);
if (!match) {
  console.error("Kein {% schema %}-Block gefunden in", sectionPath);
  process.exit(1);
}
const schema = JSON.parse(match[1]);

function settingDefault(id, fallback) {
  const s = schema.settings.find((s) => s.id === id);
  return s && s.default !== undefined ? s.default : fallback;
}

const rates = {
  baseFee: settingDefault("base_fee", 12.22),
  pricePerMeterWidth: settingDefault("price_per_meter_width", 25.39),
  pricePerMeterHeight: settingDefault("price_per_meter_height", 10.5),
  minPrice: settingDefault("min_price", 20),
  minWidth: settingDefault("min_width", 30),
  maxWidth: settingDefault("max_width", 150),
  minHeight: settingDefault("min_height", 30),
  maxHeight: settingDefault("max_height", 240),
};

// Muss exakt denselben Zähl-Algorithmus verwenden wie die ID-Vergabe für
// templates/product.plissee.json (Typ + laufende Nummer in Reihenfolge der
// presets[0].blocks), sonst passen die IDs nicht zusammen.
const counters = {};
const items = {};
(schema.presets[0].blocks || []).forEach((b) => {
  counters[b.type] = (counters[b.type] || 0) + 1;
  const id = `${b.type}_${counters[b.type]}`;
  items[id] = {
    type: b.type,
    name: b.settings.name,
    surcharge: b.settings.surcharge || 0,
  };
});

fs.writeFileSync(outPath, JSON.stringify({ rates, items }, null, 2) + "\n");
console.log("geschrieben:", outPath);
console.log("Anzahl Stoff-/Schienen-/Klemmträger-Einträge:", Object.keys(items).length);
