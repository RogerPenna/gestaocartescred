let allRecords = [];
let bancoData = [];
let cartoesData = [];
let pieChart, barChart;

const COLORS = ['#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#f39c12', '#d35400'];
const RED_COLOR = '#e74c3c';

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function getNextMonths(count) {
    const months = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push({
            name: d.toLocaleString('pt-BR', { month: 'long' }),
            year: d.getFullYear(),
            month: d.getMonth()
        });
    }
    return months;
}

function initCharts() {
    const pieCtx = document.getElementById('pieChart').getContext('2d');
    pieChart = new Chart(pieCtx, {
        type: 'pie',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: []
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: { display: true, text: 'Ocupação do Limite Global' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1) + '%';
                            return `${label}: ${formatCurrency(value)} (${percentage})`;
                        }
                    }
                }
            }
        }
    });

    const barCtx = document.getElementById('barChart').getContext('2d');
    barChart = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Projeção de Faturas',
                data: [],
                backgroundColor: '#3498db'
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: { display: true, text: 'Projeção para os Próximos 6 Meses' }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (value) => formatCurrency(value)
                    }
                }
            }
        }
    });
}

/**
 * Busca um valor de forma resiliente tentando:
 * 1. O nome exato (ID)
 * 2. O nome normalizado (sem acento/espaço/case)
 */
function getValue(obj, target) {
    if (!obj) return undefined;
    
    // Se o objeto for um registro do Grist, tenta procurar em .fields ou no topo
    const data = obj.fields || obj;
    
    // 1. Tentativa Direta (ID padrão do Grist)
    const directKey = target.replace(/ /g, '_');
    if (data[directKey] !== undefined) return data[directKey];

    // 2. Busca Normalizada (Resiliente)
    const normalize = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_]/g, "").toLowerCase();
    const normalizedTarget = normalize(target);
    
    for (let key in data) {
        if (normalize(key) === normalizedTarget) {
            return data[key];
        }
    }
    return undefined;
}

/**
 * Tenta obter o nome do cartão a partir do ID ou objeto de referência
 */
function getCardName(cardRef) {
    if (!cardRef) return 'Sem Cartão';
    
    const id = Array.isArray(cardRef) ? cardRef[0] : (typeof cardRef === 'number' ? cardRef : null);
    
    if (id) {
        const card = cartoesData.find(c => c.id === id);
        if (card) {
            return getValue(card, 'Nome_Cartao') || getValue(card, 'NumCartao') || `Cartão ${id}`;
        }
    }
    
    if (typeof cardRef === 'object') {
        return cardRef.Nome_Cartao || cardRef.label || 'Cartão Indefinido';
    }
    
    return 'Cartão Indefinido';
}

async function updateDashboard() {
    const selectedCard = document.getElementById('cardFilter').value;
    
    // Calcular Limite Global
    const globalLimit = bancoData.reduce((sum, row) => sum + (getValue(row, 'Limite') || 0), 0);

    const occupancyByCard = {};
    let totalOccupied = 0;
    const next6Months = getNextMonths(6);
    const projectionData = next6Months.map(() => 0);

    allRecords.forEach(r => {
        const cardRef = getValue(r, 'Cartao');
        const cardName = getCardName(cardRef);
        
        if (selectedCard !== 'all' && cardName !== selectedCard) return;

        const installmentValue = getValue(r, 'Valor_Parcela') || 0;
        const totalInstallments = getValue(r, 'Total_Parcelas') || 1;
        const currentInstallment = getValue(r, 'Parcela_Atual') || 1;
        
        const remainingCount = Math.max(0, totalInstallments - currentInstallment + 1);
        const remainingValue = installmentValue * remainingCount;
        
        if (remainingValue > 0) {
            occupancyByCard[cardName] = (occupancyByCard[cardName] || 0) + remainingValue;
            totalOccupied += remainingValue;
        }

        for (let i = 0; i < Math.min(remainingCount, 6); i++) {
            projectionData[i] += installmentValue;
        }
    });

    console.log("Calculado:", { globalLimit, totalOccupied, cartoes: Object.keys(occupancyByCard).length });

    // Atualizar Pie Chart
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

grist.ready({ requiredAccess: 'full' });

grist.onRecords(async (records) => {
    try {
        const fetchLancamentos = await grist.docApi.fetchTable('Lancamentos');
        allRecords = Array.isArray(fetchLancamentos) ? fetchLancamentos : (fetchLancamentos.records || []);
        
        const fetchBanco = await grist.docApi.fetchTable('Banco');
        bancoData = Array.isArray(fetchBanco) ? fetchBanco : (fetchBanco.records || []);
        
        const fetchCartoes = await grist.docApi.fetchTable('Cartoes');
        cartoesData = Array.isArray(fetchCartoes) ? fetchCartoes : (fetchCartoes.records || []);
        
        console.log("Amostra Lancamentos:", allRecords[0]);

        if (!pieChart) initCharts();
        populateFilter();
        updateDashboard();
    } catch (e) {
        console.error("Erro no Widget:", e);
    }
});

grist.ready({ requiredAccess: 'full' });

grist.onRecords(async (records) => {
    try {
        const fetchLancamentos = await grist.docApi.fetchTable('Lancamentos');
        allRecords = Array.isArray(fetchLancamentos) ? fetchLancamentos : (fetchLancamentos.records || []);
        
        const fetchBanco = await grist.docApi.fetchTable('Banco');
        bancoData = Array.isArray(fetchBanco) ? fetchBanco : (fetchBanco.records || []);
        
        const fetchCartoes = await grist.docApi.fetchTable('Cartoes');
        cartoesData = Array.isArray(fetchCartoes) ? fetchCartoes : (fetchCartoes.records || []);
        
        console.log("Estrutura do primeiro Lançamento:", allRecords[0]?.fields);

        if (!pieChart) initCharts();
        populateFilter();
        updateDashboard();
    } catch (e) {
        console.error("Erro no Widget:", e);
    }
});

document.getElementById('cardFilter').addEventListener('change', updateDashboard);
