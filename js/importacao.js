import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
import { REQUIRED_SHEETS, REQUIRED_COLUMNS } from "./schema.js";
import { getCollectionRows, importInitialDataset } from "./db.js";

let preparedDataset = null;
let currentUserUid = null;

const text = value => String(value ?? "").trim();
const normalizeRows = (sheet) => XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false })
  .filter(row => Object.values(row).some(v => text(v) !== ""));

function duplicateValues(rows, field) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const value = text(row[field]);
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function validateDataset(dataset) {
  const errors = [];
  for (const sheetName of REQUIRED_SHEETS) {
    const rows = dataset[sheetName];
    if (!Array.isArray(rows)) {
      errors.push(`Aba obrigatória ausente: ${sheetName}.`);
      continue;
    }
    if (rows.length === 0) errors.push(`A aba ${sheetName} não contém registros.`);
    const required = REQUIRED_COLUMNS[sheetName] || [];
    for (const column of required) {
      if (!Object.keys(rows[0] || {}).includes(column)) {
        errors.push(`Aba ${sheetName}: coluna obrigatória ausente: ${column}.`);
      }
    }
  }
  if (errors.length) return errors;

  const defs = [
    ["Bens", "Tombamento"], ["Categorias", "ID_Categoria"], ["Responsaveis", "ID_Responsavel"],
    ["Setores", "ID_Setor"], ["LocaisFisicos", "ID_Local"], ["Andares", "ID_Andar"], ["Unidades", "ID_Unidade"]
  ];
  for (const [sheet, field] of defs) {
    for (const duplicate of duplicateValues(dataset[sheet], field)) {
      errors.push(`${sheet}: identificador duplicado "${duplicate}".`);
    }
  }

  const sets = {
    categories: new Set(dataset.Categorias.map(r => text(r.ID_Categoria))),
    responsaveis: new Set(dataset.Responsaveis.map(r => text(r.ID_Responsavel))),
    setores: new Set(dataset.Setores.map(r => text(r.ID_Setor))),
    locais: new Set(dataset.LocaisFisicos.map(r => text(r.ID_Local))),
    andares: new Set(dataset.Andares.map(r => text(r.ID_Andar))),
    unidades: new Set(dataset.Unidades.map(r => text(r.ID_Unidade)))
  };

  dataset.Bens.forEach((r, i) => {
    const line = i + 2;
    if (!text(r.Tombamento)) errors.push(`Bens, linha ${line}: tombamento obrigatório.`);
    if (!text(r.Descricao_Bem)) errors.push(`Bens, linha ${line}: descrição obrigatória.`);
    if (!sets.categories.has(text(r.ID_Categoria))) errors.push(`Bens, linha ${line}: categoria inexistente (${r.ID_Categoria}).`);
    if (!sets.setores.has(text(r.ID_Setor))) errors.push(`Bens, linha ${line}: setor inexistente (${r.ID_Setor}).`);
    if (!sets.responsaveis.has(text(r.ID_Responsavel))) errors.push(`Bens, linha ${line}: responsável inexistente (${r.ID_Responsavel}).`);
    if (!["Ativo", "Baixado"].includes(text(r.Situacao))) errors.push(`Bens, linha ${line}: situação inválida.`);
  });

  dataset.LocaisFisicos.forEach((r, i) => {
    if (!sets.unidades.has(text(r.ID_Unidade))) errors.push(`LocaisFisicos, linha ${i+2}: unidade inexistente (${r.ID_Unidade}).`);
    if (!sets.andares.has(text(r.ID_Andar))) errors.push(`LocaisFisicos, linha ${i+2}: andar inexistente (${r.ID_Andar}).`);
  });
  dataset.Andares.forEach((r, i) => {
    if (!sets.unidades.has(text(r.ID_Unidade))) errors.push(`Andares, linha ${i+2}: unidade inexistente (${r.ID_Unidade}).`);
  });
  dataset.Setores.forEach((r, i) => {
    if (!sets.locais.has(text(r.ID_Local_Atual))) errors.push(`Setores, linha ${i+2}: local de referência inexistente (${r.ID_Local_Atual}).`);
  });
  dataset.Responsaveis.forEach((r, i) => {
    if (!sets.setores.has(text(r.ID_Setor_Vinculo))) errors.push(`Responsaveis, linha ${i+2}: setor inexistente (${r.ID_Setor_Vinculo}).`);
  });

  if (dataset.Bens.length !== 400) errors.push(`Esperados 400 bens nesta planilha-modelo; encontrados ${dataset.Bens.length}.`);
  if (dataset.Categorias.length !== 5) errors.push(`Esperadas 5 categorias; encontradas ${dataset.Categorias.length}.`);
  if (dataset.Responsaveis.length !== 20) errors.push(`Esperados 20 responsáveis; encontrados ${dataset.Responsaveis.length}.`);
  if (dataset.Setores.length !== 20) errors.push(`Esperados 20 setores; encontrados ${dataset.Setores.length}.`);
  if (dataset.LocaisFisicos.length !== 20) errors.push(`Esperados 20 locais físicos; encontrados ${dataset.LocaisFisicos.length}.`);
  if (!dataset.Andares.length) errors.push("A aba Andares deve conter pelo menos um andar.");
  if (dataset.Unidades.length !== 3) errors.push(`Esperadas 3 unidades principais; encontradas ${dataset.Unidades.length}.`);

  return errors;
}

export async function prepareWorkbook(file) {
  preparedDataset = null;
  if (!file) throw new Error("Selecione um arquivo Excel.");
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: false });
  const missing = REQUIRED_SHEETS.filter(name => !workbook.SheetNames.includes(name));
  if (missing.length) throw new Error(`Abas obrigatórias ausentes: ${missing.join(", ")}.`);
  const dataset = {};
  for (const name of REQUIRED_SHEETS) dataset[name] = normalizeRows(workbook.Sheets[name]);

  const errors = validateDataset(dataset);
  if (errors.length) return { ok: false, errors, counts: Object.fromEntries(REQUIRED_SHEETS.map(n => [n, dataset[n]?.length || 0])) };

  const existing = await getCollectionRows("bens");
  if (existing.length > 0) {
    return { ok: false, errors: ["A coleção de bens já possui dados. A carga inicial só pode ser feita em uma base patrimonial vazia."], counts: Object.fromEntries(REQUIRED_SHEETS.map(n => [n, dataset[n].length])) };
  }

  preparedDataset = dataset;
  return { ok: true, errors: [], counts: Object.fromEntries(REQUIRED_SHEETS.map(n => [n, dataset[n].length])) };
}

export async function commitPreparedWorkbook(userUid) {
  if (!preparedDataset) throw new Error("Valide uma planilha sem erros antes de confirmar.");
  currentUserUid = userUid;
  await importInitialDataset(preparedDataset, currentUserUid);
  preparedDataset = null;
}
