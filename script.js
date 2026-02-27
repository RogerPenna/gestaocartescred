let allRecords = [];
let bancoData = [];
let cartoesData = [];
let pieChart, barChart;

const COLORS = ['#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#f39c12', '#d35400'];
const RED_COLOR = '#e74c3c';

/**
 * Formata valores para R$
 */
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/**
 * Obtém os próximos 6 meses (incluindo o atual)
 */
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

/**
 * Inicializa os gráficos
 */
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
 * Processa os dados e atualiza os gráficos
 */
async function updateDashboard() {
    const selectedCard = document.getElementById('cardFilter').value;
    
    // 1. Calcular Limite Global (Soma de todos os limites na tabela Banco)
    const globalLimit = bancoData.reduce((sum, row) => sum + (row.Limite || 0), 0);

    // 2. Processar Lançamentos
    const filteredRecords = selectedCard === 'all' 
        ? allRecords 
        : allRecords.filter(r => {
            const cardName = r.Cartao?.Nome_Cartao || r.Cartao;
            return cardName === selectedCard;
        });

    // Pie Chart: Ocupação por cartão
    const occupancyByCard = {};
    let totalOccupied = 0;

    filteredRecords.forEach(r => {
        const cardName = r.Cartao?.Nome_Cartao || r.Cartao || 'Outros';
        // Ocupação = Valor Total da Compra - Valor já pago
        // Se Parcela_Atual é 1, nada foi pago ainda.
        // Se Parcela_Atual é 2, 1 parcela foi paga.
        // Ocupação = Valor_Parcela * (Total_Parcelas - Parcela_Atual + 1)
        const totalInstallments = r.Total_Parcelas || 1;
        const currentInstallment = r.Parcela_Atual || 1;
        const installmentValue = r.Valor_Parcela || 0;
        
        const remainingValue = installmentValue * (totalInstallments - currentInstallment + 1);
        
        occupancyByCard[cardName] = (occupancyByCard[cardName] || 0) + remainingValue;
        totalOccupied += remainingValue;
    });

    const availableLimit = Math.max(0, globalLimit - totalOccupied);

    // Atualizar Pie Chart
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

    // Bar Chart: Projeção 6 meses
    const next6Months = getNextMonths(6);
    const projectionData = next6Months.map(() => 0);

    filteredRecords.forEach(r => {
        const installmentValue = r.Valor_Parcela || 0;
        const totalInstallments = r.Total_Parcelas || 1;
        const currentInstallment = r.Parcela_Atual || 1;
        
        // Quantas parcelas ainda faltam (incluindo a atual)
        const remainingCount = totalInstallments - currentInstallment + 1;
        
        // Somar nos próximos meses
        for (let i = 0; i < Math.min(remainingCount, 6); i++) {
            projectionData[i] += installmentValue;
        }
    });

    barChart.data.labels = next6Months.map(m => m.name);
    barChart.data.datasets[0].data = projectionData;
    barChart.update();
}

/**
 * Popula o dropdown de cartões
 */
function populateFilter() {
    const filter = document.getElementById('cardFilter');
    const cards = [...new Set(allRecords.map(r => r.Cartao?.Nome_Cartao || r.Cartao))].filter(Boolean);
    
    // Limpar opções exceto a primeira
    while (filter.options.length > 1) {
        filter.remove(1);
    }

    cards.sort().forEach(card => {
        const opt = document.createElement('option');
        opt.value = card;
        opt.textContent = card;
        filter.appendChild(opt);
    });
}

// Configuração do Grist
grist.ready({
    requiredAccess: 'read table',
    columns: [
        { name: 'Cartao', type: 'Reference' },
        { name: 'Valor_Parcela', type: 'Numeric' },
        { name: 'Total_Parcelas', type: 'Numeric' },
        { name: 'Parcela_Atual', type: 'Numeric' }
    ]
});

grist.onRecords(async (records) => {
    allRecords = records;
    
    // Tenta buscar dados das outras tabelas
    try {
        bancoData = await grist.docApi.fetchTable('Banco');
        cartoesData = await grist.docApi.fetchTable('Cartoes');
    } catch (e) {
        console.warn("Não foi possível buscar tabelas Banco/Cartoes diretamente. Certifique-se que os nomes estão corretos.", e);
        // Se falhar, tentamos trabalhar apenas com o que temos nos records (joined data)
    }

    if (!pieChart) initCharts();
    populateFilter();
    updateDashboard();
});

// Event Listeners
document.getElementById('cardFilter').addEventListener('change', updateDashboard);
