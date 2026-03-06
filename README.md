<div align="center">

<img src="renderer/assets/icon.png" width="120" alt="SpinerNET Logo" />

# SpinerNET

**Современный VPN-клиент для Windows на базе Xray-core**

[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue?style=flat-square&logo=windows)](https://github.com/misterdengi/spinernet/releases)
[![Electron](https://img.shields.io/badge/Electron-28-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![Xray-core](https://img.shields.io/badge/Core-Xray--core-blueviolet?style=flat-square)](https://github.com/XTLS/Xray-core)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/misterdengi/spinernet?style=flat-square)](https://github.com/misterdengi/spinernet/releases/latest)

[**Скачать**](#-установка) · [Поддерживаемые протоколы](#-протоколы) · [Как использовать](#-как-добавить-серверы)

</div>

---

## ✨ Возможности

- 🔒 **Поддержка всех актуальных протоколов** — VMess, VLESS, Trojan, Shadowsocks, Hysteria2, TUIC, WireGuard
- 📋 **Subscription-ссылки** — автообновление серверов по URL подписки
- 📥 **Импорт из буфера обмена** — вставь ключи одной кнопкой
- 🖥️ **Системный трей** — приложение живёт в трее, не мешает работе
- 🌑 **Тёмный UI** — минималистичный дизайн без лишнего
- ⚡ **Встроенный Xray-core** — не нужно ничего скачивать отдельно

---

## 📦 Установка

Перейди в [**Releases**](https://github.com/misterdengi/spinernet/releases/latest) и скачай:

| Файл | Описание |
|------|----------|
| `SpinerNET Setup x.x.x.exe` | Установщик |

> **Примечание:** Windows SmartScreen может предупредить при запуске — нажми «Подробнее → Всё равно запустить». Это стандартное поведение для неподписанных приложений.

---

## 📡 Протоколы

| Протокол | Статус | Описание |
|----------|:------:|----------|
| VLESS | ✅ | Поддержка Reality, XTLS, WS, gRPC |
| VMess | ✅ | V2Ray-стандарт, WS / gRPC / h2 |
| Trojan | ✅ | Маскировка под HTTPS трафик |
| Shadowsocks | ✅ | SS / SS2022, AEAD-шифрование |
| Hysteria2 | ✅ | QUIC, высокая скорость |
| TUIC | ✅ | QUIC, низкая задержка |
| ShadowsocksR | ✅ | Импорт SSR-ключей |
| WireGuard | ✅ | Импорт WG-конфигов |

---

## 🚀 Как добавить серверы

### Способ 1 — Subscription URL
1. Открой вкладку **Subscriptions**
2. Вставь ссылку от своего провайдера
3. Нажми **Add** → серверы загрузятся автоматически

### Способ 2 — Импорт ключей
Поддерживаются ключи в форматах:
```
vless://uuid@host:443?type=ws&security=tls#MyServer
vmess://base64encoded...
trojan://pass@host:443?sni=host.com#Trojan
ss://method:pass@host:8388#SS
hysteria2://auth@host:443?sni=host.com#Hy2
```
Вставь их в **Subscriptions → Import Config Keys** (по одному на строку) и нажми **Import**.

### Способ 3 — Буфер обмена
Скопируй ключи → нажми **Import Clipboard** на странице серверов.

---

## 🛠️ Сборка из исходников

### Требования
- **Node.js** v18+ — [nodejs.org](https://nodejs.org)
- **Windows 10 / 11**

```bash
# Клонировать репозиторий
git clone https://github.com/misterdengi/spinernet.git
cd spinernet

# Установить зависимости
npm install

# Запустить в режиме разработки
npm start

# Или собрать установщик
npm run build
```

Готовые файлы появятся в папке `dist/`.

### Структура проекта

```
spinernet/
├── main.js              ← Main process: окно, VPN-логика, IPC
├── preload.js           ← Безопасный мост renderer ↔ main
├── package.json
├── bin/
│   ├── xray.exe         ← Xray-core (включён в установщик)
│   └── wintun.dll
└── renderer/
    ├── index.html
    ├── css/app.css      ← Стили
    └── js/app.js        ← Логика UI
```

---

## ⚙️ Настройка

| Команда | Действие |
|---------|----------|
| `npm start` | Запустить приложение |
| `npm run dev` | Запустить с DevTools |
| `npm run build` | Собрать для Windows (NSIS + portable) |

---

## 🐛 Частые проблемы

**Приложение не запускается**
```bash
rm -rf node_modules && npm install && npm start
```

**SmartScreen блокирует установщик**  
Нажми «Подробнее → Всё равно запустить» — это ожидаемо для неподписанных сборок.

**VPN не подключается**  
Убедись, что антивирус не блокирует `xray.exe` и `wintun.dll`. Добавь папку приложения в исключения.

---

## 📄 Лицензия

MIT © SpinerNET

---

<div align="center">
  <sub>Built with Electron · Powered by Xray-core</sub>
</div>
