/* Edição de demonstração DeLunaTech: persistência exclusivamente local. */
export const COLLECTIONS = {
  bens: "bens", categorias: "categorias", responsaveis: "responsaveis",
  setores: "setores", locais: "locais", andares: "andares", unidades: "unidades",
  movimentacoes: "movimentacoes", baixas: "baixas", auditoria: "auditoria", usuarios: "usuarios"
};
const STORAGE_KEY = "delunatech.gestao-patrimonial.demo.v1";
const MASTER = ["bens", "categorias", "responsaveis", "setores", "locais", "andares", "unidades"];
function readStore() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}
function writeStore(store) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
  catch (error) { throw new Error("Não foi possível salvar no armazenamento local. Exporte seus dados ou libere espaço no navegador. " + (error?.message || "")); }
}
function rows(store, name) { return Array.isArray(store[name]) ? store[name] : []; }
function keyFor(name, row) {
  const fields = { bens:"Tombamento", categorias:"ID_Categoria", responsaveis:"ID_Responsavel", setores:"ID_Setor", locais:"ID_Local", andares:"ID_Andar", unidades:"ID_Unidade" };
  return String(row?._id ?? row?.[fields[name]] ?? row?.id ?? "").trim();
}
function upsert(store, name, id, data, merge = true) {
  const list = rows(store, name).slice();
  const index = list.findIndex(item => keyFor(name, item) === String(id));
  const value = { ...(merge && index >= 0 ? list[index] : {}), ...data, _id: String(id) };
  if (index >= 0) list[index] = value; else list.push(value);
  store[name] = list;
}
function addEvent(store, name, data) {
  const list = rows(store, name).slice();
  list.push({ ...data, _id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, criadoEm: new Date().toISOString() });
  store[name] = list;
}
function audit(store, data) { addEvent(store, "auditoria", { entidade:"bem", ...data, criadoPor:"demo-local", usuarioEmail:"Demonstração local" }); }
export async function getCollectionRows(name) { return rows(readStore(), name).map(item => ({ ...item })); }
export async function getAssetCounts() {
  const assets = rows(readStore(), "bens"); let active = 0, retired = 0;
  for (const item of assets) { const status = String(item.Situacao ?? item.situacao ?? "").trim().toLocaleLowerCase("pt-BR"); if (status === "ativo") active++; if (status === "baixado") retired++; }
  return { total: assets.length, active, retired };
}
export async function importInitialDataset(dataset) {
  const store = readStore();
  if (rows(store, "bens").length) throw new Error("Já existem bens cadastrados. A importação inicial só funciona quando a base local está vazia.");
  const definitions = [["unidades",dataset.Unidades,"ID_Unidade"],["andares",dataset.Andares,"ID_Andar"],["locais",dataset.LocaisFisicos,"ID_Local"],["categorias",dataset.Categorias,"ID_Categoria"],["setores",dataset.Setores,"ID_Setor"],["responsaveis",dataset.Responsaveis,"ID_Responsavel"],["bens",dataset.Bens,"Tombamento"]];
  for (const [name, list, field] of definitions) store[name] = (list || []).map(row => { const id = String(row[field] ?? "").trim(); if (!id) throw new Error(`Registro sem identificador em ${name}.`); return { ...row, _id:id, criadoEm:new Date().toISOString(), criadoPor:"demo-local" }; });
  writeStore(store); return true;
}
export async function deleteTestMasterData() { const store = readStore(); for (const name of MASTER) store[name] = []; writeStore(store); }
export async function recordAssetTransfer({ asset, destinationSector, destinationResponsible, reason, notes }) {
  const store = readStore(); const id = String(asset.Tombamento);
  const updated = { ...asset, ID_Setor:destinationSector.ID_Setor, ID_Responsavel:destinationResponsible?.ID_Responsavel ?? asset.ID_Responsavel ?? "", atualizadoEm:new Date().toISOString() };
  upsert(store,"bens",id,updated,false);
  addEvent(store,"movimentacoes",{ Tombamento:id, Descricao_Bem:asset.Descricao_Bem ?? "", tipo:"TRANSFERENCIA", setorOrigemId:asset.ID_Setor ?? "", setorOrigemNome:asset._origemNome ?? "", setorDestinoId:destinationSector.ID_Setor, setorDestinoNome:destinationSector.Nome_Setor, responsavelAnteriorId:asset.ID_Responsavel ?? "", responsavelNovoId:destinationResponsible?.ID_Responsavel ?? asset.ID_Responsavel ?? "", motivo:reason, observacoes:notes ?? "", criadoPor:"demo-local", usuarioEmail:"Demonstração local" });
  audit(store,{ Tombamento:id, operacao:"TRANSFERENCIA", resumo:`Transferência do setor ${asset._origemNome || asset.ID_Setor} para ${destinationSector.Nome_Setor}`, motivo:reason, observacoes:notes ?? "" }); writeStore(store);
}
export async function recordAssetDisposal({ asset, reason, documentNumber, notes }) {
  const store = readStore(); const id = String(asset.Tombamento);
  upsert(store,"bens",id,{ ...asset, Situacao:"Baixado", atualizadoEm:new Date().toISOString() },false);
  addEvent(store,"baixas",{ Tombamento:id, Descricao_Bem:asset.Descricao_Bem ?? "", categoriaId:asset.ID_Categoria ?? "", setorId:asset.ID_Setor ?? "", responsavelId:asset.ID_Responsavel ?? "", situacaoAnterior:asset.Situacao ?? "Ativo", situacaoNova:"Baixado", motivo:reason, documentoAutorizacao:documentNumber ?? "", observacoes:notes ?? "", criadoPor:"demo-local", usuarioEmail:"Demonstração local" });
  audit(store,{ Tombamento:id, operacao:"BAIXA_PATRIMONIAL", resumo:`Baixa patrimonial do bem ${id}`, motivo:reason, documentoAutorizacao:documentNumber ?? "", observacoes:notes ?? "" }); writeStore(store);
}
export async function saveReferenceRecord(collectionName, id, data, creating = false) {
  const store = readStore(); const key = String(id); const before = rows(store,collectionName).find(row => keyFor(collectionName,row) === key);
  if (creating && before) throw new Error("Já existe um cadastro com este identificador.");
  upsert(store,collectionName,key,{ ...data, atualizadoEm:new Date().toISOString(), ...(creating ? { criadoEm:new Date().toISOString() } : {}) },!creating); writeStore(store);
}
export async function saveAssetRecord({ asset, originalTombamento, creating }) {
  const store = readStore(); const id = String(asset.Tombamento ?? "").trim();
  if (!id) throw new Error("Tombamento é obrigatório.");
  if (creating && rows(store,"bens").some(item => String(item.Tombamento) === id)) throw new Error("Já existe um bem com esse tombamento.");
  if (!creating && String(originalTombamento) !== id) throw new Error("O tombamento não pode ser alterado durante a edição.");
  upsert(store,"bens",id,{ ...asset, criadoEm:creating ? new Date().toISOString() : (asset.criadoEm ?? new Date().toISOString()), atualizadoEm:new Date().toISOString() },creating ? false : true);
  audit(store,{ Tombamento:id, operacao:creating ? "CADASTRO_BEM" : "EDICAO_BEM", resumo:creating ? `Cadastro do bem ${id}` : `Edição cadastral do bem ${id}` }); writeStore(store);
}
export async function changeSectorLocation({ sector, destinationPlace, reason, notes, affectedAssetCount, affectedAssets = [] }) {
  const store = readStore(); const id = String(sector.ID_Setor);
  upsert(store,"setores",id,{ ...sector, ID_Local_Atual:destinationPlace.ID_Local, atualizadoEm:new Date().toISOString() },false);
  addEvent(store,"movimentacoes",{ tipo:"MUDANCA_LOCALIZACAO_SETOR", setorId:id, setorNome:sector.Nome_Setor ?? "", localOrigemId:sector.ID_Local_Atual ?? sector.ID_Local_Referencia ?? "", localOrigemNome:sector._origemDescricao ?? "", localDestinoId:String(destinationPlace.ID_Local), localDestinoNome:destinationPlace._descricaoCompleta ?? destinationPlace.Descricao_Local ?? destinationPlace.Nome_Local_Fisico ?? "", motivo:reason, observacoes:notes ?? "", quantidadeBensAfetados:affectedAssetCount, bensAfetados:affectedAssets.map(item => String(item.Tombamento ?? "")).filter(Boolean), criadoPor:"demo-local", usuarioEmail:"Demonstração local" });
  addEvent(store,"auditoria",{ entidade:"setor", setorId:id, operacao:"MUDANCA_LOCALIZACAO_SETOR", resumo:`Mudança de localização do setor ${sector.Nome_Setor}`, localOrigemId:sector.ID_Local_Atual ?? sector.ID_Local_Referencia ?? "", localOrigemNome:sector._origemDescricao ?? "", localDestinoId:String(destinationPlace.ID_Local), localDestinoNome:destinationPlace.Descricao_Local ?? destinationPlace.Nome_Local_Fisico ?? "", motivo:reason, observacoes:notes ?? "", quantidadeBensAfetados:affectedAssetCount, criadoPor:"demo-local", usuarioEmail:"Demonstração local" }); writeStore(store);
}
