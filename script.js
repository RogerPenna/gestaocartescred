const APP_VERSION = "1.0.7";
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
    
    // Normalização para IDs do Grist
    const normalize = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_]/g, "").toLowerCase();
    const normalizedTarget = normalize(target);
    
    for (let key in data) {
        if (normalize(key) === normalizedTarget) return data[key];
    }
    return undefined;
}

/**
 * Obtém o nome do cartão de forma eficiente
 */
function getCardName(cardRef) {
    if (!cardRef) return 'Sem Cartão';
    
    // Se for [ID, Label], usa o Label diretamente (padrão Grist para referências)
    if (Array.isArray(cardRef) && cardRef.length > 1) return cardRef[1];
    
    // Se for apenas o ID (número), tenta buscar na tabela carregada
    const id = Array.isArray(cardRef) ? cardRef[0] : (typeof cardRef === 'number' ? cardRef : null);
    if (id && cartoesData.length > 0) {
        const card = cartoesData.find(c => c.id === id);
        if (card) return getValue(card, 'Nome_Cartao') || getValue(card, 'NumCartao') || `ID: ${id}`;
    }

    // Fallback para objetos
    if (typeof cardRef === 'object' && cardRef.label) return cardRef.label;
    
    return typeof cardRef === 'string' ? cardRef : 'Cartão Indefinido';
}

async function updateDashboard() {
    const selectedCard = document.getElementById('cardFilter').value;
    
    // Cálculo do Limite Global da tabela Banco
    const globalLimit = bancoData.reduce((sum, row) => {
        const val = getValue(row, 'Limite') || 0;
        return sum + val;
    }, 0);

    const occupancyByCard = {};
    let totalOccupied = 0;
    const next6Months = getNextMonths(6);
    const projectionData = next6Months.map(() => 0);

    allRecords.forEach(r => {
        const cardRef = getValue(r, 'Cartao');
        const cardName = getCardName(cardRef);
        
        if (selectedCard !== 'all' && cardName !== selectedCard) return;

        const valParcela = getValue(r, 'Valor_Parcela') || 0;
        const totalParc = getValue(r, 'Total_Parcelas') || 1;
        const parcAtual = getValue(r, 'Parcela_Atual') || 1;
        
        // Parcelas que ainda faltam pagar (incluindo a atual)
        const faltantes = Math.max(0, totalParc - parcAtual + 1);
        const saldoDevedor = valParcela * faltantes;
        
        if (saldoDevedor > 0) {
            occupancyByCard[cardName] = (occupancyByCard[cardName] || 0) + saldoDevedor;
            totalOccupied += saldoDevedor;
        }

        // Projeção mensal
        for (let i = 0; i < Math.min(faltantes, 6); i++) {
            projectionData[i] += valParcela;
        }
    });

    logDebug(`Dashboard v${APP_VERSION}: Limite Global=${globalLimit}, Total Ocupado=${totalOccupied.toFixed(2)}`);

    // Atualizar Pie Chart
    const availableLimit = Math.max(0, globalLimit - totalOccupied);
    const pieLabels = Object.keys(occupancyByCard);
    const pieData = Object.values(occupancyByCard);
    const pieColors = pieLabels.map((_, i) => COLORS[i % COLORS.length]);

    if (globalLimit > 0) {
        pieLabels.push('Limite Disponível');
        pieData.push(availableLimit);
        pieColors.push(RED_COLOR);
    } else {
        logDebug("Aviso: Limite Global é 0. Verifique se a tabela 'Banco' tem dados e se o widget tem 'Full Access'.");
    }

    pieChart.data.labels = pieLabels;
    pieChart.data.datasets[0].data = pieData;
    pieChart.data.datasets[0].backgroundColor = pieColors;
    pieChart.update();

    // Atualizar Bar Chart
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
        options: { 
            responsive: true, 
            plugins: { 
                title: { display: true, text: 'Ocupação do Limite Global' },
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
        data: { labels: [], datasets: [{ label: 'Projeção de Faturas', data: [], backgroundColor: '#3498db' }] },
        options: { 
            responsive: true, 
            plugins: { title: { display: true, text: 'Projeção para os Próximos 6 Meses' } },
            scales: { y: { beginAtZero: true, ticks: { callback: (v) => formatCurrency(v) } } }
        }
    });
}

grist.ready({ requiredAccess: 'full' });

grist.onRecords(async (records) => {
    try {
        logDebug(`Iniciando v${APP_VERSION}`);
        
        // IDs exatos do Python
        const T_BANCO = 'Banco';
        const T_CARTOES = 'Cartoes';

        // Tenta buscar tabelas auxiliares
        try {
            const fB = await grist.docApi.fetchTable(T_BANCO);
            bancoData = Array.isArray(fB) ? fB : (fB.records || []);
            logDebug(`Tabela ${T_BANCO}: ${bancoData.length} registros.`);
        } catch(e) { logDebug(`Erro ao ler ${T_BANCO}: ${e.message}`); }

        try {
            const fC = await grist.docApi.fetchTable(T_CARTOES);
            cartoesData = Array.isArray(fC) ? fC : (fC.records || []);
            logDebug(`Tabela ${T_CARTOES}: ${cartoesData.length} registros.`);
        } catch(e) { logDebug(`Erro ao ler ${T_CARTOES}: ${e.message}`); }

        // Lancamentos vem do onRecords (já filtrado e com labels)
        allRecords = records || [];
        logDebug(`Lançamentos (onRecords): ${allRecords.length}`);

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
