export const REQUIRED_SHEETS = ["Bens","Categorias","Responsaveis","Setores","LocaisFisicos","Andares","Unidades"];
export const REQUIRED_COLUMNS = {
 Bens:["Tombamento","Descricao_Bem","ID_Categoria","ID_Setor","ID_Responsavel","Situacao"],
 Categorias:["ID_Categoria","Nome_Categoria","Ativa"],
 Responsaveis:["ID_Responsavel","Nome_Completo","ID_Setor_Vinculo","Ativo"],
 Setores:["ID_Setor","Nome_Setor","ID_Local_Atual","Ativo"],
 LocaisFisicos:["ID_Local","ID_Unidade","ID_Andar","Nome_Local_Fisico","Ativo"],
 Andares:["ID_Andar","ID_Unidade","Nome_Andar","Ativo"],
 Unidades:["ID_Unidade","Nome_Unidade","Ativa"]
};
