const APP_VERSION = "2.1.0";
let allRecords = [];
let bancoData = [];
let cartoesData = [];
let pieChart, barChart;

const COLORS = ['#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#f39c12', '#d35400'];
const RED_COLOR = '#e74c3c';

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

function getValue(obj, target) {
    if (!obj) return undefined;
    const data = obj.fields || obj;
    const directKey = target.replace(/ /g, '_');
    if (data[directKey] !== undefined) return data[directKey];
    const normalize = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_]/g, "").toLowerCase();
    const normalizedTarget = normalize(target);
    for (let key in data) {
        if (normalize(key) === normalizedTarget) return data[key];
    }
    return undefined;
}

function getCardName(cardRef) {
    if (!cardRef) return 'Sem Cartão';
    if (Array.isArray(cardRef) && cardRef.length > 1) return cardRef[1];
    const id = Array.isArray(cardRef) ? cardRef[0] : (typeof cardRef === 'number' ? cardRef : null);
    if (id && cartoesData.length > 0) {
        const card = cartoesData.find(c => c.id === id);
        if (card) return getValue(card, 'Nome_Cartao') || getValue(card, 'NumCartao') || `ID: ${id}`;
    }
    return cardRef.label || String(cardRef);
}

/**
 * LÓGICA GRIST TABLE LENS (Engine)
 */
const GTL = {
    tables: null,
    async init() {
        try {
            this.tables = await grist.docApi.fetchTable('_grist_Tables');
            this.columns = await grist.docApi.fetchTable('_grist_Tables_column');
        } catch (e) { logDebug("GTL ERRO", e.message); throw e; }
    },
    colDataToRows(colData) {
        if (!colData || !colData.id) return [];
        const rows = [];
        const keys = Object.keys(colData);
        for (let i = 0; i < colData.id.length; i++) {
            const r = { id: colData.id[i] };
            keys.forEach(k => { if (k !== 'id') r[k] = colData[k][i]; });
            rows.push(r);
        }
        return rows;
    },
    async fetchTable(tableId) {
        const raw = await grist.docApi.fetchTable(tableId);
        return this.colDataToRows(raw);
    }
};

async function updateDashboard() {
    const selectedCard = document.getElementById('cardFilter').value;
    const globalLimit = bancoData.reduce((sum, row) => sum + (getValue(row, 'Limite') || 0), 0);
    
    const occupancyByCard = {};
    const projectionByCard = {}; // { CardName: [6 months array] }
    let totalOccupied = 0;
    const next6Months = getNextMonths(6);

    // Lista única de cartões para cores consistentes
    const uniqueCardNames = [...new Set(allRecords.map(r => getCardName(r.Cartao)))].sort();
    const cardColorMap = {};
    uniqueCardNames.forEach((name, i) => cardColorMap[name] = COLORS[i % COLORS.length]);

    allRecords.forEach(r => {
        const cardName = getCardName(r.Cartao);
        if (selectedCard !== 'all' && cardName !== selectedCard) return;

        const valParcela = r.Valor_Parcela || 0;
        const totalParc = r.Total_Parcelas || 1;
        const parcAtual = r.Parcela_Atual || 1;
        const faltantes = Math.max(0, totalParc - parcAtual + 1);
        const saldoDevedor = valParcela * faltantes;
        
        // Ocupação
        if (saldoDevedor > 0) {
            occupancyByCard[cardName] = (occupancyByCard[cardName] || 0) + saldoDevedor;
            totalOccupied += saldoDevedor;
        }

        // Projeção Empilhada
        if (!projectionByCard[cardName]) projectionByCard[cardName] = Array(6).fill(0);
        for (let i = 0; i < Math.min(faltantes, 6); i++) {
            projectionByCard[cardName][i] += valParcela;
        }
    });

    // 1. Atualizar Pie Chart
    const availableLimit = Math.max(0, globalLimit - totalOccupied);
    const pieLabels = Object.keys(occupancyByCard);
    const pieData = Object.values(occupancyByCard);
    const pieColors = pieLabels.map(name => cardColorMap[name]);

    if (globalLimit > 0) {
        pieLabels.push('Limite Disponível');
        pieData.push(availableLimit);
        pieColors.push(RED_COLOR);
    }

    pieChart.data.labels = pieLabels;
    pieChart.data.datasets[0].data = pieData;
    pieChart.data.datasets[0].backgroundColor = pieColors;
    pieChart.update();

    // 2. Atualizar Bar Chart (Stacked)
    barChart.data.labels = next6Months.map(m => m.name);
    barChart.data.datasets = Object.keys(projectionByCard).map(name => ({
        label: name,
        data: projectionByCard[name],
        backgroundColor: cardColorMap[name]
    }));
    barChart.update();

    logDebug(`Dashboard v${APP_VERSION} Atualizado.`);
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
        data: { labels: [], datasets: [] },
        options: { 
            responsive: true, 
            scales: { 
                x: { stacked: true }, 
                y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => formatCurrency(v) } } 
            },
            plugins: { title: { display: true, text: 'Projeção para os Próximos 6 Meses' } }
        }
    });
}

grist.ready({ requiredAccess: 'full' });

grist.onRecords(async (records) => {
    try {
        logDebug(`Carregando v${APP_VERSION}...`);
        await GTL.init();
        bancoData = await GTL.fetchTable('Banco');
        cartoesData = await GTL.fetchTable('Cartoes');
        allRecords = records.map(r => ({ ...r }));

        if (!pieChart || !barChart) initCharts();
        populateFilter();
        updateDashboard();
    } catch (e) { logDebug(`ERRO GTL: ${e.message}`); }
});

document.getElementById('cardFilter').addEventListener('change', updateDashboard);
document.getElementById('appVersion').textContent = APP_VERSION;
document.getElementById('clearLog').onclick = () => document.getElementById('debugLog').innerHTML = '';
document.getElementById('copyLog').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('debugLog').innerText).then(() => alert('Log copiado!'));
};
