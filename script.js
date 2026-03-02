const APP_VERSION = "2.2.0";
let allRecords = [];
let bancoData = [];
let cartoesData = [];
let pieChart, barChart;
let selectedMonthIndex = null; // null = Global, 0-5 = Mês específico

const COLORS = ['#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#f39c12', '#d35400', '#16a085', '#27ae60', '#2980b9', '#8e44ad', '#2c3e50', '#f39c12', '#e67e22'];
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

/**
 * Diferença de meses entre duas datas
 */
function getMonthDiff(startDate, targetDate) {
    return (targetDate.getFullYear() - startDate.getFullYear()) * 12 + (targetDate.getMonth() - startDate.getMonth());
}

async function updateDashboard() {
    const selectedCard = document.getElementById('cardFilter').value;
    const globalLimit = bancoData.reduce((sum, row) => sum + (getValue(row, 'Limite') || 0), 0);
    const next6Months = getNextMonths(6);
    
    let totalOccupied = 0;
    const itemsForPie = []; // { label, value }
    const projectionByCard = {}; // { cardName: [6 values] }

    // Obter data de hoje para referência
    const today = new Date();

    allRecords.forEach(r => {
        const cardName = getCardName(r.Cartao);
        if (selectedCard !== 'all' && cardName !== selectedCard) return;

        const purchaseDate = new Date(getValue(r, 'Data') || today);
        const valParcela = getValue(r, 'Valor_Parcela') || 0;
        const totalParc = getValue(r, 'Total_Parcelas') || 1;
        const desc = getValue(r, 'Descritivo') || 'Sem Descrição';

        // Lógica de Projeção para o Bar Chart
        if (!projectionByCard[cardName]) projectionByCard[cardName] = Array(6).fill(0);
        
        for (let i = 0; i < 6; i++) {
            const targetMonthDate = next6Months[i].date;
            const diff = getMonthDiff(purchaseDate, targetMonthDate);
            // Se a diferença está entre 0 e Total - 1, a parcela é devida naquele mês
            if (diff >= 0 && diff < totalParc) {
                projectionByCard[cardName][i] += valParcela;
                
                // Se este mês for o selecionado para o Drill-down da Pizza
                if (selectedMonthIndex === i) {
                    itemsForPie.push({ label: `${desc} (${cardName})`, value: valParcela });
                }
            }
        }

        // Lógica Global (Modo Ocupação)
        if (selectedMonthIndex === null) {
            // No modo global, calculamos o saldo devedor TOTAL baseado na data atual
            const diffDesdeCompra = getMonthDiff(purchaseDate, today);
            const parcJaPagas = Math.max(0, diffDesdeCompra);
            const parcRestantes = Math.max(0, totalParc - parcJaPagas);
            const saldoDevedor = valParcela * parcRestantes;

            if (saldoDevedor > 0) {
                totalOccupied += saldoDevedor;
                itemsForPie.push({ label: `${desc} (${cardName})`, value: saldoDevedor });
            }
        }
    });

    // --- Processar Pizza (Top 10 + Outros) ---
    itemsForPie.sort((a, b) => b.value - a.value);
    const top10 = itemsForPie.slice(0, 10);
    const rest = itemsForPie.slice(10);
    const otherValue = rest.reduce((sum, item) => sum + item.value, 0);

    const pieLabels = top10.map(i => i.label);
    const pieData = top10.map(i => i.value);
    const pieColors = top10.map((_, i) => COLORS[i % COLORS.length]);

    if (otherValue > 0) {
        pieLabels.push("Outras Compras Menores");
        pieData.push(otherValue);
        pieColors.push('#95a5a6'); // Cinza para outros
    }

    // Se estiver no modo global, adiciona o Limite Disponível
    if (selectedMonthIndex === null && globalLimit > 0) {
        const availableLimit = Math.max(0, globalLimit - totalOccupied);
        pieLabels.push('Limite Disponível');
        pieData.push(availableLimit);
        pieColors.push(RED_COLOR);
    }

    // Atualizar Pie Chart
    pieChart.options.plugins.title.text = selectedMonthIndex === null 
        ? 'Ocupação do Limite Global (Saldo Devedor)' 
        : `Composição da Fatura: ${next6Months[selectedMonthIndex].name}`;
    pieChart.data.labels = pieLabels;
    pieChart.data.datasets[0].data = pieData;
    pieChart.data.datasets[0].backgroundColor = pieColors;
    pieChart.update();

    // Atualizar Bar Chart
    barChart.data.labels = next6Months.map(m => m.name);
    const cardNames = Object.keys(projectionByCard).sort();
    barChart.data.datasets = cardNames.map((name, idx) => ({
        label: name,
        data: projectionByCard[name],
        backgroundColor: COLORS[idx % COLORS.length],
        borderWidth: selectedMonthIndex === idx ? 2 : 0,
        borderColor: '#2c3e50'
    }));
    barChart.update();

    logDebug(`Dashboard v${APP_VERSION}: Modo ${selectedMonthIndex === null ? 'Global' : 'Drill-down'}`);
}

function getNextMonths(count) {
    const months = []; const now = new Date();
    for (let i = 0; i < count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push({ 
            name: d.toLocaleString('pt-BR', { month: 'long' }), 
            date: d 
        });
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
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const val = ctx.parsed || 0;
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            return `${ctx.label}: ${formatCurrency(val)} (${((val/total)*100).toFixed(1)}%)`;
                        }
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
            onClick: (evt, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    selectedMonthIndex = (selectedMonthIndex === index) ? null : index;
                    updateDashboard();
                } else {
                    selectedMonthIndex = null;
                    updateDashboard();
                }
            }
        }
    });
}

function formatCurrency(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v); }

grist.ready({ requiredAccess: 'full' });

grist.onRecords(async (records) => {
    try {
        logDebug(`Iniciando v${APP_VERSION}`);
        const tables = await grist.docApi.listTables();
        bancoData = await grist.docApi.fetchTable('Banco');
        cartoesData = await grist.docApi.fetchTable('Cartoes');
        allRecords = records.map(r => ({ ...r }));

        if (!pieChart || !barChart) initCharts();
        
        // Popula o filtro apenas uma vez ou quando os registros mudarem
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

document.getElementById('cardFilter').addEventListener('change', () => {
    selectedMonthIndex = null; // Reseta o zoom ao mudar o filtro de cartão
    updateDashboard();
});
document.getElementById('appVersion').textContent = APP_VERSION;
document.getElementById('clearLog').onclick = () => document.getElementById('debugLog').innerHTML = '';
document.getElementById('copyLog').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('debugLog').innerText).then(() => alert('Log copiado!'));
};
