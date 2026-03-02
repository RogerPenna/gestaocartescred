const APP_VERSION = "2.0.0";
let allRecords = [];
let bancoData = [];
let cartoesData = [];
let pieChart, barChart;

const COLORS = ['#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#f39c12', '#d35400'];
const RED_COLOR = '#e74c3c';

/**
 * LOGGING VISUAL
 */
function logDebug(message, data = null) {
    const logEl = document.getElementById('debugLog');
    if (!logEl) return;
    const timestamp = new Date().toLocaleTimeString();
    let text = `[${timestamp}] ${message}`;
    if (data) {
        try { text += `\n${JSON.stringify(data, null, 2)}`; } catch (e) { text += `\n[Erro JSON]`; }
    }
    const div = document.createElement('div');
    div.style.borderBottom = "1px solid #34495e";
    div.style.padding = "5px 0";
    div.textContent = text;
    logEl.prepend(div);
}

/**
 * LÓGICA GRIST TABLE LENS (Adaptada)
 */
const GTL = {
    tables: null,
    columns: null,

    async init() {
        logDebug("GTL: Carregando metadados...");
        try {
            this.tables = await grist.docApi.fetchTable('_grist_Tables');
            this.columns = await grist.docApi.fetchTable('_grist_Tables_column');
            logDebug("GTL: Metadados carregados com sucesso.");
        } catch (e) {
            logDebug("GTL ERRO: Falha ao carregar metadados (Full Access?).", e.message);
            throw e;
        }
    },

    getNumericId(tableId) {
        if (!this.tables?.tableId) return null;
        const idx = this.tables.tableId.findIndex(t => t === tableId);
        return idx === -1 ? null : this.tables.id[idx];
    },

    colDataToRows(colData) {
        if (!colData || !colData.id) return [];
        const rows = [];
        const keys = Object.keys(colData);
        const numRows = colData.id.length;
        for (let i = 0; i < numRows; i++) {
            const r = { id: colData.id[i] };
            keys.forEach(k => { if (k !== 'id') r[k] = colData[k][i]; });
            rows.push(r);
        }
        return rows;
    },

    async fetchTable(tableId) {
        logDebug(`GTL: Buscando tabela ${tableId}...`);
        const raw = await grist.docApi.fetchTable(tableId);
        return this.colDataToRows(raw);
    }
};

/**
 * DASHBOARD LOGIC
 */
function getCardName(cardRef) {
    if (!cardRef) return 'Sem Cartão';
    if (Array.isArray(cardRef) && cardRef.length > 1) return cardRef[1];
    const id = Array.isArray(cardRef) ? cardRef[0] : (typeof cardRef === 'number' ? cardRef : null);
    if (id && cartoesData.length > 0) {
        const card = cartoesData.find(c => c.id === id);
        if (card) return card.Nome_Cartao || card.NumCartao || `ID: ${id}`;
    }
    return cardRef.label || String(cardRef);
}

async function updateDashboard() {
    const selectedCard = document.getElementById('cardFilter').value;
    
    // Banco Limite
    const globalLimit = bancoData.reduce((sum, row) => sum + (row.Limite || 0), 0);
    const occupancyByCard = {};
    let totalOccupied = 0;
    const next6Months = getNextMonths(6);
    const projectionData = next6Months.map(() => 0);

    allRecords.forEach(r => {
        const cardName = getCardName(r.Cartao);
        if (selectedCard !== 'all' && cardName !== selectedCard) return;

        const valParcela = r.Valor_Parcela || 0;
        const totalParc = r.Total_Parcelas || 1;
        const parcAtual = r.Parcela_Atual || 1;
        const faltantes = Math.max(0, totalParc - parcAtual + 1);
        const saldoDevedor = valParcela * faltantes;
        
        if (saldoDevedor > 0) {
            occupancyByCard[cardName] = (occupancyByCard[cardName] || 0) + saldoDevedor;
            totalOccupied += saldoDevedor;
        }

        for (let i = 0; i < Math.min(faltantes, 6); i++) {
            projectionData[i] += valParcela;
        }
    });

    logDebug(`Dashboard v${APP_VERSION}: Limite=${globalLimit}, Ocupado=${totalOccupied.toFixed(2)}`);

    const availableLimit = Math.max(0, globalLimit - totalOccupied);
    const pieLabels = Object.keys(occupancyByCard);
    const pieData = Object.values(occupancyByCard);
    const pieColors = pieLabels.map((_, i) => COLORS[i % COLORS.length]);

    if (globalLimit > 0) {
        pieLabels.push('Limite Disponível');
        pieData.push(availableLimit);
        pieColors.push(RED_COLOR);
    }

    pieChart.data.labels = pieLabels;
    pieChart.data.datasets[0].data = pieData;
    pieChart.data.datasets[0].backgroundColor = pieColors;
    pieChart.update();

    barChart.data.labels = next6Months.map(m => m.name);
    barChart.data.datasets[0].data = projectionData;
    barChart.update();
}

function populateFilter() {
    const filter = document.getElementById('cardFilter');
    const currentSelection = filter.value;
    const cards = [...new Set(allRecords.map(r => getCardName(r.Cartao)))].filter(c => c && c !== 'Sem Cartão');
    while (filter.options.length > 1) filter.remove(1);
    cards.sort().forEach(card => {
        const opt = document.createElement('option');
        opt.value = card;
        opt.textContent = card;
        filter.appendChild(opt);
    });
    if (cards.includes(currentSelection)) filter.value = currentSelection;
}

function formatCurrency(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v); }
function getNextMonths(count) {
    const months = []; const now = new Date();
    for (let i = 0; i < count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push({ name: d.toLocaleString('pt-BR', { month: 'long' }), year: d.getFullYear(), month: d.getMonth() });
    }
    return months;
}

function initCharts() {
    if (pieChart) try { pieChart.destroy(); } catch(e) {}
    if (barChart) try { barChart.destroy(); } catch(e) {}

    const pieCtx = document.getElementById('pieChart').getContext('2d');
    pieChart = new Chart(pieCtx, {
        type: 'pie',
        data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
        options: { responsive: true, plugins: { title: { display: true, text: 'Ocupação do Limite Global' } } }
    });

    const barCtx = document.getElementById('barChart').getContext('2d');
    barChart = new Chart(barCtx, {
        type: 'bar',
        data: { labels: [], datasets: [{ label: 'Projeção de Faturas', data: [], backgroundColor: '#3498db' }] },
        options: { responsive: true, plugins: { title: { display: true, text: 'Projeção para os Próximos 6 Meses' } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => formatCurrency(v) } } } }
    });
}

grist.ready({ requiredAccess: 'full' });

grist.onRecords(async (records) => {
    try {
        logDebug(`Iniciando v${APP_VERSION} (Engine GTL)`);
        
        // 1. Inicia o motor de metadados
        await GTL.init();

        // 2. Busca dados usando a lógica de conversão do GTL
        bancoData = await GTL.fetchTable('Banco');
        cartoesData = await GTL.fetchTable('Cartoes');
        
        // Lancamentos (Usa o formato do Grist vindo do onRecords mapeado para objetos simples)
        allRecords = records.map(r => {
            const row = { id: r.id };
            Object.keys(r).forEach(k => {
                if (k !== 'id' && k !== '_grist_id') row[k] = r[k];
            });
            return row;
        });

        logDebug(`Carga OK: Bancos=${bancoData.length}, Cartões=${cartoesData.length}, Lançamentos=${allRecords.length}`);

        if (!pieChart || !barChart) initCharts();
        populateFilter();
        updateDashboard();
    } catch (e) {
        logDebug(`ERRO GTL: ${e.message}`);
    }
});

document.getElementById('cardFilter').addEventListener('change', updateDashboard);
document.getElementById('appVersion').textContent = APP_VERSION;
document.getElementById('clearLog').onclick = () => document.getElementById('debugLog').innerHTML = '';
document.getElementById('copyLog').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('debugLog').innerText).then(() => alert('Log copiado!'));
};
