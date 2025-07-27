// leitor de qr code
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, Buttons, List, MessageMedia } = require('whatsapp-web.js');
const axios = require('axios'); // Importa o axios
const cron = require('node-cron'); // Importa a biblioteca node-cron

// --- Variáveis de Controle ---
let restartRequester = null;
const sentVencimentoIds = new Set(); 
const sentBloqueioIds = new Set();
const sentCustomMessageIds = new Set(); // Para mensagens customizadas já enviadas

const recentContacts = new Set();
const ADMIN_NUMBER = '5513996131312@c.us'; // Por favor, SUBSTITUA este número pelo SEU NÚMERO COMPLETO.

// Configura o cliente do WhatsApp com a estratégia de autenticação local
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "bot-empresa-tal" // Nome único para sua sessão. Mantenha este nome para o bot "lembrar" a sessão.
    }),
    // puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] } // Descomente se necessário para seu ambiente Linux
});

// --- Eventos do Cliente ---

// Evento de geração do QR code: exibe o QR code no terminal para autenticação inicial.
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('QR CODE RECEBIDO! Escaneie com seu celular para conectar o bot.');
});

// Evento de autenticação bem-sucedida: indica que a sessão foi estabelecida ou restaurada.
client.on('authenticated', () => {
    console.log('AUTENTICADO! Sessão estabelecida ou restaurada com sucesso.');
});

// Evento de quando o cliente está pronto: o bot está conectado e pronto para interagir.
client.on('ready', async () => {
    console.log('Tudo certo! WhatsApp conectado e bot online.');

    // Se houve um solicitante para o reinício, envia uma mensagem de confirmação para ele.
    if (restartRequester) {
        try {
            const chat = await client.getChatById(restartRequester);
            await sendMessageWithTyping(chat, restartRequester, 'Bot reiniciado com sucesso e online!', 1000, 1000);
            console.log(`Mensagem de confirmação de reinício enviada para ${restartRequester}`);
        } catch (error) {
            console.error(`Erro ao enviar confirmação de reinício para ${restartRequester}:`, error);
        } finally {
            restartRequester = null;
        }
    }

    // --- Agendamento da Tarefa de Vencimentos a cada minuto ---
    cron.schedule('* * * * *', async () => { // Formato cron: 'minuto hora dia_do_mes mes dia_da_semana'
        console.log(`[${new Date().toLocaleTimeString()}] Iniciando tarefa agendada: Verificação e envio de notificações de vencimento.`);
        const url = 'https://tecnoarte.icu/painelzap/vencimentos.js';
        const processingResult = await fetchAndProcessVencimentos(url);
        console.log(`[${new Date().toLocaleTimeString()}] Resultado da tarefa agendada (Vencimentos):`, processingResult);
    }, {
        scheduled: true,
        timezone: "America/Sao_Paulo" 
    });
    console.log('Tarefa de vencimentos agendada para verificar a CADA MINUTO.');

    // --- Agendamento da Tarefa de Notificação de Bloqueio (a cada minuto para testes) ---
    cron.schedule('* * * * *', async () => { 
        console.log(`[${new Date().toLocaleTimeString()}] Iniciando tarefa agendada: Verificação e envio de notificações de bloqueio.`);
        const urlBloqueados = 'https://tecnoarte.icu/painelzap/vencidos_bloqueados.js';
        const processingResultBloqueados = await fetchAndProcessBloqueados(urlBloqueados);
        console.log(`[${new Date().toLocaleTimeString()}] Resultado da tarefa agendada (Bloqueados):`, processingResultBloqueados);
    }, {
        scheduled: true,
        timezone: "America/Sao_Paulo" 
    });
    console.log('Tarefa de notificação de bloqueio agendada para verificar a CADA MINUTO (modo de teste).');

    // --- Agendamento: Tarefa de Mensagem Customizada (a cada minuto) ---
    cron.schedule('* * * * *', async () => { 
        console.log(`[${new Date().toLocaleTimeString()}] Iniciando tarefa agendada: Verificação e envio de mensagens customizadas.`);
        const urlCustom = 'https://tecnoarte.icu/painelzap/mensagens_custom.js';
        const processingResultCustom = await fetchAndProcessCustomMessages(urlCustom); 
        console.log(`[${new Date().toLocaleTimeString()}] Resultado da tarefa agendada (Custom):`, processingResultCustom);
    }, {
        scheduled: true,
        timezone: "America/Sao_Paulo" 
    });
    console.log('Tarefa de mensagens customizadas agendada para verificar a CADA MINUTO.');


});

// Evento de falha na autenticação: indica que a sessão pode estar corrompida.
client.on('auth_failure', msg => {
    console.error('FALHA NA AUTENTICAÇÃO:', msg);
});

// Evento de desconexão do cliente: ocorre quando a conexão com o WhatsApp é perdida.
client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
    console.log('Tentando reconectar o bot...');
    client.initialize(); 
});

// Inicializa o cliente do WhatsApp
client.initialize();

// --- Funções Auxiliares ---

const delay = ms => new Promise(res => setTimeout(res, ms));

async function sendMessageWithTyping(chat, to, message, typingDelay = 1000, messageDelay = 1000) {
    // Apenas simula digitação se o chat for válido e não for o chat do administrador (para a notificação inicial).
    if (chat && typeof chat.sendStateTyping === 'function' && to !== ADMIN_NUMBER) { 
        await delay(typingDelay);
        await chat.sendStateTyping();
        await delay(messageDelay);
    } else {
        await delay(typingDelay + messageDelay);
    }
    await client.sendMessage(to, message);
}

// --- Função para Ler, Extrair e Processar Vencimentos da URL ---
async function fetchAndProcessVencimentos(url) {
    try {
        const response = await axios.get(url);
        const scriptContent = response.data;
        const match = scriptContent.match(/var\s+vencimentos\s*=\s*(\[[^;]*?\]);/s);

        if (match && match[1]) {
            const jsonString = match[1];
            const vencimentosArray = JSON.parse(jsonString);

            if (vencimentosArray.length === 0) {
                return 'Não há vencimentos pendentes no momento.';
            }

            let responseMessage = 'Notificações de vencimento processadas:\n\n';
            for (const item of vencimentosArray) {
                const numero = item.numero;
                const chatId = numero.endsWith('@c.us') ? numero : `${numero}@c.us`;
                const mensagem = item.mensagem;
                const vencimentoUniqueId = `${numero}-${mensagem.substring(0, 50)}`; 
                
                if (sentVencimentoIds.has(vencimentoUniqueId)) {
                    responseMessage += `⏭️ Ignorado (já enviado) para ${numero.substring(0, 5)}...${numero.substring(numero.length - 4)}\n`;
                    continue; 
                }

                try {
                    await client.sendMessage(chatId, mensagem); 
                    responseMessage += `✅ Mensagem enviada para ${numero.substring(0, 5)}...${numero.substring(numero.length - 4)}\n`;
                    sentVencimentoIds.add(vencimentoUniqueId); 
                } catch (sendError) {
                    console.error(`Erro ao enviar mensagem para ${numero}:`, sendError.message);
                    responseMessage += `❌ Falha ao enviar para ${numero.substring(0, 5)}...${numero.substring(numero.length - 4)}: ${sendError.message} (Verifique o número ou status do contato)\n`;
                }
                await delay(1000); 
            }
            return responseMessage;

        } else {
            console.error('Padrão de vencimentos não encontrado no script da URL.');
            return 'Não foi possível extrair as informações de vencimento do arquivo.';
        }

    } catch (error) {
        console.error('Erro ao buscar ou processar dados de vencimentos da URL:', url, error.message);
        return 'Ocorreu um erro ao tentar carregar as informações de vencimento. Por favor, tente novamente mais tarde.';
    }
}

// --- Função para Ler, Extrair e Processar Clientes Vencidos/Bloqueados ---
async function fetchAndProcessBloqueados(url) {
    try {
        const response = await axios.get(url);
        const scriptContent = response.data;
        const match = scriptContent.match(/var\s+vencidosBloqueados\s*=\s*(\[[^;]*?\]);/s);

        if (match && match[1]) {
            const jsonString = match[1];
            const bloqueadosArray = JSON.parse(jsonString);

            if (bloqueadosArray.length === 0) {
                return 'Não há clientes vencidos/bloqueados para notificar.';
            }

            let responseMessage = 'Notificações de clientes bloqueados processadas:\n\n';
            for (const item of bloqueadosArray) {
                const numero = item.numero;
                const chatId = numero.endsWith('@c.us') ? numero : `${numero}@c.us`;
                const mensagem = item.mensagem;
                const bloqueioUniqueId = `${numero}-bloqueio-${mensagem.substring(0, 50)}`; 
                
                if (sentBloqueioIds.has(bloqueioUniqueId)) {
                    responseMessage += `⏭️ Ignorado (já enviado) para ${numero.substring(0, 5)}...${numero.substring(numero.length - 4)}\n`;
                    continue; 
                }

                try {
                    await client.sendMessage(chatId, mensagem); 
                    responseMessage += `✅ Mensagem enviada para ${numero.substring(0, 5)}...${numero.substring(numero.length - 4)}\n`;
                    sentBloqueioIds.add(bloqueioUniqueId); 
                } catch (sendError) {
                    console.error(`Erro ao enviar mensagem de bloqueio para ${numero}:`, sendError.message);
                    responseMessage += `❌ Falha ao enviar para ${numero.substring(0, 5)}...${numero.substring(numero.length - 4)}: ${sendError.message} (Verifique o número ou status do contato)\n`;
                }
                await delay(1000); 
            }
            return responseMessage;

        } else {
            console.error('Padrão de vencidosBloqueados não encontrado no script da URL.');
            return 'Não foi possível extrair as informações de clientes bloqueados do arquivo.';
        }

    } catch (error) {
        console.error('Erro ao buscar ou processar dados de vencidos/bloqueados da URL:', url, error.message);
        return 'Ocorreu um erro ao tentar carregar as informações de clientes bloqueados. Por favor, tente novamente mais tarde.';
    }
}

// --- Função para Ler, Extrair e Processar Mensagens Customizadas ---
async function fetchAndProcessCustomMessages(url) {
    try {
        const response = await axios.get(url);
        const scriptContent = response.data;

        // Expressão regular para extrair a string JSON do array 'customMessages'
        const match = scriptContent.match(/var\s+customMessages\s*=\s*(\[[^;]*?\]);/s);

        if (match && match[1]) {
            const jsonString = match[1];
            const customMessagesArray = JSON.parse(jsonString);

            if (customMessagesArray.length === 0) {
                return 'Não há mensagens customizadas pendentes.';
            }

            let responseMessage = 'Mensagens customizadas processadas:\n\n';
            let messagesSentCount = 0; // Contador de mensagens enviadas

            for (const item of customMessagesArray) {
                const numero = item.numero;
                const chatId = numero.endsWith('@c.us') ? numero : `${numero}@c.us`;
                const mensagem = item.mensagem;
                
                // Gerar um ID único para esta mensagem customizada
                const customUniqueId = `${numero}-custom-${mensagem.substring(0, 50)}`; 
                
                if (sentCustomMessageIds.has(customUniqueId)) {
                    responseMessage += `⏭️ Ignorado (já enviado nesta sessão) para ${numero.substring(0, 5)}...${numero.substring(numero.length - 4)}\n`;
                    continue; 
                }

                try {
                    await client.sendMessage(chatId, mensagem); 
                    responseMessage += `✅ Mensagem enviada para ${numero.substring(0, 5)}...${numero.substring(numero.length - 4)}\n`;
                    sentCustomMessageIds.add(customUniqueId); 
                    messagesSentCount++;
                } catch (sendError) {
                    console.error(`Erro ao enviar mensagem customizada para ${numero}:`, sendError.message);
                    responseMessage += `❌ Falha ao enviar para ${numero.substring(0, 5)}...${numero.substring(numero.length - 4)}: ${sendError.message} (Verifique o número ou status do contato)\n`;
                }
                await delay(1000); // Pequeno delay entre os envios
            }

            // Se pelo menos uma mensagem foi enviada, limpa o arquivo no servidor
            if (messagesSentCount > 0) {
                // CORREÇÃO AQUI: URL agora aponta para 'enviar.php'
                await axios.get('https://tecnoarte.icu/painelzap/enviar.php?clear=true');
                responseMessage += '\nArquivo mensagens_custom.js limpo no servidor.';
                console.log('Arquivo mensagens_custom.js limpo após o envio.');
                sentCustomMessageIds.clear(); // Limpa também o set local, pois o arquivo foi limpo
            }
            return responseMessage;

        } else {
            // console.error('Padrão de customMessages não encontrado no script da URL.'); // Removido para evitar spam no log
            return 'Não foi possível extrair mensagens customizadas do arquivo.';
        }

    } catch (error) {
        console.error('Erro ao buscar ou processar dados de mensagens customizadas da URL:', url, error.message);
        return 'Ocorreu um erro ao tentar carregar as mensagens customizadas. Por favor, tente novamente mais tarde.';
    }
}


// --- Função para Consultar Fatura do Cliente (já existente, corrigida) ---
async function consultClientFatura(clientNumberRaw, chat, from) {
    const faturaUrl = 'https://tecnoarte.icu/painelzap/fatura.js';
    try {
        await sendMessageWithTyping(chat, from, 'Buscando sua fatura, por favor, aguarde...', 1000, 1000);

        const response = await axios.get(faturaUrl);
        const scriptContent = response.data;

        const match = scriptContent.match(/var\s+faturas\s*=\s*(\[[^;]*?\]);/s);

        if (match && match[1]) {
            const jsonString = match[1];
            const faturasArray = JSON.parse(jsonString);

            const normalizedClientNumber = clientNumberRaw.replace('@c.us', '').replace('+', '');

            const faturaDoCliente = faturasArray.find(fatura => 
                fatura.numero === normalizedClientNumber
            );

            if (faturaDoCliente) {
                const faturaMessage = `*Detalhes da sua fatura:*\n\n` +
                                     `👤 Cliente: ${faturaDoCliente.cliente || 'Não informado'}\n` +
                                     `📦 Produto: ${faturaDoCliente.produto || 'Não informado'}\n` + 
                                     `💰 Valor: ${faturaDoCliente.valor || 'Não informado'}\n` +
                                     `📅 Vencimento: ${faturaDoCliente.vencimento || 'Não informado'}\n` +
                                     `✅ Status: ${faturaDoCliente.status || 'Não informado'}\n\n` +
                                     `*Para pagar via PIX, use a chave abaixo:*\n` +
                                     `🔑 Chave PIX: *${faturaDoCliente.chave_pix || 'N/A'}*\n\n` +
                                     `Qualquer dúvida, entre em contato!`;
                
                await sendMessageWithTyping(chat, from, faturaMessage, 1000, 1000);
                console.log(`Fatura encontrada e enviada para ${normalizedClientNumber}.`);
            } else {
                await sendMessageWithTyping(chat, from, 'Não encontramos uma fatura pendente para o seu número. Se precisar de ajuda, fale com um atendente.', 1000, 1000);
                console.log(`Nenhuma fatura encontrada para ${normalizedClientNumber}.`);
            }

        } else {
            console.error('Padrão de faturas não encontrado no script da URL.');
            await sendMessageWithTyping(chat, from, 'Ocorreu um problema ao buscar as informações da fatura. Por favor, tente novamente mais tarde.', 1000, 1000);
        }

    } catch (error) {
        console.error('Erro ao buscar ou processar dados da fatura da URL:', url, error.message);
        return 'Ocorreu um erro ao tentar carregar as informações da sua fatura. Por favor, tente novamente mais tarde.';
    }
}


// --- Estrutura de Respostas do Menu (Focada em IPTV) ---
const menuResponses = {
    'initial': {
        messages: (name) => `Olá! ${name}, seja bem-vindo(a) ao atendimento de IPTV. Como posso te ajudar hoje? Digite uma das opções abaixo:\n\n1 - Como funciona o IPTV?\n2 - Quais são os planos e preços?\n3 - Benefícios do nosso serviço\n4 - Como assinar?\n5 - Outras perguntas\n6 - Notificações de Vencimento (Próximo)\n7 - Consultar Minha Fatura\n8 - Notificar Clientes Bloqueados (Vencidos)` 
    },
    '1': {
        messages: [
            'Nosso serviço de IPTV oferece acesso a milhares de canais, filmes e séries diretamente pela internet, sem necessidade de antena. Você pode assistir em diversos aparelhos, como Smart TVs, celulares, tablets e TV Box, de forma simples e rápida!\n\nOferecemos conteúdo em alta qualidade e estabilidade para você e sua família.'
        ]
    },
    '2': {
        messages: [
            '*Confira nossos planos de IPTV:*\n\n📺 *Plano 1 Tela:* R$25,00 por mês\n_Assista em um dispositivo por vez_\n\n📺📺 *Plano 2 Telas:* R$45,00 por mês\n_Assista em até dois dispositivos simultaneamente_\n\n🗓️ *Plano Anual 1 Tela:* R$285,00\n_Pague uma vez e tenha acesso por 12 meses em uma tela, com desconto especial!_\n\nPara mais detalhes ou planos personalizados, fale com nosso atendente!'
        ]
    },
    '3': {
        messages: [
            '*Benefícios de assinar nosso IPTV:*\n\n✅ *Variedade:* Milhares de canais, filmes e séries atualizados.\n✅ *Qualidade:* Conteúdo em HD, Full HD e 4K.\n✅ *Estabilidade:* Servidores dedicados para uma experiência sem travamentos.\n✅ *Suporte:* Atendimento rápido para qualquer dúvida ou problema.\n✅ *Compatibilidade:* Assista onde quiser, em diversos dispositivos.\n\nTransforme sua forma de assistir TV!'
        ]
    },
    '4': {
        messages: [
            'É muito fácil assinar nosso serviço de IPTV!\n\n1. *Escolha seu plano:* Decida entre Plano 1 Tela, 2 Telas ou o Anual.\n2. *Entre em contato:* Fale com nosso atendente para finalizar a contratação e receber as instruções de acesso.\n3. *Aproveite:* Em poucos minutos, você estará assistindo ao melhor conteúdo!\n\nPronto para começar? Nos envie uma mensagem para finalizar a assinatura!'
        ]
    },
    '5': {
        messages: [
            'Se você tiver outras dúvidas ou precisar de mais informações, por favor, fale com um de nossos atendentes. Eles estão prontos para te ajudar!'
        ]
    },
    '6': { 
        messages: ['Iniciando o envio das notificações de Vencimento de IPTV (próximos dias). Por favor, aguarde...'],
        action: async (chat, from) => {
            const url = 'https://tecnoarte.icu/painelzap/vencimentos.js';
            const processingResult = await fetchAndProcessVencimentos(url);
            console.log(`Processamento manual de vencimentos (próximos) solicitado por ${from}:`, processingResult);

            await sendMessageWithTyping(chat, from, 'Processo de notificações de vencimento concluído. As mensagens devidas foram enviadas. Digite "menu" para ver as opções novamente.', 1000, 1000);

            try {
                const contact = await client.getContactById(from); 
                const contactName = contact.pushname || contact.number;
                const notificationToAdmin = `✅ O cliente *${contactName}* (${from.replace('@c.us', '')}) ativou a opção 'Notificações de Vencimento' no bot.`;
                await client.sendMessage(ADMIN_NUMBER, notificationToAdmin);
                console.log(`Notificação de ativação da Opção 6 enviada para o administrador: ${contactName}`);
            } catch (error) {
                console.error(`Erro ao enviar notificação da Opção 6 para o admin:`, error);
            }
        }
    },
    '7': { 
        messages: ['Você escolheu consultar sua fatura.'],
        action: async (chat, from) => {
            await consultClientFatura(from, chat, from);
            await sendMessageWithTyping(chat, from, 'Consulta de fatura concluída. Digite "menu" para ver as opções novamente.', 1000, 1000);
        }
    },
    '8': { 
        messages: ['Iniciando o envio das notificações para clientes com planos vencidos e bloqueados. Por favor, aguarde...'],
        action: async (chat, from) => {
            const urlBloqueados = 'https://tecnoarte.icu/painelzap/vencidos_bloqueados.js';
            const processingResult = await fetchAndProcessBloqueados(urlBloqueados); 
            console.log(`Processamento manual de bloqueados solicitado por ${from}:`, processingResult);

            await sendMessageWithTyping(chat, from, 'Processo de notificações de bloqueio concluído. As mensagens devidas foram enviadas. Digite "menu" para ver as opções novamente.', 1000, 1000);
            
            try {
                const contact = await client.getContactById(from); 
                const contactName = contact.pushname || contact.number;
                const notificationToAdmin = `✅ O cliente *${contactName}* (${from.replace('@c.us', '')}) ativou a opção 'Notificar Clientes Bloqueados' no bot.`;
                await client.sendMessage(ADMIN_NUMBER, notificationToAdmin);
                console.log(`Notificação de ativação da Opção 8 enviada para o administrador: ${contactName}`);
            } catch (error) {
                console.error(`Erro ao enviar notificação da Opção 8 para o admin:`, error);
            }
        }
    }
};

// --- Lógica Principal de Processamento de Mensagens Recebidas ---
client.on('message', async msg => {
    console.log(`Mensagem recebida de ${msg.from} (${msg.type}): "${msg.body}"`);
    const chat = await msg.getChat(); 

    // --- Lógica específica para GRUPOS ou contatos especiais ---
    // Removido o 'return;' para permitir que a mensagem continue a ser processada
    // Se quiser ignorar completamente mensagens de grupo para a lógica do menu, descomente o 'return;'
    if (!msg.from.endsWith('@c.us')) {
        console.log(`Mensagem recebida de GRUPO ou contato especial: ${msg.from} (${msg.type}): "${msg.body}" - Processando (se houver lógica para isso).`);
        // Se você quiser que o bot não faça NADA em grupos, descomente a linha abaixo:
        // return; 
    }

    // --- Notificação de atendimento iniciado para o administrador ---
    if (!recentContacts.has(msg.from)) {
        try {
            const contact = await msg.getContact();
            const contactName = contact.pushname ? contact.pushname.split(" ")[0] : contact.number; 

            const notificationMessage = `🤖 Novo atendimento iniciado por *${contactName}* (${msg.from.replace('@c.us', '')}) no bot.`;
            
            await client.sendMessage(ADMIN_NUMBER, notificationMessage);
            console.log(`Notificação de novo atendimento enviada para o administrador: ${contactName}`);
            
            recentContacts.add(msg.from); 
            setTimeout(() => {
                recentContacts.delete(msg.from);
                console.log(`Contato ${msg.from} removido da lista de recentes.`);
            }, 300000); // 5 minutos (300.000 milissegundos)
        } catch (error) {
            console.error(`Erro ao enviar notificação de novo atendimento para o admin:`, error);
        }
    }
    

    // 1. **Comando `!reiniciar`**: Processa o comando para reiniciar o bot.
    if (msg.body === '!reiniciar') {
        console.log('Comando !reiniciar detectado.');
        await sendMessageWithTyping(chat, msg.from, 'Reiniciando o bot... Por favor, aguarde.', 1000, 1000);
        restartRequester = msg.from; 
        try {
            await client.destroy(); 
            console.log('Sessão destruída. Inicializando novamente...');
            sentVencimentoIds.clear(); 
            sentBloqueioIds.clear(); 
            sentCustomMessageIds.clear(); // Limpa IDs de mensagens customizadas
            recentContacts.clear(); 
            await client.initialize(); 
        } catch (error) {
            console.error('Erro ao tentar reiniciar o bot:', error);
            await sendMessageWithTyping(chat, msg.from, 'Ocorreu um erro ao tentar reiniciar o bot.', 1000, 1000);
            restartRequester = null; 
        }
        return; 
    }

    // 2. **Comando `!limpar`**: Limpa o arquivo de mensagens customizadas.
    if (msg.body === '!limpar') {
        console.log('Comando !limpar detectado.');
        await sendMessageWithTyping(chat, msg.from, 'Limpando o arquivo de mensagens customizadas...', 1000, 1000);
        try {
            // CORREÇÃO AQUI: URL agora aponta para 'enviar.php'
            await axios.get('https://tecnoarte.icu/painelzap/enviar.php?clear=true');
            sentCustomMessageIds.clear(); // Limpa também o set local
            await sendMessageWithTyping(chat, msg.from, 'Arquivo de mensagens customizadas limpo com sucesso!', 1000, 1000);
            console.log('Comando !limpar executado: arquivo mensagens_custom.js limpo.');
        } catch (error) {
            console.error('Erro ao executar comando !limpar:', error.message);
            await sendMessageWithTyping(chat, msg.from, 'Ocorreu um erro ao tentar limpar o arquivo de mensagens customizadas. Verifique as permissões do servidor.', 1000, 1000);
        }
        return; 
    }

    // 3. **Lógica para o menu inicial**: Responde a palavras-chave de saudação ou "menu".
    if (msg.body.match(/(menu|Menu|dia|tarde|noite|oi|Oi|Olá|olá|ola|Ola)/i)) {
        console.log('Detectada palavra-chave inicial do menu.');
        const contact = await msg.getContact();
        const name = contact.pushname ? contact.pushname.split(" ")[0] : contact.number; 

        await sendMessageWithTyping(chat, msg.from, menuResponses.initial.messages(name), 3000, 3000);
        return; 
    }

    // 4. **Lógica para as opções numéricas**: Responde a números (1-8) do menu.
    if (menuResponses[msg.body]) {
        console.log(`Detectada opção numérica: ${msg.body}`);
        const optionData = menuResponses[msg.body];

        for (const messageText of optionData.messages) {
            await sendMessageWithTyping(chat, msg.from, messageText, 3000, 3000);
        }

        if (optionData.link) { 
            await sendMessageWithTyping(chat, msg.from, 'Link para cadastro: ' + optionData.link, 3000, 3000);
        }

        if (optionData.action && typeof optionData.action === 'function') {
            await optionData.action(chat, msg.from);
        }

        return; 
    }

    // 5. **Lógica para mensagens que o bot não entende**: Responde quando a mensagem não se encaixa em nenhuma lógica anterior.
    console.log('Mensagem não reconhecida pelo bot. Sugerindo opções.');
    await sendMessageWithTyping(chat, msg.from, 'Desculpe, não entendi. Por favor, digite um número de 1 a 8 para escolher uma opção ou digite "menu" para ver as opções novamente.', 3000, 3000);
});