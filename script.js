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
 * Busca um valor em um objeto de campos de forma resiliente
 * (ignora acentos, espaços, underscores e maiúsculas)
 */
function getFlexField(fields, target) {
    const normalize = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_]/g, "").toLowerCase();
    const normalizedTarget = normalize(target);
    
    for (let key in fields) {
        if (normalize(key) === normalizedTarget) {
            return fields[key];
        }
    }
    return undefined;
}

/**
 * Tenta obter o nome do cartão a partir do ID ou objeto de referência
 */
function getCardName(cardRef) {
    if (!cardRef) return 'Sem Cartão';
    
    // Se for um ID (número ou array de 1 elemento vindo do Grist)
    const id = Array.isArray(cardRef) ? cardRef[0] : (typeof cardRef === 'number' ? cardRef : null);
    
    if (id) {
        const card = cartoesData.find(c => c.id === id);
        if (card) {
            return getFlexField(card.fields, 'Nome_Cartao') || getFlexField(card.fields, 'NumCartao') || `Cartão ${id}`;
        }
        return `ID: ${id}`;
    }
    
    // Se já for um objeto vindo do onRecords (mapeado)
    if (typeof cardRef === 'object') {
        return cardRef.Nome_Cartao || cardRef.label || 'Cartão Indefinido';
    }
    
    return 'Cartão Indefinido';
}

async function updateDashboard() {
    const selectedCard = document.getElementById('cardFilter').value;
    
    // 1. Calcular Limite Global (Busca 'Limite' na tabela Banco)
    const globalLimit = bancoData.reduce((sum, row) => {
        const val = getFlexField(row.fields, 'Limite') || 0;
        return sum + val;
    }, 0);

    const occupancyByCard = {};
    let totalOccupied = 0;
    const next6Months = getNextMonths(6);
    const projectionData = next6Months.map(() => 0);

    allRecords.forEach(r => {
        const f = r.fields;
        const cardRef = getFlexField(f, 'Cartao');
        const cardName = getCardName(cardRef);
        
        if (selectedCard !== 'all' && cardName !== selectedCard) return;

        const installmentValue = getFlexField(f, 'Valor_Parcela') || getFlexField(f, 'Valor_Parcela') || 0;
        const totalInstallments = getFlexField(f, 'Total_Parcelas') || 1;
        const currentInstallment = getFlexField(f, 'Parcela_Atual') || 1;
        
        const remainingCount = Math.max(0, totalInstallments - currentInstallment + 1);
        const remainingValue = installmentValue * remainingCount;
        
        if (remainingValue > 0) {
            occupancyByCard[cardName] = (occupancyByCard[cardName] || 0) + remainingValue;
            totalOccupied += remainingValue;
        }

        // Projeção
        for (let i = 0; i < Math.min(remainingCount, 6); i++) {
            projectionData[i] += installmentValue;
        }
    });

    console.log("Resumo de Cálculo:", { globalLimit, totalOccupied, occupancyByCard });

    // Atualizar Pie Chart
    const availableLimit = Math.max(0, globalLimit - totalOccupied);
    const pieLabels = Object.keys(occupancyByCard);
    const pieData = Object.values(occupancyByCard);
    const pieColors = pieLabels.map((_, i) => COLORS[i % COLORS.length]);

    // Sempre mostrar o disponível se houver limite global
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
    const cards = [...new Set(allRecords.map(r => getCardName(getFlexField(r.fields, 'Cartao'))))].filter(c => c && c !== 'Sem Cartão');
    
    while (filter.options.length > 1) filter.remove(1);

    cards.sort().forEach(card => {
        const opt = document.createElement('option');
        opt.value = card;
        opt.textContent = card;
        filter.appendChild(opt);
    });
    
    if (cards.includes(currentSelection)) {
        filter.value = currentSelection;
    }
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
        
        console.log("Estrutura do primeiro Lançamento:", allRecords[0]?.fields);

        if (!pieChart) initCharts();
        populateFilter();
        updateDashboard();
    } catch (e) {
        console.error("Erro no Widget:", e);
    }
});

document.getElementById('cardFilter').addEventListener('change', updateDashboard);
