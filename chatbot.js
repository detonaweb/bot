const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs-extra'); // Para leitura/escrita de arquivos, se você já usa
const moment = require('moment-timezone'); // Para manipulação de datas/horas, se você já usa
const express = require('express'); // <-- NOVO: Adicione esta linha

// --- Configurações do seu bot ---
// URL base do seu painel PHP, onde estão os arquivos de configuração
const PAINEL_URL = 'http://tecnoarte.icu/painelzap'; // Certifique-se de que esta URL está correta e acessível

// Array para armazenar os dados dos clientes
let clientes = [];
let mensagensCustom = [];
let vencimentosJS = {};
let vencidosBloqueadosJS = {};
let faturaJS = {};

// Função para carregar dados dos clientes
async function carregarDadosClientes() {
    try {
        const response = await axios.get(`${PAINEL_URL}/vencimentos.js`);
        vencimentosJS = eval(response.data.replace('module.exports =', '')); // Executa o JS para obter o objeto
        clientes = Object.values(vencimentosJS.vencimentos || {}); // Assume que vencimentos.js tem um objeto 'vencimentos'

        const responseVencidos = await axios.get(`${PAINEL_URL}/vencidos_bloqueados.js`);
        vencidosBloqueadosJS = eval(responseVencidos.data.replace('module.exports =', ''));

        const responseFatura = await axios.get(`${PAINEL_URL}/fatura.js`);
        faturaJS = eval(responseFatura.data.replace('module.exports =', ''));

        console.log('Dados dos clientes e arquivos de configuração atualizados.');
    } catch (error) {
        console.error('Erro ao carregar dados dos clientes ou arquivos de configuração:', error.message);
    }
}

// Função para carregar mensagens customizadas
async function carregarMensagensCustom() {
    try {
        const response = await axios.get(`${PAINEL_URL}/mensagens_custom.js`);
        mensagensCustom = eval(response.data.replace('module.exports =', '')); // Executa o JS para obter o array
        console.log('Mensagens customizadas atualizadas.');
    } catch (error) {
        console.error('Erro ao carregar mensagens customizadas:', error.message);
    }
}

// Cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Importante para ambientes como Render
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Para alguns ambientes com pouca RAM
            '--disable-gpu' // Pode ajudar em alguns casos
        ],
    }
});

client.on('qr', (qr) => {
    console.log('QR CODE RECEBIDO! Escaneie com seu celular para conectar o bot.');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado e bot online.');
    carregarDadosClientes(); // Carrega dados na inicialização
    carregarMensagensCustom(); // Carrega mensagens customizadas na inicialização
});

client.on('authenticated', (session) => {
    console.log('WhatsApp autenticado!');
});

client.on('auth_failure', msg => {
    console.error('Falha na autenticação do WhatsApp:', msg);
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp desconectado!', reason);
    // Tenta inicializar novamente após desconexão
    client.initialize();
});

// Resposta a mensagens
client.on('message', async msg => {
    const chat = await msg.getChat();
    const numeroCliente = msg.from.split('@')[0]; // Remove o "@c.us"

    // Ignorar mensagens de grupos
    if (chat.isGroup) {
        return;
    }

    // Lógica para verificar se o cliente existe
    const clienteEncontrado = clientes.find(c => c.celular === numeroCliente);

    if (msg.body === '1') {
        if (clienteEncontrado) {
            let mensagem = "Olá! Seja bem-vindo(a) ao nosso atendimento.\n";
            mensagem += "Aqui você pode acessar sua fatura e solicitar suporte.\n\n";
            mensagem += "Seu nome: " + clienteEncontrado.nome + "\n";
            mensagem += "Seu plano: " + clienteEncontrado.plano + "\n";
            mensagem += "Vencimento: " + clienteEncontrado.vencimento + "\n";
            mensagem += "Status: " + clienteEncontrado.status + "\n\n";
            mensagem += "Para acessar sua fatura, clique no link abaixo:\n";
            mensagem += faturaJS.link_fatura; // Usando o link do fatura.js
            mensagem += "\n\n";
            mensagem += "Para atendimento técnico, por favor, descreva seu problema.";
            msg.reply(mensagem);
        } else {
            msg.reply("Olá! Não encontramos seu cadastro em nosso sistema. Por favor, digite seu nome completo ou entre em contato com nosso suporte para mais informações.");
        }
    } else if (mensagensCustom.includes(msg.body.toLowerCase())) {
        // Se a mensagem for uma das mensagens customizadas
        msg.reply("Esta é uma resposta personalizada para a sua mensagem."); // Adapte conforme sua necessidade
    } else if (msg.body === 'menu' || msg.body === 'olá' || msg.body === 'oi') {
        msg.reply('Olá! Digite *1* para acessar o menu de cliente IPTV.');
    } else {
        // Resposta padrão para outras mensagens
        msg.reply('Entendi sua mensagem. Se precisar de ajuda, digite *menu* para ver as opções ou *1* para acessar o menu de cliente IPTV.');
    }
});

// --- Agendamentos de Tarefas (CRON) ---

// Tarefa agendada para verificar clientes 1 dia antes do vencimento
cron.schedule('0 9 * * *', async () => { // Todos os dias às 09:00
    console.log('Executando agendamento: Verificação de vencimento -1 dia.');
    await carregarDadosClientes(); // Recarrega os dados para ter informações mais recentes
    const hoje = moment().tz('America/Sao_Paulo');
    const amanha = hoje.add(1, 'days');

    for (const cliente of clientes) {
        const vencimento = moment(cliente.vencimento, 'DD/MM/YYYY').tz('America/Sao_Paulo');
        if (vencimento.isSame(amanha, 'day') && cliente.status === 'ativo') {
            const mensagem = `Olá, ${cliente.nome}! Seu plano ${cliente.plano} vence amanhã (${cliente.vencimento}). Para evitar a interrupção do serviço, realize o pagamento o quanto antes.`;
            client.sendMessage(`${cliente.celular}@c.us`, mensagem);
            console.log(`Mensagem de vencimento -1 dia enviada para ${cliente.nome}.`);
        }
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});

// Tarefa agendada para verificar clientes no dia do vencimento (se ainda ativo)
cron.schedule('30 9 * * *', async () => { // Todos os dias às 09:30
    console.log('Executando agendamento: Verificação de vencimento no dia.');
    await carregarDadosClientes();
    const hoje = moment().tz('America/Sao_Paulo');

    for (const cliente of clientes) {
        const vencimento = moment(cliente.vencimento, 'DD/MM/YYYY').tz('America/Sao_Paulo');
        if (vencimento.isSame(hoje, 'day') && cliente.status === 'ativo') {
            const mensagem = `Olá, ${cliente.nome}! Seu plano ${cliente.plano} vence hoje (${cliente.vencimento}). Regularize sua situação para continuar desfrutando dos nossos serviços.`;
            client.sendMessage(`${cliente.celular}@c.us`, mensagem);
            console.log(`Mensagem de vencimento no dia enviada para ${cliente.nome}.`);
        }
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});

// Tarefa agendada para clientes vencidos e bloqueados (1 dia após o vencimento)
cron.schedule('0 10 * * *', async () => { // Todos os dias às 10:00
    console.log('Executando agendamento: Verificação de vencidos/bloqueados.');
    await carregarDadosClientes();
    const hoje = moment().tz('America/Sao_Paulo');
    const ontem = hoje.subtract(1, 'days');

    for (const cliente of clientes) {
        const vencimento = moment(cliente.vencimento, 'DD/MM/YYYY').tz('America/Sao_Paulo');
        if (vencimento.isSame(ontem, 'day') && cliente.status === 'bloqueado') {
            const mensagem = `Olá, ${cliente.nome}. Seu acesso foi bloqueado devido ao não pagamento do plano ${cliente.plano} vencido em ${cliente.vencimento}. Por favor, regularize sua situação para reativar o serviço.`;
            client.sendMessage(`${cliente.celular}@c.us`, mensagem);
            console.log(`Mensagem de bloqueio enviada para ${cliente.nome}.`);
        }
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});

// Recarregar dados dos clientes e mensagens customizadas periodicamente
cron.schedule('0 */4 * * *', async () => { // A cada 4 horas
    console.log('Executando agendamento: Recarga periódica de dados e mensagens customizadas.');
    await carregarDadosClientes();
    await carregarMensagensCustom();
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});

// --- NOVO: Servidor HTTP para o Render (ADICIONE ESTE BLOCO NO FINAL DO chatbot.js) ---
const app = express();
const port = process.env.PORT || 3000; // O Render define a variável PORT

app.get('/', (req, res) => {
  res.status(200).send('Bot is running and healthy!');
});

app.listen(port, () => {
  console.log(`Web server listening on port ${port}`);
});

// A inicialização do cliente WhatsApp já deve estar no final do seu arquivo original
// client.initialize();
