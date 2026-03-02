const APP_VERSION = "1.0.6";
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
    const id = Array.isArray(cardRef) ? cardRef[0] : (typeof cardRef === 'number' ? cardRef : null);
    if (id) {
        const card = cartoesData.find(c => c.id === id);
        if (card) return getValue(card, 'Nome_Cartao') || getValue(card, 'NumCartao') || `Cartão ${id}`;
    }
    if (typeof cardRef === 'object' && cardRef.label) return cardRef.label;
    if (typeof cardRef === 'string') return cardRef;
    return 'Cartão Indefinido';
}

async function updateDashboard() {
    const selectedCard = document.getElementById('cardFilter').value;
    const globalLimit = bancoData.reduce((sum, row) => sum + (getValue(row, 'Limite') || 0), 0);
    const occupancyByCard = {};
    let totalOccupied = 0;
    const next6Months = getNextMonths(6);
    const projectionData = next6Months.map(() => 0);

    allRecords.forEach(r => {
        const cardRef = getValue(r, 'Cartao');
        const cardName = getCardName(cardRef);
        if (selectedCard !== 'all' && cardName !== selectedCard) return;
        const installmentValue = getValue(r, 'Valor_Parcela') || getValue(r, 'Valor Parcela') || 0;
        const totalInstallments = getValue(r, 'Total_Parcelas') || 1;
        const currentInstallment = getValue(r, 'Parcela_Atual') || 1;
        const remainingCount = Math.max(0, totalInstallments - currentInstallment + 1);
        const remainingValue = installmentValue * remainingCount;
        if (remainingValue > 0) {
            occupancyByCard[cardName] = (occupancyByCard[cardName] || 0) + remainingValue;
            totalOccupied += remainingValue;
        }
        for (let i = 0; i < Math.min(remainingCount, 6); i++) projectionData[i] += installmentValue;
    });

    logDebug(`Dashboard: Limite=${globalLimit}, Ocupado=${totalOccupied.toFixed(2)}`);

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
    const cards = [...new Set(allRecords.map(r => getCardName(getValue(r, 'Cartao'))))].filter(c => c && c !== 'Sem Cartão');
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
    if (pieChart) pieChart.destroy();
    if (barChart) barChart.destroy();
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
        logDebug(`Iniciando v${APP_VERSION}`);
        
        // 1. Listar todas as tabelas (importante para diagnosticar o erro de chave)
        const tables = await grist.docApi.listTables();
        logDebug("Tabelas disponíveis:", tables);

        // 2. Buscar dados (Tenta IDs comuns se o fetch falhar)
        try {
            const fBanco = await grist.docApi.fetchTable('Banco') || await grist.docApi.fetchTable('Bancos');
            bancoData = Array.isArray(fBanco) ? fBanco : (fBanco.records || []);
            logDebug(`Bancos: ${bancoData.length}`);
        } catch(e) { logDebug(`Erro Banco: ${e.message}`); }

        try {
            const fCartoes = await grist.docApi.fetchTable('Cartoes');
            cartoesData = Array.isArray(fCartoes) ? fCartoes : (fCartoes.records || []);
            logDebug(`Cartões: ${cartoesData.length}`);
        } catch(e) { logDebug(`Erro Cartoes: ${e.message}`); }

        if (records && records.length > 0) {
            allRecords = records;
            logDebug(`Lançamentos: ${allRecords.length}`);
        }

        if (!pieChart || !barChart) initCharts();
        populateFilter();
        updateDashboard();
    } catch (e) {
        logDebug(`ERRO GERAL: ${e.message}`);
    }
});

document.getElementById('cardFilter').addEventListener('change', updateDashboard);
document.getElementById('appVersion').textContent = APP_VERSION;
document.getElementById('clearLog').onclick = () => document.getElementById('debugLog').innerHTML = '';
document.getElementById('copyLog').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('debugLog').innerText).then(() => alert('Log copiado!'));
};
