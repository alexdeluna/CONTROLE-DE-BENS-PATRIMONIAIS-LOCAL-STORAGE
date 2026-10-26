/* Edição de demonstração DeLunaTech: persistência exclusivamente local. */
export const COLLECTIONS = {
  bens: "bens", categorias: "categorias", responsaveis: "responsaveis",
  setores: "setores", locais: "locais", andares: "andares", unidades: "unidades",
  movimentacoes: "movimentacoes", baixas: "baixas", auditoria: "auditoria", usuarios: "usuarios"
};
const STORAGE_KEY = "delunatech.gestao-patrimonial.demo.v1";
const MASTER = ["bens", "categorias", "responsaveis", "setores", "locais", "andares", "unidades"];

const DEMO_VERSION = "delunatech-demo-seed-v1";
function buildDemoDataset() {
  const unidades = [
    {ID_Unidade:"U-REC",Nome_Unidade:"Unidade Recife",Cidade:"Recife",Estado:"PE"},
    {ID_Unidade:"U-JPA",Nome_Unidade:"Unidade João Pessoa",Cidade:"João Pessoa",Estado:"PB"},
    {ID_Unidade:"U-MCZ",Nome_Unidade:"Unidade Maceió",Cidade:"Maceió",Estado:"AL"}
  ];
  const andares=[], locais=[], setores=[], responsaveis=[];
  const floorsByUnit = new Map();
  for (const u of unidades) {
    const max = u.ID_Unidade === "U-REC" ? 6 : 2;
    const arr=[];
    for(let n=0;n<=max;n++) { const id=`${u.ID_Unidade}-A${n}`; andares.push({ID_Andar:id,ID_Unidade:u.ID_Unidade,Nome_Andar:n===0?"Térreo":`${n}º andar`}); arr.push(id); }
    floorsByUnit.set(u.ID_Unidade,arr);
  }
  const sectorNames=["Tecnologia da Informação","Recursos Humanos","Financeiro","Administrativo","Atendimento","Compras","Patrimônio","Jurídico","Operações","Diretoria","Comunicação","Arquivo","Engenharia","Suporte Técnico","Planejamento","Logística","Contabilidade","Protocolo","Infraestrutura","Sala de Reuniões"];
  const first=["Ana","Bruno","Camila","Daniel","Eduarda","Felipe","Gabriela","Henrique","Isabela","João","Karen","Lucas","Mariana","Nicolas","Olívia","Paulo","Rafaela","Samuel","Tatiana","Vinícius"];
  const last=["Almeida","Barbosa","Carvalho","Dias","Esteves","Ferreira","Gomes","Lima","Moura","Nunes","Oliveira","Pereira","Queiroz","Ramos","Santos","Teixeira","Vieira","Xavier","Araújo","Costa"];
  for(let i=0;i<20;i++) responsaveis.push({ID_Responsavel:`R-${String(i+1).padStart(3,'0')}`,Nome_Completo:`${first[i]} ${last[(i*3)%20]}`,Email:`responsavel${i+1}@exemplo.invalid`});
  for(let i=0;i<20;i++) {
    const u=unidades[i%3], floorList=floorsByUnit.get(u.ID_Unidade), floor=floorList[Math.min(floorList.length-1,Math.floor(i/3)%floorList.length)];
    const localId=`L-${String(i+1).padStart(3,'0')}`;
    locais.push({ID_Local:localId,ID_Unidade:u.ID_Unidade,ID_Andar:floor,Nome_Local_Fisico:`Sala ${String(101+i).padStart(3,'0')}`,Descricao_Local:`${u.Nome_Unidade} · ${floor} · Sala ${String(101+i).padStart(3,'0')}`});
    setores.push({ID_Setor:`S-${String(i+1).padStart(3,'0')}`,Nome_Setor:sectorNames[i],ID_Local_Atual:localId,ID_Responsavel:responsaveis[i].ID_Responsavel});
  }
  const catNames=["Computadores e notebooks","Monitores","Impressoras e scanners","Rede e servidores","Periféricos e acessórios","Mobiliário e outros"];
  const categorias=catNames.map((n,i)=>({ID_Categoria:`C-${String(i+1).padStart(2,'0')}`,Nome_Categoria:n}));
  const models=[
    ["Notebook corporativo","Dell","Latitude 5440"],["Computador desktop","Lenovo","ThinkCentre M70"],["Monitor LED 24 polegadas","Dell","P2422H"],["Impressora multifuncional","Brother","MFC-L8900"],["Switch de rede 24 portas","Cisco","CBS350"],["Teclado USB","Logitech","K120"],["Mouse óptico USB","Logitech","B100"],["Estabilizador de energia","SMS","Revolution"],["Projetor multimídia","Epson","PowerLite"],["Cadeira de escritório","Flexform","Uni Me"]
  ];
  const bens=[];
  for(let i=0;i<300;i++) {
    const m=models[i%models.length], catIndex=i<65?0:i<110?1:i<130?2:i<155?3:i<220?4:5;
    const sectorIndex=i%20, sector=setores[sectorIndex], person=responsaveis[sectorIndex], unit=unidades[sectorIndex%3];
    bens.push({Tombamento:String(5200007000+i),Descricao_Bem:m[0],ID_Categoria:categorias[catIndex].ID_Categoria,ID_Setor:sector.ID_Setor,ID_Responsavel:person.ID_Responsavel,Situacao:"Ativo",Marca:m[1],Modelo:m[2],Numero_Serie:`DLT-${String(10000+i)}`,Data_Aquisicao:`202${i%6}-0${i%9+1}-15`,Valor_Aquisicao:[3200,780,1450,5600,900,90,65,420,2400,1100][i%10],Observacoes:"Registro fictício para demonstração pública.",_demoBase:true});
  }
  return {unidades,andares,locais,setores,responsaveis,categorias,bens};
}
export async function ensureDemoSeed() {
  const store=readStore();
  if(store._demoSeedVersion===DEMO_VERSION) return false;
  if(rows(store,"bens").length) { store._demoSeedVersion=DEMO_VERSION; writeStore(store); return false; }
  const d=buildDemoDataset();
  for(const name of ["unidades","andares","locais","setores","responsaveis","categorias","bens"]) {
    store[name]=d[name].map(row=>({...row,_id:String(row.Tombamento??row.ID_Categoria??row.ID_Responsavel??row.ID_Setor??row.ID_Local??row.ID_Andar??row.ID_Unidade),criadoPor:row._demoBase?"base-demo":"base-demo",criadoEm:new Date().toISOString()}));
  }
  store._demoSeedVersion=DEMO_VERSION; writeStore(store); return true;
}

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
  const currentAsset = rows(store,"bens").find(item => String(item.Tombamento) === id);
  if (!currentAsset) throw new Error("O bem selecionado não foi encontrado na base local.");
  const originSectorName = rows(store,"setores").find(item => String(item.ID_Setor) === String(currentAsset.ID_Setor))?.Nome_Setor ?? currentAsset.ID_Setor ?? "";
  const updated = { ...currentAsset, ID_Setor:destinationSector.ID_Setor, ID_Responsavel:destinationResponsible?.ID_Responsavel ?? currentAsset.ID_Responsavel ?? "", atualizadoEm:new Date().toISOString() };
  upsert(store,"bens",id,updated,false);
  addEvent(store,"movimentacoes",{ Tombamento:id, Descricao_Bem:asset.Descricao_Bem ?? "", tipo:"TRANSFERENCIA", setorOrigemId:currentAsset.ID_Setor ?? "", setorOrigemNome:originSectorName, setorDestinoId:destinationSector.ID_Setor, setorDestinoNome:destinationSector.Nome_Setor, responsavelAnteriorId:currentAsset.ID_Responsavel ?? "", responsavelNovoId:destinationResponsible?.ID_Responsavel ?? currentAsset.ID_Responsavel ?? "", motivo:reason, observacoes:notes ?? "", criadoPor:"demo-local", usuarioEmail:"Demonstração local" });
  audit(store,{ Tombamento:id, operacao:"TRANSFERENCIA", resumo:`Transferência do setor ${originSectorName} para ${destinationSector.Nome_Setor}`, motivo:reason, observacoes:notes ?? "" }); writeStore(store);
}
export async function recordAssetDisposal({ asset, reason, documentNumber, notes }) {
  const store = readStore(); const id = String(asset.Tombamento);
  const currentAsset = rows(store,"bens").find(item => String(item.Tombamento) === id);
  if (!currentAsset) throw new Error("O bem selecionado não foi encontrado na base local.");
  upsert(store,"bens",id,{ ...currentAsset, Situacao:"Baixado", atualizadoEm:new Date().toISOString() },false);
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
  if (!creating && rows(store,"bens").some(item => String(item.Tombamento)===String(originalTombamento) && item._demoBase)) throw new Error("Este é um registro original da demonstração e não pode ser editado. Cadastre um novo bem para experimentar.");
  if (creating && rows(store,"bens").some(item => String(item.Tombamento) === id)) throw new Error("Já existe um bem com esse tombamento.");
  if (!creating && String(originalTombamento) !== id) throw new Error("O tombamento não pode ser alterado durante a edição.");
  upsert(store,"bens",id,{ ...asset, criadoEm:creating ? new Date().toISOString() : (asset.criadoEm ?? new Date().toISOString()), atualizadoEm:new Date().toISOString() },creating ? false : true);
  audit(store,{ Tombamento:id, operacao:creating ? "CADASTRO_BEM" : "EDICAO_BEM", resumo:creating ? `Cadastro do bem ${id}` : `Edição cadastral do bem ${id}` }); writeStore(store);
}
export async function changeSectorLocation({ sector, destinationPlace, reason, notes, affectedAssetCount, affectedAssets = [] }) {
  const store = readStore(); const id = String(sector.ID_Setor);
  if (rows(store,"setores").some(item => String(item.ID_Setor) === id && item._demoBase)) throw new Error("Este setor pertence à base original da demonstração e não pode ser alterado.");
  upsert(store,"setores",id,{ ...sector, ID_Local_Atual:destinationPlace.ID_Local, atualizadoEm:new Date().toISOString() },false);
  addEvent(store,"movimentacoes",{ tipo:"MUDANCA_LOCALIZACAO_SETOR", setorId:id, setorNome:sector.Nome_Setor ?? "", localOrigemId:sector.ID_Local_Atual ?? sector.ID_Local_Referencia ?? "", localOrigemNome:sector._origemDescricao ?? "", localDestinoId:String(destinationPlace.ID_Local), localDestinoNome:destinationPlace._descricaoCompleta ?? destinationPlace.Descricao_Local ?? destinationPlace.Nome_Local_Fisico ?? "", motivo:reason, observacoes:notes ?? "", quantidadeBensAfetados:affectedAssetCount, bensAfetados:affectedAssets.map(item => String(item.Tombamento ?? "")).filter(Boolean), criadoPor:"demo-local", usuarioEmail:"Demonstração local" });
  addEvent(store,"auditoria",{ entidade:"setor", setorId:id, operacao:"MUDANCA_LOCALIZACAO_SETOR", resumo:`Mudança de localização do setor ${sector.Nome_Setor}`, localOrigemId:sector.ID_Local_Atual ?? sector.ID_Local_Referencia ?? "", localOrigemNome:sector._origemDescricao ?? "", localDestinoId:String(destinationPlace.ID_Local), localDestinoNome:destinationPlace.Descricao_Local ?? destinationPlace.Nome_Local_Fisico ?? "", motivo:reason, observacoes:notes ?? "", quantidadeBensAfetados:affectedAssetCount, criadoPor:"demo-local", usuarioEmail:"Demonstração local" }); writeStore(store);
}
