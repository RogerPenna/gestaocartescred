const APP_VERSION = "2.3.0";
let allRecords = [];
let bancoData = [];
let cartoesData = [];
let pieChart, barChart;

// Estado do Drill-down
let viewLevel = 'macro'; // 'macro' (cartões) ou 'detail' (compras de um cartão)
let drilledCard = null; // Nome do cartão selecionado para detalhe

const COLORS = ['#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#f39c12', '#d35400', '#16a085', '#27ae60', '#2980b9', '#8e44ad', '#2c3e50'];
const RED_COLOR = '#e74c3c';

function logDebug(message, data = null) {
    const logEl = document.getElementById('debugLog');
    if (!logEl) return;
    const timestamp = new Date().toLocaleTimeString();
    let text = `[${timestamp}] ${message}`;
    if (data) try { text += `\n${JSON.stringify(data, null, 2)}`; } catch (e) {}
    const div = document.createElement('div');
    div.style.borderBottom = "1px solid #34495e";
    div.style.padding = "5px 0";
    div.textContent = text;
    logEl.prepend(div);
}

function colDataToRows(colData) {
    if (!colData || !colData.id) return [];
    const rows = [];
    const keys = Object.keys(colData);
    for (let i = 0; i < colData.id.length; i++) {
        const r = { id: colData.id[i] };
        keys.forEach(k => { if (k !== 'id') r[k] = colData[k][i]; });
        rows.push(r);
    }
    return rows;
}

function getValue(obj, target) {
    if (!obj) return undefined;
    const data = obj.fields || obj;
    const directKey = target.replace(/ /g, '_');
    if (data[directKey] !== undefined) return data[directKey];
    const normalize = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_]/g, "").toLowerCase();
    const normalizedTarget = normalize(target);
    for (let key in data) { if (normalize(key) === normalizedTarget) return data[key]; }
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

function generateShades(baseColor, count) {
    // Função simples para gerar tons baseados em opacidade/luminosidade
    const shades = [];
    for (let i = 0; i < count; i++) {
        const opacity = (1 - (i * 0.08)).toFixed(2);
        shades.push(`${baseColor}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`);
    }
    return shades;
}

function getMonthDiff(startDate, targetDate) {
    return (targetDate.getFullYear() - startDate.getFullYear()) * 12 + (targetDate.getMonth() - startDate.getMonth());
}

async function updateDashboard() {
    const selectedCard = document.getElementById('cardFilter').value;
    const globalLimit = bancoData.reduce((sum, row) => sum + (getValue(row, 'Limite') || 0), 0);
    const next6Months = getNextMonths(6);
    const today = new Date();

    const occupancyByCard = {}; // Para visão Macro
    const projectionByCard = {}; // Para Barras Empilhadas
    const detailItems = []; // Para visão Micro (Drill-down)
    let totalOccupied = 0;

    // Mapa de cores fixas por cartão
    const uniqueCardNames = [...new Set(allRecords.map(r => getCardName(r.Cartao)))].sort();
    const cardColorMap = {};
    uniqueCardNames.forEach((name, i) => cardColorMap[name] = COLORS[i % COLORS.length]);

    allRecords.forEach(r => {
        const cardName = getCardName(r.Cartao);
        if (selectedCard !== 'all' && cardName !== selectedCard) return;

        const purchaseDate = new Date(getValue(r, 'Data') || today);
        const valParcela = getValue(r, 'Valor_Parcela') || 0;
        const totalParc = getValue(r, 'Total_Parcelas') || 1;
        const desc = getValue(r, 'Descritivo') || 'Sem Descrição';

        // Cálculo de saldo devedor (Ocupação Global)
        const diffDesdeCompra = getMonthDiff(purchaseDate, today);
        const parcJaPagas = Math.max(0, diffDesdeCompra);
        const parcRestantes = Math.max(0, totalParc - parcJaPagas);
        const saldoDevedor = valParcela * parcRestantes;

        if (saldoDevedor > 0) {
            occupancyByCard[cardName] = (occupancyByCard[cardName] || 0) + saldoDevedor;
            totalOccupied += saldoDevedor;
            
            // Se estivermos no modo Drill-down deste cartão
            if (viewLevel === 'detail' && cardName === drilledCard) {
                detailItems.push({ label: desc, value: saldoDevedor });
            }
        }

        // Projeção para Barras
        if (!projectionByCard[cardName]) projectionByCard[cardName] = Array(6).fill(0);
        for (let i = 0; i < 6; i++) {
            const diff = getMonthDiff(purchaseDate, next6Months[i].date);
            if (diff >= 0 && diff < totalParc) {
                projectionByCard[cardName][i] += valParcela;
            }
        }
    });

    // --- Atualizar Pie Chart (Macro vs Micro) ---
    let pieLabels = [], pieData = [], pieColors = [];
    const backBtn = document.getElementById('backButtonContainer');

    if (viewLevel === 'macro') {
        backBtn.style.display = 'none';
        pieLabels = Object.keys(occupancyByCard);
        pieData = Object.values(occupancyByCard);
        pieColors = pieLabels.map(name => cardColorMap[name]);

        if (globalLimit > 0) {
            const available = Math.max(0, globalLimit - totalOccupied);
            pieLabels.push('Limite Disponível');
            pieData.push(available);
            pieColors.push(RED_COLOR);
        }
        pieChart.options.plugins.title.text = 'Ocupação do Limite Global (Saldo Devedor por Cartão)';
    } else {
        backBtn.style.display = 'block';
        detailItems.sort((a, b) => b.value - a.value);
        const top10 = detailItems.slice(0, 10);
        const rest = detailItems.slice(10);
        const otherVal = rest.reduce((s, i) => s + i.value, 0);

        pieLabels = top10.map(i => i.label);
        pieData = top10.map(i => i.value);
        const baseColor = cardColorMap[drilledCard];
        pieColors = generateShades(baseColor, top10.length);

        if (otherVal > 0) {
            pieLabels.push("Outras Compras Menores");
            pieData.push(otherVal);
            pieColors.push('#95a5a6');
        }
        pieChart.options.plugins.title.text = `Detalhes de Compras: ${drilledCard}`;
    }

    pieChart.data.labels = pieLabels;
    pieChart.data.datasets[0].data = pieData;
    pieChart.data.datasets[0].backgroundColor = pieColors;
    pieChart.update();

    // --- Atualizar Bar Chart (Stacked) ---
    barChart.data.labels = next6Months.map(m => m.name);
    barChart.data.datasets = Object.keys(projectionByCard).sort().map(name => ({
        label: name,
        data: projectionByCard[name],
        backgroundColor: cardColorMap[name],
        borderColor: name === drilledCard ? '#000' : 'transparent',
        borderWidth: name === drilledCard ? 2 : 0
    }));
    barChart.update();

    logDebug(`Dashboard v${APP_VERSION}: ${viewLevel === 'macro' ? 'Visão Geral' : 'Drill-down: ' + drilledCard}`);
}

function getNextMonths(count) {
    const months = []; const now = new Date();
    for (let i = 0; i < count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push({ name: d.toLocaleString('pt-BR', { month: 'long' }), date: d });
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
        options: { 
            responsive: true,
            onClick: (evt, elements) => {
                if (viewLevel === 'macro' && elements.length > 0) {
                    const index = elements[0].index;
                    const label = pieChart.data.labels[index];
                    if (label !== 'Limite Disponível') {
                        viewLevel = 'detail';
                        drilledCard = label;
                        updateDashboard();
                    }
                }
            }
        }
    });

    const barCtx = document.getElementById('barChart').getContext('2d');
    barChart = new Chart(barCtx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: { 
            responsive: true, 
            scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => formatCurrency(v) } } },
            plugins: { title: { display: true, text: 'Projeção para os Próximos 6 Meses' } }
        }
    });
}

function formatCurrency(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v); }

grist.ready({ requiredAccess: 'full' });

grist.onRecords(async (records) => {
    try {
        logDebug(`Iniciando v${APP_VERSION}`);
        bancoData = colDataToRows(await grist.docApi.fetchTable('Banco'));
        cartoesData = colDataToRows(await grist.docApi.fetchTable('Cartoes'));
        allRecords = records.map(r => ({ ...r }));

        if (!pieChart || !barChart) initCharts();
        
        // Populate Filtro
        const filter = document.getElementById('cardFilter');
        if (filter.options.length <= 1) {
            const cards = [...new Set(allRecords.map(r => getCardName(r.Cartao)))].filter(Boolean).sort();
            cards.forEach(card => {
                const opt = document.createElement('option');
                opt.value = card;
                opt.textContent = card;
                filter.appendChild(opt);
            });
        }
        updateDashboard();
    } catch (e) { logDebug(`ERRO GERAL: ${e.message}`); }
});

document.getElementById('btnBackToMacro').onclick = () => {
    viewLevel = 'macro';
    drilledCard = null;
    updateDashboard();
};

document.getElementById('cardFilter').onchange = (e) => {
    const val = e.target.value;
    if (val === 'all') {
        viewLevel = 'macro';
        drilledCard = null;
    } else {
        viewLevel = 'detail';
        drilledCard = val;
    }
    updateDashboard();
};
