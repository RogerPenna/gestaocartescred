const APP_VERSION = "2.5.0";
let allRecords = [];
let bancoData = [];
let cartoesData = [];
let pieChart, barChart;

// States
let viewLevel = 'macro'; 
let drilledCard = null;
let installmentPreview = [];

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

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    document.querySelector(`button[onclick="switchTab('${tabId}')"]`).classList.add('active');
    
    if (tabId === 'dashboard') updateDashboard();
    if (tabId === 'history') updateHistory();
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
    // Se for [ID, Label] (vindo do Grist)
    if (Array.isArray(cardRef) && cardRef.length > 1) return cardRef[1];
    
    // Se for um objeto de linha já carregado (fix do Bug [object Object])
    if (typeof cardRef === 'object' && !Array.isArray(cardRef)) {
        const name = getValue(cardRef, 'Nome_Cartao') || getValue(cardRef, 'NumCartao');
        if (name) return name;
    }

    const id = Array.isArray(cardRef) ? cardRef[0] : (typeof cardRef === 'number' ? cardRef : null);
    if (id && cartoesData.length > 0) {
        const card = cartoesData.find(c => c.id === id);
        if (card) return getValue(card, 'Nome_Cartao') || getValue(card, 'NumCartao') || `ID: ${id}`;
    }
    return cardRef.label || String(cardRef);
}

function getMonthDiff(startDate, targetDate) {
    return (targetDate.getFullYear() - startDate.getFullYear()) * 12 + (targetDate.getMonth() - startDate.getMonth());
}

/**
 * DASHBOARD
 */
async function updateDashboard() {
    const selectedCard = document.getElementById('cardFilter').value;
    const globalLimit = bancoData.reduce((sum, row) => sum + (getValue(row, 'Limite') || 0), 0);
    const next6Months = getNextMonths(6);
    const today = new Date();

    const occupancyByCard = {};
    const projectionByCard = {};
    const detailItems = [];
    let totalOccupied = 0;

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

        const diffDesdeCompra = getMonthDiff(purchaseDate, today);
        const parcJaPagas = Math.max(0, diffDesdeCompra);
        const parcRestantes = Math.max(0, totalParc - parcJaPagas);
        const saldoDevedor = valParcela * parcRestantes;

        if (saldoDevedor > 0) {
            occupancyByCard[cardName] = (occupancyByCard[cardName] || 0) + saldoDevedor;
            totalOccupied += saldoDevedor;
            if (viewLevel === 'detail' && cardName === drilledCard) detailItems.push({ label: desc, value: saldoDevedor });
        }

        if (!projectionByCard[cardName]) projectionByCard[cardName] = Array(6).fill(0);
        for (let i = 0; i < 6; i++) {
            const diff = getMonthDiff(purchaseDate, next6Months[i].date);
            if (diff >= 0 && diff < totalParc) projectionByCard[cardName][i] += valParcela;
        }
    });

    let pieLabels = [], pieData = [], pieColors = [];
    if (viewLevel === 'macro') {
        document.getElementById('backButtonContainer').style.display = 'none';
        pieLabels = Object.keys(occupancyByCard);
        pieData = Object.values(occupancyByCard);
        pieColors = pieLabels.map(name => cardColorMap[name]);
        if (globalLimit > 0) {
            pieLabels.push('Limite Disponível');
            pieData.push(Math.max(0, globalLimit - totalOccupied));
            pieColors.push(RED_COLOR);
        }
    } else {
        document.getElementById('backButtonContainer').style.display = 'block';
        detailItems.sort((a, b) => b.value - a.value);
        const top10 = detailItems.slice(0, 10);
        pieLabels = top10.map(i => i.label);
        pieData = top10.map(i => i.value);
        const baseColor = cardColorMap[drilledCard];
        pieColors = top10.map((_, i) => `${baseColor}${Math.floor((1 - i*0.08) * 255).toString(16).padStart(2, '0')}`);
    }

    pieChart.data.labels = pieLabels;
    pieChart.data.datasets[0].data = pieData;
    pieChart.data.datasets[0].backgroundColor = pieColors;
    pieChart.update();

    barChart.data.labels = next6Months.map(m => m.name);
    barChart.data.datasets = Object.keys(projectionByCard).sort().map(name => ({
        label: name,
        data: projectionByCard[name],
        backgroundColor: cardColorMap[name]
    }));
    barChart.update();
}

/**
 * ENTRY
 */
function generatePreview() {
    const cardId = parseInt(document.getElementById('inCard').value);
    const dateStr = document.getElementById('inDate').value;
    const baseDesc = document.getElementById('inDesc').value;
    const totalVal = parseFloat(document.getElementById('inTotal').value);
    const installments = parseInt(document.getElementById('inInstallments').value);

    if (!cardId || !dateStr || !baseDesc || isNaN(totalVal) || isNaN(installments)) {
        alert("Preencha todos os campos corretamente."); return;
    }

    const valorParcela = parseFloat((totalVal / installments).toFixed(2));
    const startDate = new Date(dateStr + "T00:00:00");
    installmentPreview = [];
    const tbody = document.querySelector('#previewTable tbody');
    tbody.innerHTML = '';

    for (let i = 1; i <= installments; i++) {
        const currentDate = new Date(startDate);
        currentDate.setMonth(startDate.getMonth() + (i - 1));
        const finalDesc = `${baseDesc} ${String(i).padStart(2, '0')} ${String(installments).padStart(2, '0')}`;
        const dateIso = currentDate.toISOString().split('T')[0];

        installmentPreview.push({ Cartao: cardId, Data: dateIso, Descritivo: finalDesc, Valor_Parcela: valorParcela, Total_Parcelas: installments });
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${currentDate.toLocaleDateString('pt-BR')}</td><td>${finalDesc}</td><td class="${valorParcela < 0 ? 'negative-value' : ''}">${formatCurrency(valorParcela)}</td>`;
        tbody.appendChild(tr);
    }
    document.getElementById('previewSection').style.display = 'block';
}

async function saveToGrist() {
    try {
        await grist.docApi.addRecords('Lancamentos', installmentPreview.map(p => ({ fields: p })));
        alert("Lançamento salvo com sucesso!");
        document.getElementById('tab-entry').querySelectorAll('input').forEach(i => i.value = '');
        document.getElementById('previewSection').style.display = 'none';
        switchTab('dashboard');
    } catch (e) { alert("Erro ao salvar: " + e.message); }
}

/**
 * HISTORY
 */
function updateHistory() {
    const tbody = document.querySelector('#historyTable tbody');
    tbody.innerHTML = '';
    
    // Mostra os últimos 20 lançamentos ordenados por ID (mais recentes primeiro)
    const sorted = [...allRecords].sort((a,b) => b.id - a.id).slice(0, 30);
    
    sorted.forEach(r => {
        const val = getValue(r, 'Valor_Parcela') || 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(getValue(r, 'Data')).toLocaleDateString('pt-BR')}</td>
            <td>${getCardName(getValue(r, 'Cartao'))}</td>
            <td>${getValue(r, 'Descritivo')}</td>
            <td class="${val < 0 ? 'negative-value' : ''}">${formatCurrency(val)}</td>
            <td><button class="btn-danger" onclick="deleteEntry(${r.id})">Excluir</button></td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteEntry(recordId) {
    if (confirm("Deseja realmente excluir este lançamento? Esta ação não pode ser desfeita.")) {
        try {
            await grist.docApi.deleteRecords('Lancamentos', [recordId]);
            logDebug(`Registro ${recordId} excluído.`);
            updateHistory();
        } catch (e) { alert("Erro ao excluir: " + e.message); }
    }
}

/**
 * UTILS
 */
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

    pieChart = new Chart(document.getElementById('pieChart').getContext('2d'), {
        type: 'pie',
        data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
        options: { 
            responsive: true,
            onClick: (evt, elements) => {
                if (viewLevel === 'macro' && elements.length > 0) {
                    const label = pieChart.data.labels[elements[0].index];
                    if (label !== 'Limite Disponível') { viewLevel = 'detail'; drilledCard = label; updateDashboard(); }
                }
            }
        }
    });

    barChart = new Chart(document.getElementById('barChart').getContext('2d'), {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => formatCurrency(v) } } } }
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
        
        // Popula Dropdowns (Correção de Bug)
        const inCardSelect = document.getElementById('inCard');
        const cardFilter = document.getElementById('cardFilter');

        if (cardFilter.options.length <= 1) {
            // Usa os dados de cartoesData diretamente para o nome
            const cards = cartoesData.map(c => ({ id: c.id, name: getCardName(c) })).sort((a,b) => a.name.localeCompare(b.name));
            
            inCardSelect.innerHTML = '<option value="">Selecione um cartão...</option>';
            cardFilter.innerHTML = '<option value="all">Todos os Cartões</option>';

            cards.forEach(c => {
                const opt1 = document.createElement('option');
                opt1.value = c.id; opt1.textContent = c.name;
                inCardSelect.appendChild(opt1);

                const opt2 = document.createElement('option');
                opt2.value = c.name; opt2.textContent = c.name;
                cardFilter.appendChild(opt2);
            });
        }
        
        if (!document.getElementById('inDate').value) {
            document.getElementById('inDate').value = new Date().toISOString().split('T')[0];
        }

        updateDashboard();
        if (document.getElementById('tab-history').classList.contains('active')) updateHistory();
    } catch (e) { logDebug(`ERRO GERAL: ${e.message}`); }
});

document.getElementById('btnBackToMacro').onclick = () => { viewLevel = 'macro'; drilledCard = null; updateDashboard(); };
document.getElementById('btnPreview').onclick = generatePreview;
document.getElementById('btnSave').onclick = saveToGrist;
document.getElementById('appVersion').textContent = APP_VERSION;
document.getElementById('clearLog').onclick = () => document.getElementById('debugLog').innerHTML = '';
document.getElementById('copyLog').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('debugLog').innerText).then(() => alert('Log copiado!'));
};

window.switchTab = switchTab;
window.deleteEntry = deleteEntry;
