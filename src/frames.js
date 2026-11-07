function round2(v) {
  return Math.round(v * 100) / 100;
}
function fmt(v) {
  return (Math.round(v * 10) / 10).toLocaleString("de-DE", { maximumFractionDigits: 1 });
}
export function makeFramePricer(CFG) {
  const designs = new Map(CFG.designs.map((d) => [d.id, d]));
  function rateFor(design, color) {
    if (color && color.ratePerCm != null) return color.ratePerCm;
    if (design.ratePerCm != null) return design.ratePerCm;
    throw new Error("Für diese Auswahl ist kein Preis hinterlegt.");
  }
  function validateAndPriceFrame(raw) {
    const L = CFG.limits, P = CFG.passepartout;
    const design = designs.get(String(raw.design));
    if (!design) throw new Error("Unbekannte Rahmenart.");
    let color = null;
    if (design.colors.length) {
      color = design.colors.find((c) => c.id === String(raw.color));
      if (!color) throw new Error("Unbekannte Farbe für diese Rahmenart.");
    }
    const height = round2(Number(raw.height));
    const width = round2(Number(raw.width));
    if (!Number.isFinite(height) || !Number.isFinite(width) || height < L.minCm || width < L.minCm) throw new Error("Maße außerhalb des gültigen Bereichs (mindestens " + L.minCm + " cm).");
    if (Math.max(height, width) > L.maxHeightCm || Math.min(height, width) > L.maxWidthCm) throw new Error("Maße außerhalb des gültigen Bereichs (längste Seite bis " + L.maxHeightCm + " cm, kürzere bis " + L.maxWidthCm + " cm).");
    const quantity = Math.max(1, Math.min(99, Math.round(Number(raw.quantity) || 1)));
    let passepartout = false, holeHeight = null, holeWidth = null;
    if (raw.passepartout) {
      if (Math.max(height, width) > P.maxFrameHeightCm || Math.min(height, width) > P.maxFrameWidthCm) throw new Error("Passepartout ist nur bis " + P.maxFrameHeightCm + " x " + P.maxFrameWidthCm + " cm Falzmaß möglich.");
      holeHeight = round2(Number(raw.holeHeight));
      holeWidth = round2(Number(raw.holeWidth));
      if (!Number.isFinite(holeHeight) || holeHeight < P.holeMinHeightCm || holeHeight >= height) throw new Error("Lochmaß-Höhe ungültig.");
      if (!Number.isFinite(holeWidth) || holeWidth < P.holeMinWidthCm || holeWidth >= width) throw new Error("Lochmaß-Breite ungültig.");
      if (Math.max(holeHeight, holeWidth) > Math.max(P.holeMaxHeightCm, P.holeMaxWidthCm) || Math.min(holeHeight, holeWidth) > Math.min(P.holeMaxHeightCm, P.holeMaxWidthCm)) throw new Error("Lochmaß außerhalb des gültigen Bereichs.");
      passepartout = true;
    }
    const unit = round2(round2((height + width) * rateFor(design, color)) + (passepartout ? P.price : 0));
    const colorName = color ? color.name : null;
    const title = "Bilderrahmen " + design.name + (colorName ? " – " + colorName : "") + " " + fmt(height) + "×" + fmt(width) + " cm";
    const customAttributes = [
      { key: "Rahmenart", value: design.name }
    ];
    if (colorName) customAttributes.push({ key: "Farbe", value: colorName });
    customAttributes.push({ key: "Höhe (Falzmaß)", value: fmt(height) + " cm" });
    customAttributes.push({ key: "Breite (Falzmaß)", value: fmt(width) + " cm" });
    if (passepartout) {
      customAttributes.push({ key: "Passepartout", value: "Weiß, Lochmaß " + fmt(holeHeight) + " × " + fmt(holeWidth) + " cm (H × B)" });
    }
    if (raw.room) customAttributes.push({ key: "Raum", value: String(raw.room).slice(0, 60) });
    if (raw.note) customAttributes.push({ key: "Anmerkung", value: String(raw.note).slice(0, 400) });
    const img = typeof raw.image === "string" && raw.image.length < 9e5 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(raw.image) ? raw.image : null;
    return { title, quantity, originalUnitPrice: unit.toFixed(2), customAttributes, imageData: img };
  }
  return { validateAndPriceFrame, designs };
}
