  // Конфигурация (читаем из Script Properties)
  const SCRIPT_PROPS = PropertiesService.getScriptProperties();
  const BOT_TOKEN = SCRIPT_PROPS.getProperty('BOT_TOKEN');
  const FOLDER_ID = SCRIPT_PROPS.getProperty('FOLDER_ID');
  const ADMIN_IDS = (SCRIPT_PROPS.getProperty('ADMIN_IDS') || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id);
  const SCRIPT_URL = SCRIPT_PROPS.getProperty('SCRIPT_URL');

  // Дедупликация должна быть ПЕРСИСТЕНТНОЙ: Apps Script может обрабатывать doPost
  // в разных процессах, поэтому "память" между вызовами не сохраняется.
  // Важно: нельзя полагаться на "last update_id", если Telegram шлет апдейты параллельно
  // (max_connections > 1) — возможны гонки и "пропуски" команд.
  const UPDATE_CACHE_PREFIX = 'upd:';
  const UPDATE_CACHE_TTL_SECONDS = 60 * 60 * 6; // 6 часов

  // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

  function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (!BOT_TOKEN) return null;
    
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    };
    
    if (replyMarkup) payload.reply_markup = replyMarkup;
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    try {
      const response = UrlFetchApp.fetch(url, options);
    const status = response.getResponseCode();
    const body = response.getContentText();
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      console.error('❌ Telegram ответ не JSON:', { status, body: body.slice(0, 500) });
      return null;
    }
    if (!parsed || parsed.ok !== true) {
      console.error('❌ Telegram sendMessage ошибка:', {
        status,
        chatId,
        error: parsed && parsed.description ? parsed.description : 'unknown',
        payloadPreview: String(text).slice(0, 200)
      });
    }
    return parsed;
    } catch (error) {
      console.error('❌ Ошибка отправки:', error);
      return null;
    }
  }

  function answerCallbackQuery(callbackQueryId, text = null) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`;
    const payload = {
      callback_query_id: callbackQueryId
    };
    
    if (text) {
      payload.text = text;
      payload.show_alert = true;
    }
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    try {
      UrlFetchApp.fetch(url, options);
    } catch (error) {
      console.error('❌ Ошибка answerCallbackQuery:', error);
    }
  }

  function isAdmin(userId) {
    return ADMIN_IDS.includes(userId.toString());
  }

  // ==================== ОЧЕНЬ ПРОСТАЯ ДЕДУПЛИКАЦИЯ ====================

  function isUpdateProcessed(updateId) {
    if (updateId === undefined || updateId === null) return false;

    // Дедуп только по ключу конкретного update_id (переживает рестарты и не "пропускает"
    // сообщения при параллельной доставке).
    try {
      const cache = CacheService.getScriptCache();
      const cached = cache.get(UPDATE_CACHE_PREFIX + String(updateId));
      return cached === '1';
    } catch (e) {
      // Cache может быть недоступен/очищен — не считаем это ошибкой
      return false;
    }
  }

  function markUpdateProcessed(updateId) {
    if (updateId === undefined || updateId === null) return;

    // Кладем в кэш (TTL) для дедупликации
    try {
      const cache = CacheService.getScriptCache();
      cache.put(UPDATE_CACHE_PREFIX + String(updateId), '1', UPDATE_CACHE_TTL_SECONDS);
    } catch (e) {
      // Игнорируем ошибки кэша
    }
  }

function unmarkUpdateProcessed(updateId) {
  if (updateId === undefined || updateId === null) return;
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(UPDATE_CACHE_PREFIX + String(updateId));
  } catch (e) {
    // Игнорируем ошибки кэша
  }
}

  // ==================== ОБРАБОТКА КОМАНД ====================

  function handleStartCommand(chatId, userId, userName) {
    const message = `🎉 *Привет, ${userName || 'друг'}!*\n\n` +
                    'Я бот для сбора отчетов из Google Таблиц.\n\n' +
                    '*Доступные команды:*\n' +
                    '📊 /reports - Отчеты за неделю\n' +
                    '📅 /today - Отчеты за сегодня\n' +
                    '🆘 /help - Справка\n' +
                    '🏓 /ping - Проверка связи\n\n' +
                    'Для работы с отчетами нужны права администратора.';
    
    return sendTelegramMessage(chatId, message);
  }

  function handleHelpCommand(chatId) {
    const message = '📚 *Справка по командам*\n\n' +
                    '*Основные команды:*\n' +
                    '/start - Начать работу с ботом\n' +
                    '/reports - Отчеты за неделю (только админы)\n' +
                    '/today - Отчеты за сегодня (только админы)\n' +
                    '/ping - Проверка работоспособности\n' +
                    '/help - Эта справка\n\n' +
                    'Бот сканирует Google Таблицы и собирает данные.';
    
    return sendTelegramMessage(chatId, message);
  }

  function handleReportsCommand(chatId, userId) {
    if (!isAdmin(userId)) {
      return sendTelegramMessage(chatId, '❌ У вас нет прав для выполнения этой команды.');
    }
    
    sendTelegramMessage(chatId, '⏳ Собираю отчеты за последние 7 дней...');
    
    try {
      const reports = collectReports(7);
      
      if (reports.length === 0) {
        return sendTelegramMessage(chatId, '📭 Отчетов за последние 7 дней не найдено.');
      }
      
      const message = `📊 *Найдено отчетов: ${reports.length}*\n\n` +
                      reports.slice(0, 5).map((report, index) => 
                        `${index + 1}. ${report.name || 'Без названия'}\n` +
                        `   📅 ${formatDate(report.lastUpdated)}\n` +
                        `   👤 ${report.author || 'Автор не указан'}`
                      ).join('\n\n');
      
      if (reports.length > 5) {
        sendTelegramMessage(chatId, message + `\n\n...и еще ${reports.length - 5} отчетов`);
      } else {
        sendTelegramMessage(chatId, message);
      }
      
    } catch (error) {
      console.error('❌ Ошибка сбора отчетов:', error);
      sendTelegramMessage(chatId, '❌ Произошла ошибка при сборе отчетов.');
    }
  }

  function handleTodayCommand(chatId, userId) {
    if (!isAdmin(userId)) {
      return sendTelegramMessage(chatId, '❌ У вас нет прав для выполнения этой команды.');
    }
    
    sendTelegramMessage(chatId, '⏳ Собираю отчеты за сегодня...');
    
    try {
      const reports = collectReports(1);
      
      if (reports.length === 0) {
        return sendTelegramMessage(chatId, '📭 Отчетов за сегодня не найдено.');
      }
      
      const message = `📅 *Отчеты за сегодня*\n` +
                      `Найдено: ${reports.length} отчетов\n\n` +
                      reports.map((report, index) => 
                        `${index + 1}. ${report.name || 'Без названия'}\n` +
                        `   📅 ${formatDate(report.lastUpdated)}\n` +
                        `   👤 ${report.author || 'Неизвестно'}`
                      ).join('\n\n');
      
      sendTelegramMessage(chatId, message);
      
    } catch (error) {
      console.error('❌ Ошибка сбора отчетов:', error);
      sendTelegramMessage(chatId, '❌ Произошла ошибка.');
    }
  }

  function handlePingCommand(chatId) {
    const now = new Date();
    const message = `🏓 *Pong!*\n\n` +
                    `✅ Бот работает исправно\n` +
                    `🕐 Время сервера: ${now.toLocaleString('ru-RU')}\n` +
                    `📡 Статус: Online`;
    
    return sendTelegramMessage(chatId, message);
  }

  // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

  function formatDate(dateString) {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return 'дата неизвестна';
    }
  }

  function collectReports(days = 7) {
    if (!FOLDER_ID) return [];
    
    try {
      const folder = DriveApp.getFolderById(FOLDER_ID);
      if (!folder) return [];
      
      const reports = [];
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      const files = folder.getFiles();
      
      while (files.hasNext()) {
        const file = files.next();
        
        if (file.getMimeType() === 'application/vnd.google-apps.spreadsheet') {
          const lastUpdated = file.getLastUpdated();
          
          if (lastUpdated >= cutoffDate) {
            reports.push({
              name: file.getName(),
              url: file.getUrl(),
              lastUpdated: lastUpdated.toISOString(),
              author: file.getOwner() ? file.getOwner().getName() : 'Неизвестно'
            });
          }
        }
      }
      
      // Сортируем по дате (сначала новые)
      reports.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
      
      return reports;
      
    } catch (error) {
      console.error('❌ Ошибка в collectReports:', error);
      return [];
    }
  }

  // ==================== ОСНОВНАЯ ФУНКЦИЯ doPost ====================

  function doPost(e) {
    // ВАЖНО: Сначала создаем ответ
    const response = ContentService.createTextOutput('OK');
    
  let updateId = null;
  
    try {
      // Проверяем наличие данных
      if (!e || !e.postData || !e.postData.contents) {
        console.log('❌ Нет данных в запросе');
        return response;
      }
      
      const contents = e.postData.contents;
      console.log('📨 Получен запрос, длина:', contents.length, 'символов');
      
      const update = JSON.parse(contents);
      
      // Дедупликация по update_id
    updateId = update.update_id;
      console.log('🆔 Update ID:', updateId);
      
      if (isUpdateProcessed(updateId)) {
        console.log('⏭️ Уже обработан, пропускаем');
        return response;
      }
      
      // Обработка сообщения
      if (update.message) {
        const message = update.message;
        const chatId = message.chat.id;
        const text = (message.text || '').trim();
        const userId = message.from.id;
        const userName = message.from.first_name || 'Пользователь';
        
        console.log(`👤 ${userName}: ${text}`);
      console.log('ℹ️ chatId/userId:', chatId, userId);
        
        // Убираем упоминание бота если есть
        let command = text.split(' ')[0].toLowerCase();
        if (command.includes('@')) {
          command = command.split('@')[0];
        }
        
        // Обработка команд
        switch (command) {
          case '/start':
          console.log('➡️ handle /start');
            handleStartCommand(chatId, userId, userName);
            break;
            
          case '/help':
          console.log('➡️ handle /help');
            handleHelpCommand(chatId);
            break;
            
          case '/reports':
          console.log('➡️ handle /reports');
            handleReportsCommand(chatId, userId);
            break;
            
          case '/today':
          console.log('➡️ handle /today');
            handleTodayCommand(chatId, userId);
            break;
            
          case '/ping':
          console.log('➡️ handle /ping');
            handlePingCommand(chatId);
            break;
            
          default:
            if (text.startsWith('/')) {
              sendTelegramMessage(chatId, '🤔 Неизвестная команда. Используйте /help');
            } else {
              sendTelegramMessage(chatId, '🤖 Я понимаю только команды. Отправьте /start');
            }
        }
      }
      
      // Обработка callback запросов
      else if (update.callback_query) {
        answerCallbackQuery(update.callback_query.id);
      }

    // Помечаем как успешно обработанный только после обработки
    markUpdateProcessed(updateId);
      
    } catch (error) {
      console.error('❌ Критическая ошибка в doPost:', error);
      console.error('📄 Стек:', error.stack);
    
    // Если упали в процессе — снимаем метку, чтобы Telegram ретраем смог повторить
    if (updateId !== null) {
      unmarkUpdateProcessed(updateId);
    }

    // Пушим краткую ошибку админу (чтобы не лазить в Executions)
    try {
      const adminChatId = ADMIN_IDS && ADMIN_IDS[0] ? ADMIN_IDS[0] : null;
      if (adminChatId) {
        sendTelegramMessage(
          adminChatId,
          '❌ *Ошибка в doPost*\n' +
            `Update ID: \`${String(updateId)}\`\n` +
            `Сообщение: \`${String(error && error.message ? error.message : error).slice(0, 200)}\``
        );
      }
    } catch (e) {
      // ignore
    }
      
      // ВСЕГДА возвращаем OK даже при ошибке
      return response;
    }
    
    return response;
  }

  // ==================== УТИЛИТЫ ====================

  function setupBot() {
    console.log('🔧 Настройка вебхука...');
    
    if (!BOT_TOKEN) {
      console.log('❌ BOT_TOKEN не установлен');
      return false;
    }
    
    if (!SCRIPT_URL) {
      console.log('❌ SCRIPT_URL не установлен');
      return false;
    }
    
    // Сначала удаляем старый вебхук и сбрасываем очередь апдейтов
    // drop_pending_updates=true убирает "хвост" из Telegram, чтобы не прилетели
    // старые / дублирующиеся апдейты после переустановки вебхука.
    const deleteUrl = `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`;
    try {
      const deleteResponse = UrlFetchApp.fetch(deleteUrl);
      const deleteResult = JSON.parse(deleteResponse.getContentText());
      console.log('🗑️ Старый вебхук удален:', deleteResult.ok ? 'OK' : 'Ошибка');
    } catch (error) {
      console.log('⚠️ Не удалось удалить вебхук:', error.message);
    }
    
    try {
      // Устанавливаем новый вебхук через POST (без проблем с URL-экранированием)
      const setUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;
      const response = UrlFetchApp.fetch(setUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          url: SCRIPT_URL,
          // max_connections=1 уменьшает параллелизм и риск гонок/таймаутов в Apps Script
          max_connections: 1,
          allowed_updates: ['message', 'callback_query']
        }),
        muteHttpExceptions: true
      });
      const result = JSON.parse(response.getContentText());
      
      if (result.ok) {
        console.log(`✅ Вебхук установлен: ${SCRIPT_URL}`);
        
        // Проверяем статус
        const checkUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
        const checkResponse = UrlFetchApp.fetch(checkUrl);
        const checkResult = JSON.parse(checkResponse.getContentText());
        
        console.log('📊 Информация о вебхуке:');
        console.log('URL:', checkResult.result.url);
        console.log('Ожидающих обновлений:', checkResult.result.pending_update_count);
        
      } else {
        console.log(`❌ Ошибка: ${result.description}`);
      }
      
      return result.ok;
      
    } catch (error) {
      console.log(`❌ Ошибка сети: ${error.message}`);
      return false;
    }
  }

  // Разовая очистка "хвоста" апдейтов в Telegram
  function dropPendingUpdates() {
    if (!BOT_TOKEN) {
      console.log('❌ BOT_TOKEN не установлен');
      return;
    }
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`;
    const resp = UrlFetchApp.fetch(url);
    console.log('🧹 drop_pending_updates:', resp.getContentText());
  }

  function testBot() {
    console.log('🧪 Тестирование...');
    
    const checks = [
      { name: 'BOT_TOKEN', valid: !!BOT_TOKEN },
      { name: 'FOLDER_ID', valid: !!FOLDER_ID },
      { name: 'ADMIN_IDS', valid: ADMIN_IDS.length > 0 },
      { name: 'SCRIPT_URL', valid: !!SCRIPT_URL }
    ];
    
    checks.forEach(check => {
      console.log(check.valid ? `✅ ${check.name}` : `❌ ${check.name}`);
    });
    
    console.log('✅ Тест завершен');
  }

  // ==================== БЫСТРАЯ НАСТРОЙКА ====================

  function initialize() {
    console.log('🚀 Начальная настройка...');
    
    // 1. Установите параметры в Script Properties
    /*
    const props = {
      'BOT_TOKEN': 'ВАШ_ТОКЕН',
      'FOLDER_ID': 'ID_ПАПКИ',
      'ADMIN_IDS': 'ВАШ_ТЕЛЕГРАМ_ID',
      'SCRIPT_URL': 'ВАШ_URL_ВЕБ_ПРИЛОЖЕНИЯ'
    };
    
    PropertiesService.getScriptProperties().setProperties(props);
    console.log('✅ Параметры установлены');
    */
    
    // 2. Проверка
    testBot();
    
    // 3. Установка вебхука
    const success = setupBot();
    
    if (success && ADMIN_IDS[0]) {
      sendTelegramMessage(ADMIN_IDS[0], 
        '🤖 Бот настроен!\n' +
        `Время: ${new Date().toLocaleString('ru-RU')}\n` +
        'Используйте /ping для проверки.'
      );
    }
    
    console.log('✅ Настройка завершена');
  }

  // Тест отправки сообщения
  function testSend() {
    if (!ADMIN_IDS[0]) return;
    
    sendTelegramMessage(ADMIN_IDS[0], 
      '🧪 Тест\n' +
      `Время: ${new Date().toLocaleString('ru-RU')}\n` +
      'Это тестовое сообщение.'
    );
  }




  // Добавьте эту функцию и выполните ее
  function clearWebhookErrors() {
    console.log('🧹 Очистка ошибок вебхука...');
    
    if (!BOT_TOKEN) {
      console.log('❌ BOT_TOKEN не установлен');
      return;
    }
    
    // 1. Удаляем вебхук полностью
    const deleteUrl = `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`;
    try {
      const deleteResponse = UrlFetchApp.fetch(deleteUrl);
      const deleteResult = JSON.parse(deleteResponse.getContentText());
      console.log('🗑️ Вебхук удален:', deleteResult.ok ? 'OK' : 'Ошибка');
    } catch (error) {
      console.log('❌ Ошибка удаления:', error.message);
    }
    
    // 2. Ждем 2 секунды
    Utilities.sleep(2000);
    
    // 3. Устанавливаем вебхук с параметрами
    const setUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook` +
      `?url=${encodeURIComponent(SCRIPT_URL)}` +
      `&max_connections=10` +
      `&allowed_updates=["message","callback_query"]`;
    
    try {
      const response = UrlFetchApp.fetch(setUrl);
      const result = JSON.parse(response.getContentText());
      
      if (result.ok) {
        console.log(`✅ Вебхук установлен`);
      } else {
        console.log(`❌ Ошибка: ${result.description}`);
      }
    } catch (error) {
      console.log(`❌ Сетевая ошибка: ${error.message}`);
    }
    
    // 4. Проверяем статус
    Utilities.sleep(1000);
    checkWebhookStatus();
  }

  function checkWebhookStatus() {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
    const response = UrlFetchApp.fetch(url);
    const result = JSON.parse(response.getContentText());
    
    console.log('📊 Статус вебхука:');
    console.log('URL:', result.result.url);
    console.log('Ожидающих обновлений:', result.result.pending_update_count);
    console.log('Последняя ошибка:', result.result.last_error_message || 'нет');
    if (result.result.last_error_date) {
      const date = new Date(result.result.last_error_date * 1000);
      console.log('Дата ошибки:', date.toLocaleString('ru-RU'));
    }
  }
