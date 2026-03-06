# 🌌 SpinerNET — VPN Client

> Современный VPN клиент для Windows с поддержкой всех протоколов.
> Стиль: тёмный космос. Без компромиссов.

---

## 🚀 Быстрый запуск (Development)

### Требования
- **Node.js** v18+ → https://nodejs.org
- **npm** (идёт вместе с Node.js)
- **Windows 10/11** (для полноценной работы)

### Шаги

```bash
# 1. Перейди в папку проекта
cd spinernet

# 2. Установи зависимости
npm install

# 3. Запусти приложение
npm start
```

Готово! Приложение откроется.

---

## 📦 Сборка .exe для Windows

```bash
# Установи зависимости (если ещё не)
npm install

# Собери portable .exe или installer
npm run build
```

После сборки файлы будут в папке `dist/`:
- `SpinerNET Setup x.x.x.exe` — установщик (NSIS)
- `SpinerNET x.x.x.exe` — portable версия

---

## 🛠️ Структура проекта

```
spinernet/
├── main.js           ← Electron main process (логика окна, VPN, IPC)
├── preload.js        ← Безопасный мост renderer ↔ main
├── package.json      ← Зависимости и скрипты
└── renderer/
    ├── index.html    ← Главный UI
    ├── css/
    │   └── app.css   ← Весь стиль (тёмный космос)
    └── js/
        └── app.js    ← Вся логика UI
```

---

## 📡 Поддерживаемые протоколы

| Протокол | Статус | Описание |
|----------|--------|----------|
| VMess | ✅ | V2Ray стандарт, поддержка WS/gRPC/h2 |
| VLESS | ✅ | Lightweight, поддержка Reality, XTLS |
| Trojan | ✅ | Маскировка под HTTPS |
| Shadowsocks | ✅ | SS/SS2022, AEAD шифрование |
| Hysteria2 | ✅ | QUIC-based, высокая скорость |
| TUIC | ✅ | QUIC-based, низкая задержка |
| ShadowsocksR | ✅ (import) | Legacy SSR |
| WireGuard | ✅ (import) | Fast VPN протокол |

---

## 🔑 Как добавить серверы

### Способ 1: Subscription Link
1. Перейди в **Subscriptions**
2. Вставь URL подписки (например: `https://your-provider.com/sub?token=xxx`)
3. Нажми **Add** → серверы загрузятся автоматически

### Способ 2: Import Config Keys
1. **Subscriptions → Import Config Keys**
2. Вставь ключи (по одному на строку):
```
vmess://eyJhZGQiOiIxMjMuNDU2Ljc4LjkiLCJwb3J0IjoiNDQzIi4uLn0=
vless://uuid@server.com:443?type=ws&security=tls&sni=server.com#MyServer
trojan://password@server.com:443?sni=server.com#Trojan
ss://aes-256-gcm:password@server.com:8388#SS
hysteria2://auth@server.com:443?sni=server.com#Hy2
```
3. Нажми **Import**

### Способ 3: Clipboard
- Скопируй ключи → нажми **Import Clipboard** на странице Servers

### Способ 4: Вручную
- **Servers → Add Server** → заполни форму для нужного протокола

---

## ⚙️ Интеграция с реальным ядром (Xray / sing-box)

Для реального VPN подключения нужно:

1. Скачать **Xray-core** или **sing-box**:
   - Xray: https://github.com/XTLS/Xray-core/releases
   - sing-box: https://github.com/SagerNet/sing-box/releases

2. Положить `xray.exe` или `sing-box.exe` в папку:
   ```
   spinernet/bin/xray.exe
   spinernet/bin/sing-box.exe
   ```

3. В `main.js` найти функцию `connectVPN()` и заменить симуляцию:
   ```javascript
   function connectVPN(config) {
     // Генерируй JSON конфиг для xray/sing-box из config
     const configPath = path.join(DATA_DIR, 'runtime.json');
     fs.writeFileSync(configPath, JSON.stringify(generateXrayConfig(config)));
     
     vpnProcess = spawn(path.join(__dirname, 'bin/xray.exe'), [
       'run', '-config', configPath
     ]);
     
     // ... обработка stdout/stderr
   }
   ```

---

## 🎨 Кастомизация

### Цвета (CSS переменные в `renderer/css/app.css`):
```css
:root {
  --purple: #a855f7;    /* Основной акцент */
  --green: #10b981;     /* Connected / успех */
  --amber: #f59e0b;     /* Предупреждения */
  --red: #ef4444;       /* Ошибки / disconnect */
  --bg-base: #07070d;   /* Основной фон */
}
```

---

## 📋 npm команды

| Команда | Действие |
|---------|---------|
| `npm start` | Запустить приложение |
| `npm run dev` | Запустить с DevTools |
| `npm run build` | Собрать для Windows |
| `npm run build:all` | Собрать для всех платформ |

---

## 🐛 Решение проблем

**Приложение не запускается:**
```bash
# Удали node_modules и переустанови
rm -rf node_modules
npm install
npm start
```

**Ошибка при сборке:**
```bash
npm install --save-dev electron-builder
npm run build
```

**Electron не найден:**
```bash
npm install --save-dev electron
```

---

Made with 🌌 by SpinerNET
