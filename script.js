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
 * Mapeia o nome do cartão a partir do ID da referência
 */
function getCardName(cardRef) {
    if (!cardRef) return 'Sem Cartão';
    // Se cardRef for um objeto (comum em onRecords mapeado)
    if (typeof cardRef === 'object' && cardRef.Nome_Cartao) return cardRef.Nome_Cartao;
    
    // Se for apenas o ID (comum em fetchTable)
    const card = cartoesData.find(c => c.id === cardRef || c.NumCartao === cardRef);
    return card ? card.Nome_Cartao : `Cartão ${cardRef}`;
}

async function updateDashboard() {
    const selectedCard = document.getElementById('cardFilter').value;
    const globalLimit = bancoData.reduce((sum, row) => sum + (row.Limite || 0), 0);

    const occupancyByCard = {};
    let totalOccupied = 0;
    const next6Months = getNextMonths(6);
    const projectionData = next6Months.map(() => 0);

    allRecords.forEach(r => {
        const cardName = getCardName(r.Cartao);
        
        // Se houver filtro e não for o cartão selecionado, pula
        if (selectedCard !== 'all' && cardName !== selectedCard) return;

        const installmentValue = r.Valor_Parcela || 0;
        const totalInstallments = r.Total_Parcelas || 1;
        const currentInstallment = r.Parcela_Atual || 1;
        const remainingCount = Math.max(0, totalInstallments - currentInstallment + 1);
        
        // Cálculo de Ocupação (Saldo Devedor)
        const remainingValue = installmentValue * remainingCount;
        occupancyByCard[cardName] = (occupancyByCard[cardName] || 0) + remainingValue;
        totalOccupied += remainingValue;

        // Projeção de Faturas
        for (let i = 0; i < Math.min(remainingCount, 6); i++) {
            projectionData[i] += installmentValue;
        }
    });

    // Atualizar Pie Chart
    const availableLimit = Math.max(0, globalLimit - totalOccupied);
    const pieLabels = Object.keys(occupancyByCard);
    const pieData = Object.values(occupancyByCard);
    const pieColors = pieLabels.map((_, i) => COLORS[i % COLORS.length]);

    pieLabels.push('Limite Disponível');
    pieData.push(availableLimit);
    pieColors.push(RED_COLOR);

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
    const cards = [...new Set(allRecords.map(r => getCardName(r.Cartao)))].filter(Boolean);
    
    while (filter.options.length > 1) filter.remove(1);

    cards.sort().forEach(card => {
        const opt = document.createElement('option');
        opt.value = card;
        opt.textContent = card;
        filter.appendChild(opt);
    });
    filter.value = currentSelection;
}

grist.ready({ requiredAccess: 'full' });

grist.onRecords(async (records) => {
    try {
        // Busca todas as tabelas para garantir sincronia
        allRecords = await grist.docApi.fetchTable('Lancamentos');
        bancoData = await grist.docApi.fetchTable('Banco');
        cartoesData = await grist.docApi.fetchTable('Cartoes');
        
        if (!pieChart) initCharts();
        populateFilter();
        updateDashboard();
    } catch (e) {
        console.error("Erro ao buscar dados do Grist:", e);
    }
});

document.getElementById('cardFilter').addEventListener('change', updateDashboard);
