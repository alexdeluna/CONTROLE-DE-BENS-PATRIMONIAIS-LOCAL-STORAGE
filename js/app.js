import { getAssetCounts, getCollectionRows, ensureDemoSeed, deleteTestMasterData, recordAssetTransfer, recordAssetDisposal, saveReferenceRecord, saveAssetRecord, changeSectorLocation } from "./db.js";
import { prepareWorkbook, commitPreparedWorkbook } from "./importacao.js";

const $ = id => document.getElementById(id);
let currentUser = null;
let currentProfile = null;
let importIsValid = false;

function setMessage(id, message, type = "") {
  const el = $(id);
  el.textContent = message;
  el.className = `message ${type}`.trim();
}

function showApp() {
  $("appView").hidden = false;
  $("sessionBox").hidden = false;
  $("sessionUser").textContent = "Demonstração local · dados neste navegador";
  ["disposalNavTab", "referenceNavTab", "sectorLocationNavTab"].forEach(id => { const tab = $(id); if (tab) tab.hidden = false; });
}

function activateView(viewId) {
  document.querySelectorAll(".view").forEach(v => v.hidden = v.id !== viewId);
  document.querySelectorAll(".nav-tab").forEach(b => b.classList.toggle("active", b.dataset.view === viewId));
}

async function refreshDashboard() {
  try {
    const counts = await getAssetCounts();
    $("totalAssets").textContent = counts.total;
    $("activeAssets").textContent = counts.active;
    $("retiredAssets").textContent = counts.retired;
    $("databaseStatus").textContent = counts.total === 0
      ? "A base local ainda não contém bens. Os registros criados neste navegador aparecerão aqui."
      : `Base local com ${counts.total} bens disponíveis para consulta.`;
  } catch (error) {
    $("databaseStatus").textContent = `Não foi possível consultar o banco: ${error.message}`;
  }
}

async function loadCategories() {
  const categories = await getCollectionRows("categorias");
  const select = $("categoryFilter");
  const previousValue = select.value;
  const normalizedName = value => String(value ?? "").trim().toLocaleLowerCase("pt-BR");
  const others = categories.filter(cat => normalizedName(cat.Nome_Categoria) === "outros equipamentos");
  const middle = categories
    .filter(cat => normalizedName(cat.Nome_Categoria) !== "outros equipamentos")
    .sort((a, b) => String(a.Nome_Categoria ?? "").localeCompare(String(b.Nome_Categoria ?? ""), "pt-BR", { sensitivity: "base" }));
  const ordered = [...middle, ...others];
  select.replaceChildren(new Option("Todas", ""));
  for (const cat of ordered) {
    const option = document.createElement("option");
    option.value = cat.ID_Categoria;
    option.textContent = cat.Nome_Categoria;
    select.append(option);
  }
  if ([...select.options].some(option => option.value === previousValue)) select.value = previousValue;
}

function cell(row, value) {
  const td = document.createElement("td");
  td.textContent = value ?? "";
  row.append(td);
}

async function searchAssets() {
  setMessage("assetsMessage", "Consultando bens e localização física...");
  try {
    const [assets, categories, sectors, places, floors, units, people] = await Promise.all([
      getCollectionRows("bens"), getCollectionRows("categorias"),
      getCollectionRows("setores"), getCollectionRows("locais"),
      getCollectionRows("andares"), getCollectionRows("unidades"),
      getCollectionRows("responsaveis")
    ]);
    const catMap = new Map(categories.map(x => [String(x.ID_Categoria ?? ""), x.Nome_Categoria]));
    const sectorMap = new Map(sectors.map(x => [String(x.ID_Setor ?? ""), x]));
    const placeMap = new Map(places.map(x => [String(x.ID_Local ?? ""), x]));
    const floorMap = new Map(floors.map(x => [String(x.ID_Andar ?? ""), x]));
    const unitMap = new Map(units.map(x => [String(x.ID_Unidade ?? ""), x]));
    const peopleMap = new Map(people.map(x => [String(x.ID_Responsavel ?? ""), x]));

    // Popula os filtros com os cadastros locais atuais, preservando a seleção.
    const sectorSelect = $("sectorFilter");
    const previousSector = sectorSelect.value;
    sectorSelect.replaceChildren(new Option("Todos", ""));
    for (const sector of sectors.slice().sort((a,b) => String(a.Nome_Setor ?? "").localeCompare(String(b.Nome_Setor ?? ""), "pt-BR"))) {
      sectorSelect.add(new Option(sector.Nome_Setor || sector.ID_Setor, String(sector.ID_Setor)));
    }
    if ([...sectorSelect.options].some(o => o.value === previousSector)) sectorSelect.value = previousSector;

    const responsibleSelect = $("responsibleFilter");
    const previousResponsible = responsibleSelect.value;
    responsibleSelect.replaceChildren(new Option("Todos", ""));
    for (const person of people.slice().sort((a,b) => String(a.Nome_Completo ?? "").localeCompare(String(b.Nome_Completo ?? ""), "pt-BR"))) {
      responsibleSelect.add(new Option(person.Nome_Completo || person.ID_Responsavel, String(person.ID_Responsavel)));
    }
    if ([...responsibleSelect.options].some(o => o.value === previousResponsible)) responsibleSelect.value = previousResponsible;

    const term = $("assetSearch").value.trim().toLocaleLowerCase("pt-BR");
    const cat = $("categoryFilter").value;
    const status = $("statusFilter").value;
    const sectorIdFilter = sectorSelect.value;
    const responsibleIdFilter = responsibleSelect.value;
    const filtered = assets.filter(a =>
      (!term || String(a.Tombamento ?? "").toLocaleLowerCase("pt-BR").includes(term) || String(a.Descricao_Bem ?? "").toLocaleLowerCase("pt-BR").includes(term)) &&
      (!cat || String(a.ID_Categoria ?? "") === cat) &&
      (!status || String(a.Situacao ?? a.situacao ?? "") === status) &&
      (!sectorIdFilter || String(a.ID_Setor ?? "") === sectorIdFilter) &&
      (!responsibleIdFilter || String(a.ID_Responsavel ?? "") === responsibleIdFilter)
    );
    const tbody = $("assetsTableBody");
    tbody.replaceChildren();
    for (const asset of filtered.slice(0, 500)) {
      const tr = document.createElement("tr");
      const sectorId = String(asset.ID_Setor ?? "");
      const sector = sectorMap.get(sectorId);
      // Compatibilidade de leitura: schema atual usa ID_Local_Atual; dados antigos podem usar ID_Local_Referencia.
      const localId = String(sector?.ID_Local_Atual ?? sector?.ID_Local_Referencia ?? asset.ID_Local ?? "");
      const place = placeMap.get(localId);
      const floorId = String(place?.ID_Andar ?? "");
      const floor = floorMap.get(floorId);
      const unitId = String(place?.ID_Unidade ?? floor?.ID_Unidade ?? "");
      const unit = unitMap.get(unitId);
      const locationComplete = Boolean(place && floor && unit);
      const locationStatus = !place
        ? "Localização não cadastrada"
        : !floor
          ? "Andar não cadastrado"
          : !unit
            ? "Unidade não cadastrada"
            : "";
      cell(tr, asset.Tombamento);
      cell(tr, asset.Descricao_Bem);
      cell(tr, catMap.get(String(asset.ID_Categoria ?? "")) || asset.ID_Categoria || "Não informado");
      cell(tr, sector?.Nome_Setor || sectorId || "Setor não cadastrado");
      cell(tr, unit?.Nome_Unidade || (place?.Nome_Unidade ?? "Não informado"));
      cell(tr, floor?.Nome_Andar || (place ? "Andar não cadastrado" : "—"));
      cell(tr, place?.Nome_Local_Fisico || locationStatus || "—");
      cell(tr, peopleMap.get(String(asset.ID_Responsavel ?? ""))?.Nome_Completo || asset.ID_Responsavel || "Não informado");
      cell(tr, asset.Situacao || asset.situacao || "Não informado");
      if (!locationComplete) tr.classList.add("location-incomplete");
      tr.classList.add("asset-result-row");
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", `Abrir ficha do bem ${asset.Tombamento}`);
      tr.addEventListener("click", () => openAssetDetail(asset.Tombamento));
      tr.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openAssetDetail(asset.Tombamento);
        }
      });
      const actionCell = document.createElement("td");
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "button button-secondary button-small";
      editButton.textContent = asset._demoBase ? "Registro original" : "Editar";
      editButton.disabled = Boolean(asset._demoBase);
      editButton.title = asset._demoBase ? "Registro original protegido contra edição" : "Editar este bem";
      editButton.addEventListener("click", event => {
        event.stopPropagation();
        openAssetForm(asset.Tombamento).catch(error => setMessage("assetFormMessage", error.message, "error"));
      });
      actionCell.append(editButton);
      tr.append(actionCell);
      tbody.append(tr);
    }
    setMessage("assetsMessage", `${filtered.length} bem(ns) encontrado(s). A localização é resolvida pelo setor; cadastros incompletos são identificados explicitamente.`);
  } catch (error) {
    setMessage("assetsMessage", `Falha na consulta: ${error.message}`, "error");
  }
}


let reportRows = [];
let reportLoaded = false;
const reportCurrency = value => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const reportStatus = asset => String(asset.Situacao ?? asset.situacao ?? "Não informado").trim();

async function loadReportOptions() {
  const [categories, sectors, units, people] = await Promise.all([
    getCollectionRows("categorias"), getCollectionRows("setores"), getCollectionRows("unidades"), getCollectionRows("responsaveis")
  ]);
  const fill = (id, rows, valueKey, labelKey, allLabel) => {
    const select = $(id), previous = select.value;
    select.replaceChildren(new Option(allLabel, ""));
    rows.slice().sort((a,b)=>String(a[labelKey]??"").localeCompare(String(b[labelKey]??""),"pt-BR")).forEach(row=>select.add(new Option(row[labelKey] || row[valueKey], String(row[valueKey] ?? ""))));
    if ([...select.options].some(o=>o.value===previous)) select.value=previous;
  };
  fill("reportCategory",categories,"ID_Categoria","Nome_Categoria","Todas");
  fill("reportSector",sectors,"ID_Setor","Nome_Setor","Todos");
  fill("reportUnit",units,"ID_Unidade","Nome_Unidade","Todas");
  fill("reportResponsible",people,"ID_Responsavel","Nome_Completo","Todos");
}

async function runGeneralReport() {
  setMessage("reportMessage","Consultando dados patrimoniais...");
  try {
    const [assets,categories,sectors,places,floors,units,people] = await Promise.all([
      getCollectionRows("bens"),getCollectionRows("categorias"),getCollectionRows("setores"),getCollectionRows("locais"),getCollectionRows("andares"),getCollectionRows("unidades"),getCollectionRows("responsaveis")
    ]);
    const catMap=new Map(categories.map(x=>[String(x.ID_Categoria??""),x.Nome_Categoria||"Não informado"]));
    const sectorMap=new Map(sectors.map(x=>[String(x.ID_Setor??""),x]));
    const placeMap=new Map(places.map(x=>[String(x.ID_Local??""),x]));
    const floorMap=new Map(floors.map(x=>[String(x.ID_Andar??""),x]));
    const unitMap=new Map(units.map(x=>[String(x.ID_Unidade??""),x]));
    const personMap=new Map(people.map(x=>[String(x.ID_Responsavel??""),x.Nome_Completo||"Não informado"]));
    const enriched=assets.map(a=>{
      const sector=sectorMap.get(String(a.ID_Setor??""));
      const place=placeMap.get(String(sector?.ID_Local_Atual??sector?.ID_Local_Referencia??a.ID_Local??""));
      const floor=floorMap.get(String(place?.ID_Andar??""));
      const unit=unitMap.get(String(place?.ID_Unidade??floor?.ID_Unidade??""));
      const rawValue=a.Valor_Aquisicao;
      const valueMissing=rawValue===null||rawValue===undefined||String(rawValue).trim()===""||!Number.isFinite(Number(rawValue));
      return {...a,_categoria:catMap.get(String(a.ID_Categoria??""))||String(a.ID_Categoria||"Não informado"),_setor:sector?.Nome_Setor||"Não informado",_unidade:unit?.Nome_Unidade||place?.Nome_Unidade||"Não informado",_unidadeId:String(unit?.ID_Unidade??place?.ID_Unidade??floor?.ID_Unidade??""),_andar:floor?.Nome_Andar||"Não informado",_local:place?.Nome_Local_Fisico||"Não informado",_responsavel:personMap.get(String(a.ID_Responsavel??""))||String(a.ID_Responsavel||"Não informado"),_situacao:reportStatus(a),_valorAusente:valueMissing,_valor:valueMissing?null:Number(rawValue)};
    });
    const term=$("reportSearch").value.trim().toLocaleLowerCase("pt-BR"), cat=$("reportCategory").value, unit=$("reportUnit").value, sector=$("reportSector").value, responsible=$("reportResponsible").value, status=$("reportStatus").value;
    reportRows=enriched.filter(a=>(!term||String(a.Tombamento??"").toLocaleLowerCase("pt-BR").includes(term)||String(a.Descricao_Bem??"").toLocaleLowerCase("pt-BR").includes(term))&&(!cat||String(a.ID_Categoria??"")===cat)&&(!unit||String(a._unidadeId)===unit)&&(!sector||String(a.ID_Setor??"")===sector)&&(!responsible||String(a.ID_Responsavel??"")===responsible)&&(!status||a._situacao===status));
    const sort=$("reportSort").value;
    reportRows.sort((a,b)=>{
      if(sort==="descricao") return String(a.Descricao_Bem??"").localeCompare(String(b.Descricao_Bem??""),"pt-BR");
      if(sort==="categoria") return String(a._categoria).localeCompare(String(b._categoria),"pt-BR");
      if(sort==="setor") return String(a._setor).localeCompare(String(b._setor),"pt-BR");
      return String(a.Tombamento??"").localeCompare(String(b.Tombamento??""),"pt-BR",{numeric:true});
    });
    $("reportCount").textContent=String(reportRows.length);
    $("reportActiveCount").textContent=String(reportRows.filter(a=>a._situacao==="Ativo").length);
    $("reportValue").textContent=reportCurrency(reportRows.reduce((sum,a)=>sum+(a._valorAusente?0:a._valor),0));
    $("reportMissingValue").textContent=String(reportRows.filter(a=>a._valorAusente).length);
    const body=$("reportTableBody"); body.replaceChildren();
    if(!reportRows.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=14;td.textContent="Nenhum bem corresponde aos filtros selecionados.";tr.append(td);body.append(tr);setMessage("reportMessage","Nenhum resultado. Ajuste os filtros para consultar outros bens.");}
    else {
      for(const a of reportRows){const tr=document.createElement("tr"); const values=[a.Tombamento,a.Descricao_Bem,a._categoria,a.Marca,a.Modelo,a.Numero_Serie??a.Numero_Serie_Bem,a._unidade,a._andar,a._local,a._setor,a._responsavel,a._situacao,a.Data_Aquisicao,a._valorAusente?"Não informado":reportCurrency(a._valor)]; values.forEach(v=>cell(tr,v??""));body.append(tr);}
      setMessage("reportMessage",`${reportRows.length} bem(ns) no relatório. ${reportRows.filter(a=>a._valorAusente).length} sem valor de aquisição informado.`);
    }
    reportLoaded=true;
  } catch(error){setMessage("reportMessage",`Não foi possível gerar o relatório: ${error.message}`,"error");}
}

function reportFiltersText(){
  const labels=[["Pesquisa",$("reportSearch").value||"Todas"],["Categoria",$("reportCategory").selectedOptions[0]?.textContent||"Todas"],["Unidade",$("reportUnit").selectedOptions[0]?.textContent||"Todas"],["Setor",$("reportSector").selectedOptions[0]?.textContent||"Todos"],["Responsável",$("reportResponsible").selectedOptions[0]?.textContent||"Todos"],["Situação",$("reportStatus").selectedOptions[0]?.textContent||"Todas"],["Ordenação",$("reportSort").selectedOptions[0]?.textContent||"Tombamento"]];
  return labels.map(([k,v])=>`${k}: ${v}`).join(" | ");
}
function exportGeneralReportExcel(){
  if(!reportLoaded) { setMessage("reportMessage","Atualize o relatório antes de exportar.","error"); return; }
  const fields=[["Tombamento","Tombamento"],["Descrição","Descricao_Bem"],["Categoria","_categoria"],["Marca","Marca"],["Modelo","Modelo"],["Número de série","Numero_Serie"],["Unidade","_unidade"],["Andar","_andar"],["Local físico","_local"],["Setor","_setor"],["Responsável","_responsavel"],["Situação","_situacao"],["Data de aquisição","Data_Aquisicao"],["Valor de aquisição (R$)","_valor"],["Observações","Observacoes"]];
  const xmlEscape = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
  const cellXml = value => {
    const numeric = typeof value === "number" && Number.isFinite(value);
    return `<Cell><Data ss:Type="${numeric?"Number":"String"}">${xmlEscape(value)}</Data></Cell>`;
  };
  const sheetXml = (name, matrix) => `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${matrix.map(row=>`<Row>${row.map(cellXml).join("")}</Row>`).join("")}</Table></Worksheet>`;
  const inventoryMatrix=[fields.map(([label])=>label),...reportRows.map(a=>fields.map(([label,key])=>key==="Numero_Serie"?(a.Numero_Serie??a.Numero_Serie_Bem??""):key==="_valor"?(a._valorAusente?"":a._valor):(a[key]??"")))];
  const summaryMatrix=[["Indicador","Valor"],["Quantidade de bens encontrados",reportRows.length],["Bens ativos",reportRows.filter(a=>a._situacao==="Ativo").length],["Valor de aquisição conhecido (R$)",reportRows.reduce((sum,a)=>sum+(a._valorAusente?0:a._valor),0)],["Bens sem valor informado",reportRows.filter(a=>a._valorAusente).length],["Data de geração",new Date().toLocaleString("pt-BR")],["Filtros aplicados",reportFiltersText()]];
  const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheetXml("Inventário",inventoryMatrix)}${sheetXml("Resumo",summaryMatrix)}</Workbook>`;
  const blob=new Blob([xml],{type:"application/vnd.ms-excel;charset=utf-8"});
  const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="Relatorio_Geral_Inventario.xls";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}

function exportGeneralReportPdf(){
  if(!reportLoaded){setMessage("reportMessage","Atualize o relatório antes de exportar.","error");return;}
  const filters=reportFiltersText(), generated=new Date().toLocaleString("pt-BR");
  const rows=reportRows.map(a=>[a.Tombamento,a.Descricao_Bem,a._categoria,a._unidade,a._andar,a._local,a._setor,a._responsavel,a._situacao,a._valorAusente?"Não informado":reportCurrency(a._valor)]);
  const escapeHtml=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const tableRows=rows.map(r=>`<tr>${r.map(v=>`<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("");
  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório Geral do Inventário</title><style>@page{size:A4 landscape;margin:10mm}body{font:9px Arial,sans-serif;color:#172b3d}h1,h2,p{text-align:center;margin:4px}h1{font-size:16px}h2{font-size:12px}.meta{font-size:8px;text-align:left;margin:8px 0}.metrics{display:flex;justify-content:space-around;margin:10px 0;font-weight:bold}table{width:100%;border-collapse:collapse;table-layout:auto}th,td{border:1px solid #b8c7d4;padding:3px 4px;overflow-wrap:anywhere;word-break:normal;text-align:left}th{font-size:7px}td{font-size:7px}td:first-child{white-space:nowrap}th{background:#e8eef4}thead{display:table-header-group}tr{break-inside:avoid}footer{margin-top:8px;font-size:8px}</style></head><body><h1>PORTAL DE GESTÃO PATRIMONIAL</h1><h2>RELATÓRIO GERAL DO INVENTÁRIO PATRIMONIAL</h2><div class="meta">Gerado em: ${escapeHtml(generated)}<br>Filtros: ${escapeHtml(filters)}</div><div class="metrics"><span>Bens encontrados: ${reportRows.length}</span><span>Bens ativos: ${reportRows.filter(a=>a._situacao==="Ativo").length}</span><span>Valor conhecido: ${escapeHtml(reportCurrency(reportRows.reduce((sum,a)=>sum+(a._valorAusente?0:a._valor),0)))}</span><span>Sem valor: ${reportRows.filter(a=>a._valorAusente).length}</span></div><table><thead><tr>${["Tombamento","Descrição","Categoria","Unidade","Andar","Local físico","Setor","Responsável","Situação","Valor aquisição"].map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table><footer>Relatório gerado pelo Portal de Gestão Patrimonial.</footer><script>window.onload=()=>window.print()</script></body></html>`;
  const win=window.open("","_blank"); if(!win){setMessage("reportMessage","Permita pop-ups para gerar o PDF.","error");return;} win.document.open();win.document.write(html);win.document.close();
}

function detailField(label, value) {
  const box = document.createElement("div");
  box.className = "detail-field";
  const heading = document.createElement("span");
  heading.className = "detail-label";
  heading.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value === null || value === undefined || String(value).trim() === "" ? "Não informado" : String(value);
  box.append(heading, content);
  return box;
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "Não informado";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function openAssetDetail(tombamento) {
  const modal = $("assetDetailModal");
  const content = $("assetDetailContent");
  const historyBox = $("assetHistoryContent");
  modal.hidden = false;
  modal.scrollIntoView({behavior:"smooth",block:"start"});
  content.replaceChildren();
  historyBox.replaceChildren();
  setMessage("assetDetailMessage", "Carregando ficha e histórico...");
  try {
    const [assets, categories, sectors, places, floors, units, people, moves, disposals, audit] = await Promise.all([
      getCollectionRows("bens"), getCollectionRows("categorias"),
      getCollectionRows("setores"), getCollectionRows("locais"),
      getCollectionRows("andares"), getCollectionRows("unidades"),
      getCollectionRows("responsaveis"), getCollectionRows("movimentacoes"),
      getCollectionRows("baixas"), getCollectionRows("auditoria")
    ]);
    const asset = assets.find(a => String(a.Tombamento) === String(tombamento));
    if (!asset) throw new Error("O bem não foi encontrado na base atual.");
    const category = categories.find(x => x.ID_Categoria === asset.ID_Categoria);
    const sector = sectors.find(x => x.ID_Setor === asset.ID_Setor);
    const localId = String(sector?.ID_Local_Atual ?? sector?.ID_Local_Referencia ?? asset.ID_Local ?? "");
    const place = places.find(x => String(x.ID_Local) === localId);
    const floor = floors.find(x => String(x.ID_Andar) === String(place?.ID_Andar ?? ""));
    const unitId = String(place?.ID_Unidade ?? floor?.ID_Unidade ?? "");
    const unit = units.find(x => String(x.ID_Unidade) === unitId);
    const person = people.find(x => String(x.ID_Responsavel) === String(asset.ID_Responsavel));
    const locationStatus = !place ? "Localização não cadastrada" : !floor ? "Andar não cadastrado" : !unit ? "Unidade não cadastrada" : "Localização completa";
    setMessage("assetDetailMessage", locationStatus, locationStatus === "Localização completa" ? "success" : "error");
    const fields = [
      ["Tombamento", asset.Tombamento], ["Descrição", asset.Descricao_Bem],
      ["Categoria", category?.Nome_Categoria ?? asset.ID_Categoria],
      ["Situação", asset.Situacao], ["Marca", asset.Marca], ["Modelo", asset.Modelo],
      ["Número de série", asset.Numero_Serie], ["Unidade / edifício", unit?.Nome_Unidade],
      ["Andar", floor?.Nome_Andar], ["Sala / local físico", place?.Nome_Local_Fisico],
      ["Setor", sector?.Nome_Setor ?? asset.ID_Setor], ["Responsável", person?.Nome_Completo ?? asset.ID_Responsavel],
      ["Data de aquisição", asset.Data_Aquisicao], ["Valor de aquisição", formatCurrency(asset.Valor_Aquisicao)],
      ["Observações", asset.Observacoes]
    ];
    for (const [label, value] of fields) content.append(detailField(label, value));
    const directHistory = [...moves.map(x => ({...x, _kind: x.tipo === "MUDANCA_LOCALIZACAO_SETOR" ? "Mudança de localização do setor" : "Movimentação"})),
                           ...disposals.map(x => ({...x, _kind:"Baixa"})),
                           ...audit.map(x => ({...x, _kind:"Auditoria"}))]
      .filter(x => String(x.Tombamento ?? x.tombamento ?? x.ID_Bem ?? x.idBem ?? "") === String(tombamento));
    // Mudanças futuras do setor guardam um retrato dos tombamentos afetados no momento da operação.
    // Não associamos eventos antigos apenas pelo setor atual, pois isso poderia inventar vínculos históricos.
    const indirectSectorHistory = moves
      .filter(x => x.tipo === "MUDANCA_LOCALIZACAO_SETOR"
        && Array.isArray(x.bensAfetados)
        && x.bensAfetados.some(id => String(id) === String(tombamento)))
      .map(x => ({...x, _kind:"Mudança indireta de localização (setor)", _indirect:true,
        _historyDescription:`${x.localOrigemNome || "Localização anterior não informada"} → ${x.localDestinoNome || "Nova localização não informada"}${x.motivo ? ` · Motivo: ${x.motivo}` : ""}${x.observacoes ? ` · Observações: ${x.observacoes}` : ""}`}));
    const related = [...directHistory, ...indirectSectorHistory];
    if (!related.length) {
      const p = document.createElement("p");
      p.className = "small-note";
      p.textContent = "Nenhum registro de histórico encontrado para este bem.";
      historyBox.append(p);
    } else {
      related.sort((a,b) => {
        const timestamp = item => {
          const value = item.dataHora ?? item.criadoEm ?? item.data;
          if (value?.seconds) return value.seconds * 1000;
          return Date.parse(value ?? 0) || 0;
        };
        const av = timestamp(a);
        const bv = timestamp(b);
        return bv-av;
      });
      const list = document.createElement("ul");
      list.className = "history-list";
      for (const item of related) {
        const li = document.createElement("li");
        const title = document.createElement("strong");
        title.textContent = item._kind;
        const desc = document.createElement("p");
        desc.textContent = item._historyDescription || item.motivo || item.descricao || item.operacao || item.acao || item.observacoes || "Registro histórico disponível.";
        const meta = document.createElement("small");
        const rawWhen = item.dataHora ?? item.criadoEm ?? item.data;
        const when = rawWhen?.seconds ? new Date(rawWhen.seconds*1000).toLocaleString("pt-BR") : (rawWhen || "Data não informada");
        meta.textContent = `${when} · ${item.usuarioNome || item.usuarioEmail || item.criadoPor || "Usuário não informado"}`;
        li.append(title, desc, meta); list.append(li);
      }
      historyBox.append(list);
    }
  } catch (error) {
    setMessage("assetDetailMessage", `Não foi possível carregar a ficha: ${error.message}`, "error");
    const p = document.createElement("p");
    p.textContent = "Confira os dados locais e as referências relacionadas.";
    historyBox.append(p);
  }
}

$("closeAssetDetailBtn")?.addEventListener("click", () => { $("assetDetailModal").hidden = true; });
$("assetDetailModal")?.addEventListener("click", event => {
});


let transferAssets = [];
let transferSectors = [];
let transferPeople = [];
let transferPlaces = [];
let transferFloors = [];
let transferUnits = [];

function sectorLocationLabel(sector) {
  if (!sector) return "Setor não cadastrado";
  const localId = String(sector.ID_Local_Atual ?? sector.ID_Local_Referencia ?? "");
  const place = transferPlaces.find(x => String(x.ID_Local) === localId);
  const floor = transferFloors.find(x => String(x.ID_Andar) === String(place?.ID_Andar ?? ""));
  const unit = transferUnits.find(x => String(x.ID_Unidade) === String(place?.ID_Unidade ?? floor?.ID_Unidade ?? ""));
  if (!place || !floor || !unit) return `${sector.Nome_Setor || sector.ID_Setor} — localização incompleta`;
  return `${unit.Nome_Unidade} — ${floor.Nome_Andar} — ${place.Nome_Local_Fisico}`;
}

async function loadTransferView() {
  const [assets, sectors, people, places, floors, units] = await Promise.all([
    getCollectionRows("bens"), getCollectionRows("setores"), getCollectionRows("responsaveis"),
    getCollectionRows("locais"), getCollectionRows("andares"), getCollectionRows("unidades")
  ]);
  transferAssets = assets.filter(a => a.Situacao !== "Baixado");
  transferSectors = sectors.filter(x => x.Ativo !== false && x.Ativo !== "Não");
  transferPeople = people.filter(x => x.Ativo !== false && x.Ativo !== "Não");
  transferPlaces = places; transferFloors = floors; transferUnits = units;
  const assetSelect = $("transferAsset");
  assetSelect.replaceChildren(new Option("Selecione um bem", ""));
  for (const a of transferAssets) assetSelect.add(new Option(`${a.Tombamento} — ${a.Descricao_Bem}`, String(a.Tombamento)));
  const sectorSelect = $("transferSector");
  sectorSelect.replaceChildren(new Option("Selecione o setor de destino", ""));
  for (const sec of transferSectors) sectorSelect.add(new Option(`${sec.Nome_Setor} — ${sectorLocationLabel(sec)}`, sec.ID_Setor));
  updateTransferOrigin();
  updateTransferDestination();
}

function updateTransferOrigin() {
  const a = transferAssets.find(x => String(x.Tombamento) === $("transferAsset").value);
  const sec = transferSectors.find(x => String(x.ID_Setor) === String(a?.ID_Setor ?? ""));
  const box = $("transferOrigin");
  box.replaceChildren();
  const title = document.createElement("strong"); title.textContent = "Origem atual";
  const p = document.createElement("p");
  p.textContent = a ? `${sec?.Nome_Setor || "Setor não cadastrado"} — ${sectorLocationLabel(sec)} · Responsável: ${transferPeople.find(x => String(x.ID_Responsavel) === String(a.ID_Responsavel))?.Nome_Completo || "Não informado"}` : "Selecione um bem para consultar a origem.";
  box.append(title,p);
}

function updateTransferDestination() {
  const sec = transferSectors.find(x => String(x.ID_Setor) === $("transferSector").value);
  const box = $("transferDestination");
  box.replaceChildren();
  const title = document.createElement("strong"); title.textContent = "Destino";
  const p = document.createElement("p"); p.textContent = sec ? `${sec.Nome_Setor} — ${sectorLocationLabel(sec)}` : "Selecione um setor para consultar sua localização.";
  box.append(title,p);
}

$("transferAsset")?.addEventListener("change", updateTransferOrigin);
$("transferSector")?.addEventListener("change", updateTransferDestination);
let pendingTransfer = null;

function reviewItem(label, value, wide = false) {
  const item = document.createElement("div");
  item.className = `transfer-review-item${wide ? " transfer-review-wide" : ""}`;
  const labelEl = document.createElement("span");
  labelEl.className = "transfer-review-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("strong");
  valueEl.textContent = value || "Não informado";
  item.append(labelEl, valueEl);
  return item;
}

function showTransferReview(data) {
  const card = $("transferReviewCard");
  const content = $("transferReviewContent");
  content.replaceChildren();
  const fromSector = transferSectors.find(x => String(x.ID_Setor) === String(data.asset.ID_Setor));
  const currentResponsible = transferPeople.find(x => String(x.ID_Responsavel) === String(data.asset.ID_Responsavel));
  content.append(
    reviewItem("Tombamento", data.asset.Tombamento),
    reviewItem("Descrição do bem", data.asset.Descricao_Bem),
    reviewItem("Setor de origem", fromSector?.Nome_Setor || data.asset.ID_Setor),
    reviewItem("Localização de origem", sectorLocationLabel(fromSector), true),
    reviewItem("Setor de destino", data.destinationSector.Nome_Setor),
    reviewItem("Localização de destino", sectorLocationLabel(data.destinationSector), true),
    reviewItem("Responsável atual", currentResponsible?.Nome_Completo),
    reviewItem("Responsável no destino", data.destinationResponsible?.Nome_Completo || "Não informado"),
    reviewItem("Motivo", data.reason),
    reviewItem("Observações", data.notes || "Nenhuma observação", true)
  );
  card.hidden = false;
  $("finalConfirmTransferBtn").focus();
  card.scrollIntoView({behavior:"smooth",block:"center"});
}

$("transferForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const asset = transferAssets.find(x => String(x.Tombamento) === $("transferAsset").value);
  const destinationSector = transferSectors.find(x => String(x.ID_Setor) === $("transferSector").value);
  const reason = $("transferReason").value;
  const notes = $("transferNotes").value.trim();
  if (!asset || !destinationSector || !reason) {
    setMessage("transferMessage","Informe o bem, o setor de destino e o motivo.","error"); return;
  }
  if (String(asset.ID_Setor) === String(destinationSector.ID_Setor)) {
    setMessage("transferMessage","O setor de destino é igual ao setor atual. Escolha outro setor.","error"); return;
  }
  const currentSector = transferSectors.find(x => String(x.ID_Setor) === String(asset.ID_Setor));
  const currentPerson = transferPeople.find(x => String(x.ID_Responsavel) === String(asset.ID_Responsavel));
  const destinationPeople = transferPeople.filter(x => String(x.ID_Setor_Vinculo ?? "") === String(destinationSector.ID_Setor));
  const destinationResponsible = destinationPeople[0] || currentPerson || null;
  pendingTransfer = {
    asset: {...asset, _origemNome: currentSector?.Nome_Setor ?? asset.ID_Setor},
    destinationSector, destinationResponsible, reason, notes, user: currentUser
  };
  showTransferReview(pendingTransfer);
  setMessage("transferMessage","Confira os dados no cartão de revisão. A transferência ainda não foi realizada.");
});

$("editTransferBtn")?.addEventListener("click", () => {
  pendingTransfer = null;
  $("transferReviewCard").hidden = true;
  $("transferMessage").textContent = "Você pode corrigir os dados antes de confirmar.";
  $("transferForm").scrollIntoView({behavior:"smooth",block:"start"});
});

$("finalConfirmTransferBtn")?.addEventListener("click", async () => {
  if (!pendingTransfer) return;
  const btn = $("finalConfirmTransferBtn");
  btn.disabled = true;
  $("editTransferBtn").disabled = true;
  setMessage("transferMessage","Registrando transferência...");
  try {
    await recordAssetTransfer(pendingTransfer);
    pendingTransfer = null;
    $("transferReviewCard").hidden = true;
    $("transferForm").reset();
    setMessage("transferMessage","Transferência registrada. O setor do bem foi atualizado e o histórico foi gravado.","success");
    await loadTransferView();
    await refreshDashboard();
    await searchAssets();
  } catch (error) {
    setMessage("transferMessage",`Não foi possível concluir a transferência: ${error.message}`,"error");
  } finally {
    btn.disabled = false;
    $("editTransferBtn").disabled = false;
  }
});



let disposalAssets = [];
let pendingDisposal = null;

async function loadDisposalView() {
  if (currentProfile?.perfil !== "ADM") throw new Error("Somente ADM pode registrar baixa patrimonial.");
  disposalAssets = (await getCollectionRows("bens")).filter(a => a.Situacao !== "Baixado");
  const select = $("disposalAsset");
  select.replaceChildren(new Option("Selecione um bem", ""));
  for (const asset of disposalAssets) select.add(new Option(`${asset.Tombamento} — ${asset.Descricao_Bem}`, String(asset.Tombamento)));
  updateDisposalAssetSummary();
}

function updateDisposalAssetSummary() {
  const asset = disposalAssets.find(a => String(a.Tombamento) === $("disposalAsset").value);
  const box = $("disposalAssetSummary"); box.replaceChildren();
  const strong = document.createElement("strong"); strong.textContent = "Bem selecionado";
  const p = document.createElement("p");
  p.textContent = asset ? `${asset.Tombamento} — ${asset.Descricao_Bem} · Situação atual: ${asset.Situacao || "Não informada"}` : "Selecione um bem para consultar seus dados.";
  box.append(strong,p);
}

$("disposalAsset")?.addEventListener("change", updateDisposalAssetSummary);
$("disposalForm")?.addEventListener("submit", event => {
  event.preventDefault();
  if (currentProfile?.perfil !== "ADM") {
    setMessage("disposalMessage","Somente ADM pode registrar baixa patrimonial.","error"); return;
  }
  const asset = disposalAssets.find(a => String(a.Tombamento) === $("disposalAsset").value);
  const reason = $("disposalReason").value;
  if (!asset || !reason) {
    setMessage("disposalMessage","Selecione um bem e informe o motivo da baixa.","error"); return;
  }
  pendingDisposal = {
    asset, reason,
    documentNumber: $("disposalDocument").value.trim(),
    notes: $("disposalNotes").value.trim(),
    user: currentUser
  };
  const content = $("disposalReviewContent"); content.replaceChildren();
  const items = [
    ["Tombamento", asset.Tombamento],
    ["Descrição", asset.Descricao_Bem],
    ["Situação atual", asset.Situacao],
    ["Nova situação", "Baixado"],
    ["Motivo", reason],
    ["Documento / processo", pendingDisposal.documentNumber || "Não informado"],
    ["Observações", pendingDisposal.notes || "Nenhuma observação"]
  ];
  for (const [label,value] of items) content.append(reviewItem(label,value,label==="Observações"));
  $("disposalReviewCard").hidden = false;
  $("disposalReviewCard").scrollIntoView({behavior:"smooth",block:"center"});
  setMessage("disposalMessage","Confira os dados no cartão. A baixa ainda não foi registrada.");
});

$("editDisposalBtn")?.addEventListener("click", () => {
  pendingDisposal = null; $("disposalReviewCard").hidden = true;
  setMessage("disposalMessage","Você pode corrigir os dados antes de confirmar.");
});

$("confirmDisposalBtn")?.addEventListener("click", async () => {
  if (!pendingDisposal || currentProfile?.perfil !== "ADM") return;
  const btn=$("confirmDisposalBtn"); btn.disabled=true; $("editDisposalBtn").disabled=true;
  setMessage("disposalMessage","Registrando baixa patrimonial...");
  try {
    await recordAssetDisposal(pendingDisposal);
    pendingDisposal=null; $("disposalReviewCard").hidden=true; $("disposalForm").reset();
    setMessage("disposalMessage","Baixa registrada. O bem permanece no cadastro com situação Baixado.","success");
    await loadDisposalView(); await refreshDashboard(); await searchAssets();
  } catch(error) {
    setMessage("disposalMessage",`Não foi possível registrar a baixa: ${error.message}`,"error");
  } finally {btn.disabled=false;$("editDisposalBtn").disabled=false;}
});


const referenceConfigs = {
  categorias: {label:"Categoria", collection:"categorias", id:"ID_Categoria", prefix:"CAT", fields:[
    {key:"Nome_Categoria",label:"Nome da categoria",required:true},
    {key:"Descricao",label:"Descrição",type:"textarea"},
    {key:"Ativa",label:"Ativa",type:"select",options:["Sim","Não"],default:"Sim"}
  ]},
  unidades: {label:"Unidade / edifício",collection:"unidades",id:"ID_Unidade",prefix:"UNI",fields:[
    {key:"Nome_Unidade",label:"Nome da unidade",required:true},
    {key:"Descricao",label:"Descrição",type:"textarea"},
    {key:"Ativa",label:"Ativa",type:"select",options:["Sim","Não"],default:"Sim"}
  ]},
  andares: {label:"Andar",collection:"andares",id:"ID_Andar",prefix:"AND",fields:[
    {key:"ID_Unidade",label:"Unidade",type:"selectData",source:"unidades",sourceId:"ID_Unidade",sourceLabel:"Nome_Unidade",required:true},
    {key:"Nome_Andar",label:"Nome do andar",required:true},
    {key:"Ativo",label:"Ativo",type:"select",options:["Sim","Não"],default:"Sim"}
  ]},
  locais: {label:"Local físico",collection:"locais",id:"ID_Local",prefix:"LOC",fields:[
    {key:"ID_Unidade",label:"Unidade",type:"selectData",source:"unidades",sourceId:"ID_Unidade",sourceLabel:"Nome_Unidade",required:true},
    {key:"ID_Andar",label:"Andar",type:"selectData",source:"andares",sourceId:"ID_Andar",sourceLabel:"Nome_Andar",required:true,filterBy:"ID_Unidade"},
    {key:"Nome_Local_Fisico",label:"Sala / local físico",required:true},
    {key:"Ativo",label:"Ativo",type:"select",options:["Sim","Não"],default:"Sim"}
  ]},
  setores: {label:"Setor",collection:"setores",id:"ID_Setor",prefix:"SET",fields:[
    {key:"Nome_Setor",label:"Nome do setor",required:true},
    {key:"ID_Local_Atual",label:"Local físico atual",type:"selectData",source:"locais",sourceId:"ID_Local",sourceLabel:"Descricao_Local",required:true},
    {key:"Ativo",label:"Ativo",type:"select",options:["Sim","Não"],default:"Sim"}
  ]},
  responsaveis: {label:"Responsável",collection:"responsaveis",id:"ID_Responsavel",prefix:"RESP",fields:[
    {key:"Nome_Completo",label:"Nome completo",required:true},
    {key:"ID_Setor_Vinculo",label:"Setor vinculado",type:"selectData",source:"setores",sourceId:"ID_Setor",sourceLabel:"Nome_Setor",required:true},
    {key:"Email_Ficticio",label:"E-mail",type:"email"},
    {key:"Responsavel_Oficial_Setor",label:"Responsável oficial do setor",type:"select",options:["Sim","Não"],default:"Não"},
    {key:"Ativo",label:"Ativo",type:"select",options:["Sim","Não"],default:"Sim"}
  ]}
};
let referenceRows = [];
let referenceEditingId = null;
let referenceEditing = false;
let referenceRelated = {};

async function loadReferenceView() {
  if (currentProfile?.perfil !== "ADM") throw new Error("Somente ADM pode gerenciar cadastros básicos.");
  await renderReferenceRows();
}
async function renderReferenceRows() {
  const type=$("referenceType").value, cfg=referenceConfigs[type];
  referenceRows=await getCollectionRows(cfg.collection);
  const head=$("referenceTableHead"), body=$("referenceTableBody");
  head.replaceChildren(); body.replaceChildren();
  const cols=[cfg.id,...cfg.fields.slice(0,3).map(f=>f.key),"__actions"];
  const trh=document.createElement("tr");
  for(const key of cols){const th=document.createElement("th");th.textContent=key==="__actions"?"Ações":key;trh.append(th);}
  head.append(trh);
  for(const row of referenceRows){
    const tr=document.createElement("tr");
    for(const key of cols){
      const td=document.createElement("td");
      if(key==="__actions"){
        const btn=document.createElement("button");btn.type="button";btn.className="button button-secondary button-small";btn.textContent="Editar";
        btn.addEventListener("click",()=>openReferenceForm(row));td.append(btn);
      }else td.textContent=String(row[key]??"");
      tr.append(td);
    }
    body.append(tr);
  }
  setMessage("referenceMessage",`${referenceRows.length} registro(s) em ${cfg.label.toLocaleLowerCase("pt-BR")}.`);
}
async function openReferenceForm(row=null) {
  if(currentProfile?.perfil!=="ADM") return;
  const type=$("referenceType").value,cfg=referenceConfigs[type];
  referenceEditingId=row?.[cfg.id]??null; referenceEditing=Boolean(row);
  $("referenceFormTitle").textContent=row?`Editar ${cfg.label.toLocaleLowerCase("pt-BR")}`:`Novo cadastro — ${cfg.label.toLocaleLowerCase("pt-BR")}`;
  const fields=$("referenceFields");fields.replaceChildren();
  referenceRelated={};
  for(const field of cfg.fields){
    const wrap=document.createElement("div");wrap.className="reference-field";
    const label=document.createElement("label");label.textContent=field.label;label.htmlFor=`ref_${field.key}`;wrap.append(label);
    let input;
    if(field.type==="textarea") input=document.createElement("textarea");
    else if(field.type==="select"||field.type==="selectData"){
      input=document.createElement("select");input.add(new Option("Selecione", ""));
      if(field.type==="select") for(const opt of field.options) input.add(new Option(opt,opt));
      else {
        const rows=await getCollectionRows(field.source);referenceRelated[field.source]=rows;
        for(const option of rows){
          const labelText=field.sourceLabel==="Descricao_Local" ? (option.Descricao_Local||`${option.Nome_Unidade||""} — ${option.Nome_Local_Fisico||""}`) : (option[field.sourceLabel]||option[field.sourceId]);
          input.add(new Option(labelText,option[field.sourceId]));
        }
      }
    } else {input=document.createElement("input");input.type=field.type==="email"?"email":"text";}
    input.id=`ref_${field.key}`;input.name=field.key;input.required=Boolean(field.required);
    input.value=row?.[field.key]??field.default??"";
    if(field.filterBy && row?.ID_Unidade){
      for(const opt of [...input.options]) if(opt.value){
        const match=(referenceRelated[field.source]||[]).find(x=>String(x[field.sourceId])===String(opt.value));
        if(match && String(match[field.filterBy])!==String(row.ID_Unidade)) opt.hidden=true;
      }
    }
    wrap.append(input);fields.append(wrap);
  }
  $("referenceFormCard").hidden=false;
  $("referenceFormCard").scrollIntoView({behavior:"smooth",block:"center"});
}
$("referenceType")?.addEventListener("change",()=>{ $("referenceFormCard").hidden=true; renderReferenceRows().catch(e=>setMessage("referenceMessage",e.message,"error")); });
$("newReferenceBtn")?.addEventListener("click",()=>openReferenceForm().catch(e=>setMessage("referenceMessage",e.message,"error")));
$("cancelReferenceBtn")?.addEventListener("click",()=>{$("referenceFormCard").hidden=true;referenceEditingId=null;});
$("referenceForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  if(currentProfile?.perfil!=="ADM"){setMessage("referenceMessage","Somente ADM pode salvar cadastros.","error");return;}
  const type=$("referenceType").value,cfg=referenceConfigs[type],data={};
  for(const field of cfg.fields){
    const value=$(`ref_${field.key}`).value.trim();
    if(field.required&&!value){setMessage("referenceMessage",`Preencha: ${field.label}.`,"error");return;}
    data[field.key]=value;
  }
  // Campos derivados de localização, para consultas legadas e relatórios.
  if(type==="locais"){
    const unit=referenceRelated.unidades?.find(x=>String(x.ID_Unidade)===data.ID_Unidade);
    const floor=referenceRelated.andares?.find(x=>String(x.ID_Andar)===data.ID_Andar);
    data.Nome_Unidade=unit?.Nome_Unidade??"";
    data.Nome_Andar=floor?.Nome_Andar??"";
    data.Descricao_Local=`${data.Nome_Unidade} — ${data.Nome_Andar} — ${data.Nome_Local_Fisico}`;
  }
  if(type==="andares"){
    const unit=referenceRelated.unidades?.find(x=>String(x.ID_Unidade)===data.ID_Unidade);
    data.Nome_Unidade=unit?.Nome_Unidade??"";
  }
  const creating=!referenceEditing;
  const id=referenceEditingId || `${cfg.prefix}${String(Date.now()).slice(-8)}`;
  try{
    await saveReferenceRecord(cfg.collection,id,{...data,[cfg.id]:id},creating);
    $("referenceFormCard").hidden=true;referenceEditingId=null;
    await renderReferenceRows();
    setMessage("referenceMessage",`${cfg.label} salvo com sucesso.`,"success");
  }catch(error){setMessage("referenceMessage",`Não foi possível salvar: ${error.message}`,"error");}
});


let assetFormMode = "create";
let assetFormOriginal = null;
let assetFormReferences = {categories:[],sectors:[],people:[],places:[],floors:[],units:[]};

function parseCurrencyInput(value) {
  const normalized=String(value??"").trim().replace(/\./g,"").replace(",",".");
  if(!normalized) return "";
  const n=Number(normalized);
  if(!Number.isFinite(n)||n<0) throw new Error("Informe um valor de aquisição válido.");
  return Math.round(n*100)/100;
}
function formatCurrencyInput(value) {
  if(value===null||value===undefined||value==="") return "";
  return Number(value).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function showDuplicateTombamentoAction(tombamento) {
  const message = $("assetFormMessage");
  if (!message) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-secondary";
  button.textContent = "Consultar bem existente";
  button.style.marginTop = ".5rem";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      // A ficha é aberta como modal sobre o formulário; os valores digitados permanecem no DOM.
      await openAssetDetail(tombamento);
    } finally {
      button.disabled = false;
    }
  });
  message.append(document.createTextNode(" "));
  message.append(button);
}
function getSectorLocation(sector) {
  if(!sector) return "Localização não cadastrada.";
  const place=assetFormReferences.places.find(x=>String(x.ID_Local)===String(sector.ID_Local_Atual??sector.ID_Local_Referencia??""));
  const floor=assetFormReferences.floors.find(x=>String(x.ID_Andar)===String(place?.ID_Andar??""));
  const unit=assetFormReferences.units.find(x=>String(x.ID_Unidade)===String(place?.ID_Unidade??floor?.ID_Unidade??""));
  return place&&floor&&unit ? `${unit.Nome_Unidade} — ${floor.Nome_Andar} — ${place.Nome_Local_Fisico}` : "Localização incompleta: revise o vínculo do setor.";
}
async function loadAssetFormReferences() {
  const [categories,sectors,people,places,floors,units]=await Promise.all([
    getCollectionRows("categorias"),getCollectionRows("setores"),getCollectionRows("responsaveis"),
    getCollectionRows("locais"),getCollectionRows("andares"),getCollectionRows("unidades")
  ]);
  assetFormReferences={categories,sectors,people,places,floors,units};
  fillAssetSelect("newAssetCategory",categories,"ID_Categoria","Nome_Categoria");
  fillAssetSelect("newAssetSector",sectors.filter(x=>x.Ativo!=="Não"&&x.Ativo!==false),"ID_Setor","Nome_Setor");
  fillAssetSelect("newAssetResponsible",people.filter(x=>x.Ativo!=="Não"&&x.Ativo!==false),"ID_Responsavel","Nome_Completo");
  updateAssetLocationPreview();
}
function fillAssetSelect(id,rows,valueKey,labelKey) {
  const select=$(id), previous=select.value;
  select.replaceChildren(new Option("Selecione",""));
  for(const row of rows) select.add(new Option(row[labelKey]||row[valueKey],String(row[valueKey])));
  if([...select.options].some(o=>o.value===previous)) select.value=previous;
}
function updateAssetLocationPreview() {
  const sector=assetFormReferences.sectors.find(x=>String(x.ID_Setor)===$("newAssetSector").value);
  $("newAssetLocationPreview").textContent=getSectorLocation(sector);
  const allowed=assetFormReferences.people.filter(p=>String(p.ID_Setor_Vinculo??"")===String(sector?.ID_Setor??"")&&(p.Ativo!=="Não"&&p.Ativo!==false));
  const current=$("newAssetResponsible").value;
  if(sector && allowed.length) {
    fillAssetSelect("newAssetResponsible",allowed,"ID_Responsavel","Nome_Completo");
    if(allowed.some(p=>String(p.ID_Responsavel)===current)) $("newAssetResponsible").value=current;
  } else {
    fillAssetSelect("newAssetResponsible",assetFormReferences.people.filter(p=>p.Ativo!=="Não"&&p.Ativo!==false),"ID_Responsavel","Nome_Completo");
    if(current) $("newAssetResponsible").value=current;
  }
}
async function openAssetForm(tombamento=null) {
  await loadAssetFormReferences();
  const existing=tombamento===null?null:(await getCollectionRows("bens")).find(a=>String(a.Tombamento)===String(tombamento));
  assetFormMode=existing?"edit":"create"; assetFormOriginal=existing;
  $("assetForm").reset();
  $("assetEditingTombamento").value=existing?.Tombamento??"";
  $("newAssetTombamento").value=existing?.Tombamento??"";
  $("newAssetTombamento").readOnly=Boolean(existing);
  $("newAssetDescription").value=existing?.Descricao_Bem??"";
  $("newAssetCategory").value=existing?.ID_Categoria??"";
  $("newAssetStatus").value=existing?.Situacao??"Ativo";
  $("newAssetBrand").value=existing?.Marca??"";
  $("newAssetModel").value=existing?.Modelo??"";
  $("newAssetSerial").value=existing?.Numero_Serie??"";
  $("newAssetSector").value=existing?.ID_Setor??"";
  updateAssetLocationPreview();
  $("newAssetResponsible").value=existing?.ID_Responsavel??"";
  $("newAssetAcquisitionDate").value=existing?.Data_Aquisicao??"";
  $("newAssetAcquisitionValue").value=formatCurrencyInput(existing?.Valor_Aquisicao);
  $("newAssetNotes").value=existing?.Observacoes??"";
  $("assetFormTitle").textContent=existing?"Editar bem patrimonial":"Cadastrar bem patrimonial";
  $("saveAssetBtn").textContent=existing?"Salvar alterações":"Salvar bem";
  $("cancelAssetEditBtn").hidden=!existing;
  activateView("assetFormView");
}
$("newAssetSector")?.addEventListener("change",updateAssetLocationPreview);
$("cancelAssetEditBtn")?.addEventListener("click",()=>{assetFormOriginal=null;assetFormMode="create";$("assetForm").reset();$("newAssetTombamento").readOnly=false;$("assetFormTitle").textContent="Cadastrar bem patrimonial";$("saveAssetBtn").textContent="Salvar bem";$("cancelAssetEditBtn").hidden=true;setMessage("assetFormMessage","Edição cancelada.");});
$("assetForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const creating=assetFormMode==="create";
  const tombamento=$("newAssetTombamento").value.trim();
  const description=$("newAssetDescription").value.trim();
  const category=$("newAssetCategory").value;
  const sectorId=$("newAssetSector").value;
  const responsible=$("newAssetResponsible").value;
  if(!tombamento||!description||!category||!sectorId||!responsible){setMessage("assetFormMessage","Preencha tombamento, descrição, categoria, setor e responsável.","error");return;}
  const sector=assetFormReferences.sectors.find(x=>String(x.ID_Setor)===sectorId);
  const location=getSectorLocation(sector);
  if(location.startsWith("Localização incompleta")||location.startsWith("Localização não cadastrada")){setMessage("assetFormMessage","O setor selecionado não possui localização completa. Corrija o cadastro do setor antes de salvar o bem.","error");return;}
  const value=parseCurrencyInput($("newAssetAcquisitionValue").value);
  const asset={
    Tombamento:tombamento, Descricao_Bem:description, ID_Categoria:category,
    ID_Setor:sectorId, ID_Responsavel:responsible,
    Situacao:creating?"Ativo":(assetFormOriginal?.Situacao??"Ativo"),
    Marca:$("newAssetBrand").value.trim(), Modelo:$("newAssetModel").value.trim(),
    Numero_Serie:$("newAssetSerial").value.trim(), Data_Aquisicao:$("newAssetAcquisitionDate").value,
    Valor_Aquisicao:value, Observacoes:$("newAssetNotes").value.trim()
  };
  // Cadastro novo usa confirmações em cards dentro da página, nunca diálogos nativos.
  if (creating) {
    try {
      const bensAtuais = await getCollectionRows("bens");
      const duplicado = bensAtuais.find(item => String(item.Tombamento ?? "").trim() === tombamento);
      if (duplicado) {
        setMessage("assetFormMessage", `O tombamento ${tombamento} já está cadastrado. Consulte o bem existente antes de continuar.`, "error");
        showDuplicateTombamentoAction(tombamento);
        return;
      }
    } catch (error) {
      setMessage("assetFormMessage", `Não foi possível verificar o tombamento: ${error.message}. Tente novamente.`, "error");
      return;
    }
    pendingAssetConfirmation = { asset, tombamento, creating, step: 1 };
    showTombamentoConfirmation(1, tombamento);
    return;
  }
  await persistAsset(asset, creating, tombamento);

});


let pendingAssetConfirmation = null;
function showTombamentoConfirmation(step, tombamento) {
  const card = $("tombamentoConfirmationCard");
  if (!card) return;
  pendingAssetConfirmation = { ...pendingAssetConfirmation, step, tombamento };
  card.classList.toggle("tombamento-confirmation-final", step === 2);
  $("tombamentoConfirmationTitle").textContent = step === 1
    ? "1ª confirmação — Conferência do tombamento"
    : "Verificação final de segurança";
  $("tombamentoConfirmationNumber").textContent = tombamento;
  $("tombamentoConfirmationText").textContent = step === 1
    ? "Compare o número completo com a etiqueta física do bem ou com a documentação patrimonial. Confirme somente se todos os dígitos corresponderem exatamente."
    : "Esta é a segunda verificação de segurança, não um aviso de erro. Revise novamente todos os dígitos, da esquerda para a direita, e confirme que o número corresponde exatamente ao bem que está sendo cadastrado.";
  $("tombamentoConfirmationStep").textContent = step === 1 ? "ETAPA 1 DE 2" : "ETAPA 2 DE 2 · CONFERÊNCIA FINAL";
  $("confirmTombamentoNextBtn").textContent = step === 1 ? "Confirmo a conferência" : "Confirmar segunda verificação";
  card.hidden = false;
  // Mantém o formulário visível e preserva todos os valores; para editar, o usuário cancela a confirmação.
  document.querySelectorAll("#assetForm input:not([type=hidden]), #assetForm select, #assetForm textarea, #saveAssetBtn").forEach(el => { el.disabled = true; });
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}
function hideTombamentoConfirmation() {
  const card = $("tombamentoConfirmationCard");
  if (card) card.hidden = true;
  document.querySelectorAll("#assetForm input, #assetForm select, #assetForm textarea, #saveAssetBtn").forEach(el => { el.disabled = false; });
  pendingAssetConfirmation = null;
}
$("cancelTombamentoConfirmationBtn")?.addEventListener("click", () => {
  hideTombamentoConfirmation();
  setMessage("assetFormMessage", "Confirmação cancelada. Nenhum dado foi gravado; o formulário foi preservado.", "error");
});
$("confirmTombamentoNextBtn")?.addEventListener("click", async () => {
  if (!pendingAssetConfirmation) return;
  const { asset, tombamento, creating, step } = pendingAssetConfirmation;
  const nextButton = $("confirmTombamentoNextBtn");
  nextButton.disabled = true;
  try {
    const bensAtuais = await getCollectionRows("bens");
    const duplicado = bensAtuais.find(item => String(item.Tombamento ?? "").trim() === tombamento);
    if (duplicado) {
      hideTombamentoConfirmation();
      setMessage("assetFormMessage", `O tombamento ${tombamento} já está cadastrado. Consulte o bem existente antes de continuar.`, "error");
      showDuplicateTombamentoAction(tombamento);
      return;
    }
    if (step === 1) {
      showTombamentoConfirmation(2, tombamento);
      return;
    }
    hideTombamentoConfirmation();
    await persistAsset(asset, creating, tombamento);
  } catch (error) {
    hideTombamentoConfirmation();
    setMessage("assetFormMessage", `Não foi possível confirmar a disponibilidade do tombamento: ${error.message}. Revise e tente novamente.`, "error");
  } finally {
    nextButton.disabled = false;
  }
});
async function persistAsset(asset, creating, tombamento) {
  const btn = $("saveAssetBtn");
  btn.disabled = true;
  setMessage("assetFormMessage", creating ? "Cadastrando bem..." : "Salvando alterações...");
  try {
    await saveAssetRecord({ asset, originalTombamento: assetFormOriginal?.Tombamento, creating, user: currentUser });
    setMessage("assetFormMessage", creating ? "Bem cadastrado com situação Ativo." : "Cadastro atualizado; histórico de auditoria registrado.", "success");
    await refreshDashboard();
    await searchAssets();
    if (creating) {
      $("assetForm").reset();
      $("newAssetTombamento").readOnly = false;
      $("newAssetStatus").value = "Ativo";
      $("newAssetLocationPreview").textContent = "Selecione um setor para consultar a localização.";
    } else {
      assetFormOriginal = { ...assetFormOriginal, ...asset };
    }
  } catch (error) {
    setMessage("assetFormMessage", `Não foi possível salvar: ${error.message}`, "error");
    if (creating && /já existe um bem com esse tombamento/i.test(error.message)) showDuplicateTombamentoAction(tombamento);
  } finally {
    btn.disabled = false;
  }
}


let sectorLocationData = {sectors:[],places:[],floors:[],units:[],assets:[]};
let pendingSectorLocation = null;

function buildPlaceLabel(place) {
  const floor=sectorLocationData.floors.find(x=>String(x.ID_Andar)===String(place.ID_Andar));
  const unit=sectorLocationData.units.find(x=>String(x.ID_Unidade)===String(place.ID_Unidade??floor?.ID_Unidade));
  return `${unit?.Nome_Unidade??"Unidade não informada"} — ${floor?.Nome_Andar??"Andar não informado"} — ${place.Nome_Local_Fisico??place.ID_Local}`;
}
async function loadSectorLocationView() {
  if(currentProfile?.perfil!=="ADM") throw new Error("Somente ADM pode alterar a localização de setores.");
  const [sectors,places,floors,units,assets]=await Promise.all([
    getCollectionRows("setores"),getCollectionRows("locais"),getCollectionRows("andares"),getCollectionRows("unidades"),getCollectionRows("bens")
  ]);
  sectorLocationData={sectors,places,floors,units,assets};
  const sel=$("locationSectorSelect");sel.replaceChildren(new Option("Selecione um setor",""));
  for(const sector of sectors) sel.add(new Option(sector.Nome_Setor,sector.ID_Setor));
  const unitSel=$("locationUnitSelect");unitSel.replaceChildren(new Option("Selecione",""));
  for(const unit of units) unitSel.add(new Option(unit.Nome_Unidade,unit.ID_Unidade));
  updateSectorLocationCurrent();
  updateSectorLocationFloors();
  updateSectorLocationPlaces();
}
function updateSectorLocationCurrent() {
  const sector=sectorLocationData.sectors.find(x=>String(x.ID_Setor)===$("locationSectorSelect").value);
  const place=sectorLocationData.places.find(x=>String(x.ID_Local)===String(sector?.ID_Local_Atual??sector?.ID_Local_Referencia??""));
  const box=$("sectorLocationCurrent");box.replaceChildren();
  const strong=document.createElement("strong");strong.textContent="Localização atual";
  const p=document.createElement("p");p.textContent=sector?`${sector.Nome_Setor} — ${place?buildPlaceLabel(place):"Localização não cadastrada"} · ${sectorLocationData.assets.filter(a=>String(a.ID_Setor)===String(sector.ID_Setor)).length} bem(ns) vinculado(s)`:"Selecione um setor.";
  box.append(strong,p);
  if(sector&&place){$("locationUnitSelect").value=String(place.ID_Unidade??sectorLocationData.floors.find(f=>String(f.ID_Andar)===String(place.ID_Andar))?.ID_Unidade??"");}
}
function updateSectorLocationFloors() {
  const unitId=$("locationUnitSelect").value;
  const sel=$("locationFloorSelect");sel.replaceChildren(new Option("Selecione um andar",""));
  for(const floor of sectorLocationData.floors.filter(x=>String(x.ID_Unidade)===String(unitId))) sel.add(new Option(floor.Nome_Andar,floor.ID_Andar));
  const sector=sectorLocationData.sectors.find(x=>String(x.ID_Setor)===$("locationSectorSelect").value);
  const place=sectorLocationData.places.find(x=>String(x.ID_Local)===String(sector?.ID_Local_Atual??sector?.ID_Local_Referencia??""));
  if(place&&String(place.ID_Unidade??sectorLocationData.floors.find(f=>String(f.ID_Andar)===String(place.ID_Andar))?.ID_Unidade)===String(unitId)) sel.value=String(place.ID_Andar);
}
function updateSectorLocationPlaces() {
  const floorId=$("locationFloorSelect").value,sel=$("locationPlaceSelect");
  sel.replaceChildren(new Option("Selecione uma sala",""));
  for(const place of sectorLocationData.places.filter(x=>String(x.ID_Andar)===String(floorId))) sel.add(new Option(place.Nome_Local_Fisico??place.ID_Local,place.ID_Local));
}
$("locationSectorSelect")?.addEventListener("change",()=>{updateSectorLocationCurrent();updateSectorLocationFloors();updateSectorLocationPlaces();});
$("locationUnitSelect")?.addEventListener("change",()=>{updateSectorLocationFloors();updateSectorLocationPlaces();});
$("locationFloorSelect")?.addEventListener("change",updateSectorLocationPlaces);
$("sectorLocationForm")?.addEventListener("submit",event=>{
  event.preventDefault();
  if(currentProfile?.perfil!=="ADM"){setMessage("sectorLocationMessage","Somente ADM pode alterar a localização.","error");return;}
  const sector=sectorLocationData.sectors.find(x=>String(x.ID_Setor)===$("locationSectorSelect").value);
  const destinationPlace=sectorLocationData.places.find(x=>String(x.ID_Local)===$("locationPlaceSelect").value);
  const reason=$("sectorLocationReason").value,notes=$("sectorLocationNotes").value.trim();
  if(!sector||!destinationPlace||!reason){setMessage("sectorLocationMessage","Selecione setor, destino e motivo.","error");return;}
  const currentId=String(sector.ID_Local_Atual??sector.ID_Local_Referencia??"");
  if(currentId===String(destinationPlace.ID_Local)){setMessage("sectorLocationMessage","O setor já está vinculado a esse local físico.","error");return;}
  const affectedAssets=sectorLocationData.assets.filter(a=>String(a.ID_Setor)===String(sector.ID_Setor));
  pendingSectorLocation={sector:{...sector,_origemDescricao:sectorLocationData.places.find(p=>String(p.ID_Local)===currentId)?buildPlaceLabel(sectorLocationData.places.find(p=>String(p.ID_Local)===currentId)):"Localização não cadastrada"},destinationPlace:{...destinationPlace,_descricaoCompleta:buildPlaceLabel(destinationPlace)},reason,notes,user:currentUser,affectedAssetCount:affectedAssets.length,affectedAssets};
  const content=$("sectorLocationReviewContent");content.replaceChildren();
  const items=[["Setor",sector.Nome_Setor],["Localização anterior",pendingSectorLocation.sector._origemDescricao],["Nova localização",buildPlaceLabel(destinationPlace)],["Bens afetados",String(pendingSectorLocation.affectedAssetCount)],["Motivo",reason],["Observações",notes||"Nenhuma observação"]];
  for(const [label,value] of items)content.append(reviewItem(label,value,label==="Observações"||label==="Nova localização"||label==="Localização anterior"));
  $("sectorLocationReview").hidden=false;$("sectorLocationReview").scrollIntoView({behavior:"smooth",block:"center"});
  setMessage("sectorLocationMessage","Confira a alteração no cartão. Nenhum bem foi atualizado individualmente.");
});
$("editSectorLocationBtn")?.addEventListener("click",()=>{pendingSectorLocation=null;$("sectorLocationReview").hidden=true;});
$("confirmSectorLocationBtn")?.addEventListener("click",async()=>{
  if(!pendingSectorLocation||currentProfile?.perfil!=="ADM")return;
  const btn=$("confirmSectorLocationBtn");btn.disabled=true;
  try{
    await changeSectorLocation(pendingSectorLocation);
    pendingSectorLocation=null;$("sectorLocationReview").hidden=true;$("sectorLocationForm").reset();
    setMessage("sectorLocationMessage","Localização do setor alterada. Os bens vinculados passam a exibir o novo local; a mudança foi registrada no histórico.","success");
    await loadSectorLocationView();await searchAssets();await refreshDashboard();
  }catch(error){setMessage("sectorLocationMessage",`Não foi possível alterar a localização: ${error.message}`,"error");}
  finally{btn.disabled=false;}
});

function renderImportResult(result) {
  const summary = $("importSummary");
  const errorsBox = $("importErrors");
  summary.hidden = false;
  errorsBox.hidden = result.errors.length === 0;
  summary.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = result.ok ? "Planilha validada" : "Validação não aprovada";
  summary.append(title);
  const list = document.createElement("ul");
  for (const [name, count] of Object.entries(result.counts || {})) {
    const li = document.createElement("li");
    li.textContent = `${name}: ${count} registro(s)`;
    list.append(li);
  }
  summary.append(list);
  errorsBox.replaceChildren();
  if (result.errors.length) {
    const heading = document.createElement("strong");
    heading.textContent = `Problemas encontrados (${result.errors.length})`;
    const errors = document.createElement("ul");
    result.errors.slice(0, 200).forEach(error => {
      const li = document.createElement("li");
      li.textContent = error;
      errors.append(li);
    });
    errorsBox.append(heading, errors);
  }
  importIsValid = result.ok;
  $("commitImportBtn").disabled = !result.ok || currentProfile?.perfil !== "ADM";
  setMessage("importMessage", result.ok
    ? (currentProfile?.perfil === "ADM" ? "A planilha passou nas validações. Revise o resumo e confirme a importação." : "A planilha passou nas validações, mas somente ADM pode confirmar a carga inicial.")
    : "Corrija os problemas indicados e valide novamente.", result.ok ? "success" : "error");
}

document.querySelectorAll(".nav-tab").forEach(button => button.addEventListener("click", async () => {
  activateView(button.dataset.view);
  if (button.dataset.view === "reportView") {
    try { await loadReportOptions(); await runGeneralReport(); }
    catch (error) { setMessage("reportMessage", `Não foi possível carregar o relatório: ${error.message}`, "error"); }
  }
  if (button.dataset.view === "assetsView") {
    try { await searchAssets(); }
    catch (error) { setMessage("assetsMessage", `Não foi possível carregar a consulta: ${error.message}`, "error"); }
  }
  if (button.dataset.view === "transferView") {
    try { await loadTransferView(); }
    catch (error) { setMessage("transferMessage", `Não foi possível carregar os dados para transferência: ${error.message}`, "error"); }
  }
  if (button.dataset.view === "disposalView") {
    try { await loadDisposalView(); }
    catch (error) { setMessage("disposalMessage", `Não foi possível carregar os bens: ${error.message}`, "error"); }
  }
  if (button.dataset.view === "referenceView") {
    try { await loadReferenceView(); }
    catch (error) { setMessage("referenceMessage", error.message, "error"); }
  }
  if (button.dataset.view === "assetFormView") {
    try { await openAssetForm(); }
    catch (error) { setMessage("assetFormMessage", error.message, "error"); }
  }
  if (button.dataset.view === "sectorLocationView") {
    try { await loadSectorLocationView(); }
    catch (error) { setMessage("sectorLocationMessage", error.message, "error"); }
  }
}));
// Relatório geral: listeners explícitos para atualizar e exportar.
$("runReportBtn").addEventListener("click", async () => {
  const button = $("runReportBtn");
  button.disabled = true;
  button.textContent = "Atualizando...";
  try { await runGeneralReport(); }
  finally { button.disabled = false; button.textContent = "Atualizar relatório"; }
});
$("exportReportExcel").addEventListener("click", exportGeneralReportExcel);
$("exportReportPdf").addEventListener("click", exportGeneralReportPdf);
["reportSearch","reportCategory","reportUnit","reportSector","reportResponsible","reportStatus","reportSort"].forEach(id => {
  const control = $(id);
  control.addEventListener(id === "reportSearch" ? "keydown" : "change", event => {
    if (id === "reportSearch" && event.key !== "Enter") return;
    if (id === "reportSearch") event.preventDefault();
    runGeneralReport();
  });
});

$("searchBtn").addEventListener("click", searchAssets);
$("assetSearch").addEventListener("keydown", event => { if (event.key === "Enter") searchAssets(); });
$("categoryFilter").addEventListener("change", searchAssets);
$("statusFilter").addEventListener("change", searchAssets);
$("sectorFilter").addEventListener("change", searchAssets);
$("responsibleFilter").addEventListener("change", searchAssets);

$("validateImportBtn").addEventListener("click", async () => {
  $("commitImportBtn").disabled = true;
  setMessage("importMessage", "Lendo e validando a planilha...");
  try {
    const result = await prepareWorkbook($("workbookFile").files[0]);
    renderImportResult(result);
  } catch (error) {
    renderImportResult({ ok: false, errors: [error.message || String(error)], counts: {} });
  }
});

$("commitImportBtn").addEventListener("click", async () => {
  if (!importIsValid || currentProfile?.perfil !== "ADM") return;
  $("commitImportBtn").disabled = true;
  setMessage("importMessage", "Salvando dados localmente. Não feche esta página...");
  try {
    await commitPreparedWorkbook(currentUser.uid);
    importIsValid = false;
    setMessage("importMessage", "Importação concluída. Confira os indicadores e a consulta dos bens.", "success");
    await refreshDashboard();
    await loadCategories();
  } catch (error) {
    setMessage("importMessage", `Importação não concluída: ${error.message}. Confira os dados locais antes de tentar novamente.`, "error");
  }
});

// Inicialização pública: não há autenticação nem conexão com banco remoto.
currentUser = { uid: "demo-local", email: "Demonstração local" };
currentProfile = { perfil: "ADM" };
showApp();
activateView("assetsView");
ensureDemoSeed().then(() => refreshDashboard()).then(async () => { await loadCategories(); await searchAssets(); }).catch(error => console.error("Falha ao carregar a demonstração local:", error));

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

const resetPhraseInput = $("resetPhrase");
const resetButton = $("resetTestDataBtn");
if (resetPhraseInput && resetButton) {
  const phrase = "APAGAR DADOS DE TESTE";
  const refreshResetButton = () => { resetButton.disabled = currentProfile?.perfil !== "ADM" || resetPhraseInput.value !== phrase; };
  resetPhraseInput.addEventListener("input", refreshResetButton);
  resetButton.addEventListener("click", async () => {
    if (currentProfile?.perfil !== "ADM" || resetPhraseInput.value !== phrase) return;
    resetButton.disabled = true;
    setMessage("resetMessage","Apagando cadastros locais...");
    try {
      await deleteTestMasterData();
      importIsValid = false;
      $("commitImportBtn").disabled = true;
      setMessage("resetMessage","Cadastros principais apagados do armazenamento deste navegador.","success");
      await refreshDashboard(); await loadCategories(); await searchAssets();
    } catch (error) {
      setMessage("resetMessage",`Não foi possível limpar os dados locais: ${error.message}`,"error");
    } finally { resetPhraseInput.value = ""; refreshResetButton(); }
  });
}
