#!/usr/bin/env node
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
  const s = schema.settings.find((s2) => s2.id === id);
  return s && s.default !== void 0 ? s.default : fallback;
}
const rates = {
  baseFee: settingDefault("base_fee", 12.22),
  pricePerMeterWidth: settingDefault("price_per_meter_width", 25.39),
  pricePerMeterHeight: settingDefault("price_per_meter_height", 10.5),
  minPrice: settingDefault("min_price", 20),
  minWidth: settingDefault("min_width", 30),
  maxWidth: settingDefault("max_width", 150),
  minHeight: settingDefault("min_height", 30),
  maxHeight: settingDefault("max_height", 240)
};
const counters = {};
const items = {};
(schema.presets[0].blocks || []).forEach((b) => {
  counters[b.type] = (counters[b.type] || 0) + 1;
  const id = `${b.type}_${counters[b.type]}`;
  items[id] = {
    type: b.type,
    name: b.settings.name,
    surcharge: b.settings.surcharge || 0
  };
});
fs.writeFileSync(outPath, JSON.stringify({ rates, items }, null, 2) + "\n");
console.log("geschrieben:", outPath);
console.log("Anzahl Stoff-/Schienen-/Klemmträger-Einträge:", Object.keys(items).length);
