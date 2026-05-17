# 川蜀麻将 · 血战到底

完整的四川麻将游戏，含单机和联机两种模式。

## 单机模式

直接打开 `index.html` 即可游玩，无需任何服务端。

```bash
# 用任何本地 web 服务器即可
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000
```

## 联机模式

需要先启动服务端，然后客户端通过浏览器访问服务端：

### 启动服务端

```bash
cd server
npm install      # 仅首次需要
npm start        # 启动服务器
```

服务端会同时提供：
- HTTP 静态文件服务（端口 3000，默认）
- WebSocket 游戏通信

### 玩家加入

所有玩家用浏览器访问 `http://<服务器 IP>:3000`：

1. 点击"联机对战"
2. 输入昵称
3. 一位玩家点击"创建房间"获得 6 位房间号
4. 其他玩家输入房间号点击"加入房间"
5. 房主点击"开始游戏"

不满 4 人时，空位会自动由 AI 补满。

### 自定义端口

```bash
PORT=8080 npm start
```

## 项目结构

```
sichuan-mahjong/
├── index.html              # 入口
├── styles.css              # 全部样式
├── tiles.js                # 牌组（前后端共享）
├── rules.js                # 规则引擎（前后端共享）
├── ai.js                   # 单机 AI
├── sound.js                # Web Audio 音效合成
├── game.js                 # 单机游戏状态机
├── ui.js                   # UI 渲染
├── online.js               # WebSocket 客户端
├── online-game.js          # 联机游戏控制器（连接 server 消息和 UI）
├── online-lobby.js         # 联机大厅 UI
└── server/                 # 服务端
    ├── server.js           # WebSocket 主服务
    ├── room.js             # 房间管理
    ├── game-engine.js      # 服务端权威游戏引擎
    ├── ai-server.js        # 服务端 AI（填充空位）
    └── package.json
```

## 联机协议（WebSocket / JSON）

### 客户端 → 服务端

| 消息类型 | 字段 | 说明 |
|---------|-----|-----|
| `create-room` | `name, options` | 创建房间 |
| `join-room` | `code, name` | 加入房间 |
| `reconnect` | `code, token` | 断线重连 |
| `start-game` | — | 房主开始游戏 |
| `choose-missing` | `suit` | 选择缺一门 |
| `discard` | `tile` | 出牌 |
| `reaction` | `action` | 响应他人弃牌：pass/peng/gang/hu |
| `angang` | `tile` | 暗杠 |
| `add-gang` | `tile` | 补杠 |
| `zimo` | — | 自摸胡 |
| `chat` | `text` | 聊天 |

### 服务端 → 客户端

| 消息类型 | 说明 |
|---------|-----|
| `room-joined` | 房间加入成功（含 token） |
| `player-joined/left/offline/online` | 其他玩家状态变化 |
| `game-started` | 游戏开始（含初始状态） |
| `missing-chosen` / `all-missings-chosen` | 定缺相关 |
| `your-draw` | 你摸牌（私密，含牌内容） |
| `turn-changed` | 他人摸牌（不含牌内容） |
| `discard` | 任意玩家打牌 |
| `reaction-prompt` | 提示你有可以执行的反应 |
| `peng` / `gang` | 碰/杠通知 |
| `hu` | 胡牌通知（含牌型分数） |
| `round-end` / `game-over` | 本局/整盘结束 |

### 安全设计

- 所有规则验证（胡牌、缺一门、可碰可杠）都在**服务端**执行，客户端只是渲染
- 每个玩家有独立的 token，重连用 token 验证
- 服务端只发给该玩家"私密"信息（如自己的手牌），不广播
- 8 秒反应超时，自动 pass，避免一人卡住整局
- 服务端定期清理超时房间（60 分钟不活动 / 房间被遗弃）

## 已知限制 & 下一步

- 单机服务器（Node 单进程，适合 1000 同时玩家以内）
- 没有持久化（重启服务器后房间消失）
- 没有账户系统（昵称临时）

后续可加：Redis 跨进程房间、MySQL 战绩存档、防作弊水印、实名认证、房卡支付等。
