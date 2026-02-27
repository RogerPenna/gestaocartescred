# Gestão de Cartões de Crédito - Grist Custom Widget

Widget customizado para o Grist para gestão de gastos de cartões de crédito com limite global compartilhado.

## Funcionalidades
- **Gráfico de Pizza**: Ocupação do limite global por cartão vs limite disponível.
- **Gráfico de Barras**: Projeção de faturas para os próximos 6 meses.
- **Filtro**: Seleção dinâmica por cartão.

## Como usar no Grist
1. Publique este repositório no **GitHub Pages**.
2. No Grist, adicione um **Custom Widget**.
3. Use a URL gerada pelo GitHub Pages (ex: `https://seu-usuario.github.io/gestaocartoescred/`).

## Configuração de Colunas
Mapeie as seguintes colunas da tabela `Lancamentos`:
- `Cartao` (Reference)
- `Valor_Parcela` (Numeric)
- `Total_Parcelas` (Numeric)
- `Parcela_Atual` (Numeric)
