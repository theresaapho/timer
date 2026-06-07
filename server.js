const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const JWT_SECRET = process.env.JWT_SECRET || 'timer_secret_key_9999';

app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public')));

// BẢN ĐỒ QUẢN LÝ NGƯỜI DÙNG ONLINE THỜI GIAN THỰC (UserId => SocketId & Status)
const onlineUsers = {}; 

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token.' });
        req.user = user;
        next();
    });
}

// ==========================================================================
// CÁC ĐƯỜNG DẪN API XÁC THỰC TÀI KHOẢN (AUTHENTICATION ENDPOINTS)
// ==========================================================================

app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Please fill in all fields.' });

    try {
        const userExist = await db.query('SELECT id FROM users WHERE username = $1 OR email = $2', [username.toLowerCase(), email.toLowerCase()]);
        if (userExist.rows.length > 0) return res.status(400).json({ error: 'Username or Email already exists.' });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        await db.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)',
            [username, email.toLowerCase(), passwordHash]
        );
        res.status(201).json({ success: true, message: 'Registration successful!' });
    } catch (err) {
        res.status(500).json({ error: 'Database error.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { loginKey, password } = req.body;
    if (!loginKey || !password) return res.status(400).json({ error: 'Please enter credentials.' });

    try {
        const userQuery = await db.query('SELECT * FROM users WHERE username = $1 OR email = $1', [loginKey.toLowerCase()]);
        if (userQuery.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials.' });

        const user = userQuery.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(400).json({ error: 'Invalid credentials.' });

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                avatar: user.avatar,
                background: user.background
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Database error.' });
    }
});

app.post('/api/verify-token', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(401).json({ error: 'No token provided.' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userQuery = await db.query('SELECT id, username, avatar, background FROM users WHERE id = $1', [decoded.id]);
        if (userQuery.rows.length === 0) return res.status(401).json({ error: 'User not found.' });
        res.json({ success: true, user: userQuery.rows[0] });
    } catch (err) {
        res.status(401).json({ error: 'Session expired.' });
    }
});

app.post('/api/user/update-profile', authenticateToken, async (req, res) => {
    const { username, avatar, background } = req.body;
    const userId = req.user.id;

    try {
        const userQuery = await db.query('SELECT username, username_updated_at FROM users WHERE id = $1', [userId]);
        if (userQuery.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

        const currentUser = userQuery.rows[0];
        let finalUsername = currentUser.username;

        if (username && username.trim().toLowerCase() !== currentUser.username.toLowerCase()) {
            const lastUpdated = new Date(currentUser.username_updated_at).getTime();
            const daysPassed = (Date.now() - lastUpdated) / (1000 * 60 * 60 * 24);

            if (daysPassed < 7) {
                const daysRemaining = Math.ceil(7 - daysPassed);
                return res.status(400).json({ error: `Please wait ${daysRemaining} more day(s) to change username.` });
            }

            const usernameExist = await db.query('SELECT id FROM users WHERE username = $1', [username.trim().toLowerCase()]);
            if (usernameExist.rows.length > 0) return res.status(400).json({ error: 'Username already taken.' });

            finalUsername = username.trim();
            await db.query('UPDATE users SET username = $1, username_updated_at = CURRENT_TIMESTAMP WHERE id = $2', [finalUsername, userId]);
        }

        await db.query('UPDATE users SET avatar = $1, background = $2 WHERE id = $3', [avatar, background, userId]);
        res.json({ success: true, user: { username: finalUsername, avatar, background } });
    } catch (err) {
        res.status(500).json({ error: 'Database error.' });
    }
});

// ==========================================================================
// CÁC ĐƯỜNG DẪN API BẠN BÈ (FRIENDS SYSTEM ENDPOINTS)
// ==========================================================================

app.post('/api/friends/add', authenticateToken, async (req, res) => {
    const { targetUsername } = req.body;
    const userId = req.user.id;

    if (!targetUsername) return res.status(400).json({ error: 'Please enter a username.' });

    try {
        const targetQuery = await db.query('SELECT id FROM users WHERE username = $1', [targetUsername.trim()]);
        if (targetQuery.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

        const targetId = targetQuery.rows[0].id;
        if (targetId === userId) return res.status(400).json({ error: 'You cannot add yourself.' });

        const friendExist = await db.query(
            'SELECT * FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
            [userId, targetId]
        );

        if (friendExist.rows.length > 0) {
            const relation = friendExist.rows[0];
            if (relation.status === 'accepted') return res.status(400).json({ error: 'You are already friends.' });
            return res.status(400).json({ error: 'Friend request is already pending.' });
        }

        await db.query('INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, \'pending\')', [userId, targetId]);
        res.json({ success: true, message: 'Friend request sent!' });
    } catch (err) {
        res.status(500).json({ error: 'Database error.' });
    }
});

app.get('/api/friends/list', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const friendsQuery = await db.query(
            `SELECT u.id, u.username, u.avatar, u.background 
             FROM friends f 
             JOIN users u ON (f.friend_id = u.id AND f.user_id = $1) OR (f.user_id = u.id AND f.friend_id = $1)
             WHERE f.status = 'accepted'`,
            [userId]
        );

        const pendingQuery = await db.query(
            `SELECT u.id, u.username, u.avatar 
             FROM friends f 
             JOIN users u ON f.user_id = u.id 
             WHERE f.friend_id = $1 AND f.status = 'pending'`,
            [userId]
        );

        const friendsList = friendsQuery.rows.map(friend => {
            const activeUser = onlineUsers[friend.id];
            return {
                ...friend,
                status: activeUser ? activeUser.status : 'offline'
            };
        });

        res.json({
            success: true,
            friends: friendsList,
            pendingRequests: pendingQuery.rows
        });
    } catch (err) {
        res.status(500).json({ error: 'Database error.' });
    }
});

app.post('/api/friends/respond', authenticateToken, async (req, res) => {
    const { requesterId, action } = req.body;
    const userId = req.user.id;

    try {
        if (action === 'accept') {
            await db.query(
                'UPDATE friends SET status = \'accepted\' WHERE user_id = $1 AND friend_id = $2 AND status = \'pending\'',
                [requesterId, userId]
            );
        } else {
            await db.query(
                'DELETE FROM friends WHERE user_id = $1 AND friend_id = $2 AND status = \'pending\'',
                [requesterId, userId]
            );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Database error.' });
    }
});

// ==========================================================================
// TÍNH NĂNG MỚI GIAI ĐOẠN 4: TRUY VẤN LỊCH SỬ ĐẤU (MATCH HISTORY API)
// ==========================================================================
app.get('/api/match-history', authenticateToken, async (req, res) => {
    const username = req.user.username;

    try {
        // Truy vấn 10 trận đấu gần nhất chứa tên của bạn trong chuỗi JSON bảng điểm
        const queryText = `
            SELECT id, room_code, room_name, played_at, scoreboard_json 
            FROM match_history 
            WHERE scoreboard_json LIKE $1 
            ORDER BY played_at DESC 
            LIMIT 10
        `;
        const result = await db.query(queryText, [`%\"name\":\"${username}\"%`]);
        
        // Chuyển đổi dữ liệu chuỗi JSON ngược về Object trước khi trả về
        const historyList = result.rows.map(row => ({
            id: row.id,
            roomCode: row.room_code,
            roomName: row.room_name,
            playedAt: row.played_at,
            scoreboard: JSON.parse(row.scoreboard_json)
        }));

        res.json({ success: true, history: historyList });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error.' });
    }
});

// ==========================================================================
// QUẢN LÝ LƯỢT CHƠI THỜI GIAN THỰC (SOCKET.IO REAL-TIME CONTROLLER)
// ==========================================================================
const rooms = {};
const activeIntervals = {};
const activeAutoPasses = {};

io.on('connection', (socket) => {
    let currentRoom = null;
    let userId = null;

    socket.on('authenticate', (token) => {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            userId = decoded.id;
            socket.userId = userId;

            onlineUsers[userId] = {
                socketId: socket.id,
                username: decoded.username,
                status: 'online'
            };

            io.emit('friend-status-changed', { userId: userId, status: 'online' });
        } catch (err) {
            socket.emit('auth-error', 'Session expired.');
        }
    });

    socket.on('join-room', ({ roomId, username, isHost }) => {
        userId = socket.id;
        currentRoom = roomId;
        socket.join(roomId);

        if (socket.userId && onlineUsers[socket.userId]) {
            onlineUsers[socket.userId].status = 'playing';
            io.emit('friend-status-changed', { userId: socket.userId, status: 'playing' });
        }

        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                activePlayerIndex: 0,
                turnDuration: 45,
                syncNotification: false,  
                soundEnabled: true,
                accumulateUnused: false,  
                maxAccumulated: 30,       
                status: 'lobby',
                paused: false,
                timeLeft: 0,
                autoSyncTohotopia: false,
                enableBotCompensation: false,
                botDelay: 2
            };
        }

        const hasHost = rooms[roomId].players.some(p => p.isHost);
        const playerIsHost = hasHost ? false : isHost;

        rooms[roomId].players.push({
            id: userId,
            dbId: socket.userId || null, 
            name: username,
            isHost: playerIsHost,
            isBot: false,
            timeBank: 0,
            totalTurnTime: 0,
            turnCount: 0,
            extensionsUsed: 0
        });

        io.to(roomId).emit('update-room', rooms[roomId]);

        if (rooms[roomId].status === 'playing') {
            socket.emit('game-started', rooms[roomId]);
            socket.emit('start-countdown', {
                activePlayerIndex: rooms[roomId].activePlayerIndex,
                duration: rooms[roomId].timeLeft, 
                timeBank: rooms[roomId].players[rooms[roomId].activePlayerIndex].timeBank || 0,
                paused: rooms[roomId].paused
            });
        }
    });

    socket.on('kick-player', (targetId) => {
        const room = rooms[currentRoom];
        if (room) {
            const requester = room.players.find(p => p.id === socket.id);
            if (requester && requester.isHost) {
                const targetPlayer = room.players.find(p => p.id === targetId);
                if (targetPlayer) {
                    room.players = room.players.filter(p => p.id !== targetId);
                    io.to(currentRoom).emit('update-room', room);
                    if (!targetPlayer.isBot) {
                        io.to(targetId).emit('kicked');
                    }
                }
            }
        }
    });

    socket.on('send-game-invite', ({ friendId, roomCode }) => {
        const friendSession = onlineUsers[friendId];
        if (friendSession && friendSession.status === 'online') {
            io.to(friendSession.socketId).emit('receive-game-invite', {
                senderName: onlineUsers[socket.userId] ? onlineUsers[socket.userId].username : 'A friend',
                roomCode: roomCode
            });
        }
    });

    socket.on('get-mini-profile', async (targetDbId) => {
        try {
            const userQuery = await db.query('SELECT username, avatar, background FROM users WHERE id = $1', [targetDbId]);
            if (userQuery.rows.length > 0) {
                socket.emit('mini-profile-data', userQuery.rows[0]);
            }
        } catch (e) {}
    });

    socket.on('add-bot', () => {
        const room = rooms[currentRoom];
        if (room && room.status === 'lobby') {
            const botCount = room.players.filter(p => p.isBot).length + 1;
            room.players.push({
                id: 'bot_' + Math.random().toString(36).substr(2, 9),
                name: `AI Bot ${botCount}`,
                isHost: false,
                isBot: true,
                timeBank: 0,
                totalTurnTime: 0,
                turnCount: 0,
                extensionsUsed: 0
            });
            io.to(currentRoom).emit('update-room', room);
        }
    });

    socket.on('set-sound', (enabled) => {
        if (rooms[currentRoom]) {
            rooms[currentRoom].soundEnabled = enabled;
            socket.to(currentRoom).emit('update-sound', enabled);
        }
    });

    socket.on('set-sync-notification', (enabled) => {
        if (rooms[currentRoom]) {
            rooms[currentRoom].syncNotification = enabled;
            socket.to(currentRoom).emit('update-sync-notification', enabled);
        }
    });

    socket.on('set-accumulate', ({ enabled, maxSec }) => {
        if (rooms[currentRoom]) {
            rooms[currentRoom].accumulateUnused = enabled;
            rooms[currentRoom].maxAccumulated = maxSec;
            socket.to(currentRoom).emit('update-accumulate', { enabled, maxSec });
        }
    });

    socket.on('set-auto-sync', (enabled) => {
        if (rooms[currentRoom]) {
            rooms[currentRoom].autoSyncTohotopia = enabled;
            socket.to(currentRoom).emit('update-auto-sync', enabled);
        }
    });

    socket.on('set-bot-compensation', ({ enabled, delaySec }) => {
        if (rooms[currentRoom]) {
            rooms[currentRoom].enableBotCompensation = enabled;
            rooms[currentRoom].botDelay = delaySec;
            socket.to(currentRoom).emit('update-bot-compensation', { enabled, delaySec });
        }
    });

    socket.on('reorder-players', (orderedIds) => {
        const room = rooms[currentRoom];
        if (room && room.status === 'lobby') {
            const newOrder = [];
            orderedIds.forEach(id => {
                const player = room.players.find(p => p.id === id);
                if (player) newOrder.push(player);
            });
            room.players = newOrder;
            io.to(currentRoom).emit('update-room', room);
        }
    });

    socket.on('start-game', (duration) => {
        const room = rooms[currentRoom];
        if (room) {
            const hasHuman = room.players.some(p => !p.isBot);
            if (!hasHuman) return;

            room.status = 'playing';
            room.turnDuration = duration;
            room.activePlayerIndex = 0;

            while (room.players[room.activePlayerIndex].isBot) {
                room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
            }

            room.players.forEach(p => {
                p.timeBank = 0;
                p.totalTurnTime = 0;
                p.turnCount = 0;
                p.extensionsUsed = 0;
            }); 
            io.to(currentRoom).emit('game-started', room);
            startTurnTimer(currentRoom, 0);
        }
    });

    function startTurnTimer(roomId, botCompensationTime = 0) {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        if (activeIntervals[roomId]) clearInterval(activeIntervals[roomId]);
        if (activeAutoPasses[roomId]) clearTimeout(activeAutoPasses[roomId]);

        const activePlayer = room.players[room.activePlayerIndex];
        const bonusTime = activePlayer.timeBank || 0;
        
        room.timeLeft = room.turnDuration + bonusTime + botCompensationTime;
        room.currentTurnMax = room.timeLeft;
        room.paused = false;

        io.to(roomId).emit('start-countdown', {
            activePlayerIndex: room.activePlayerIndex,
            duration: room.timeLeft,
            timeBank: bonusTime + botCompensationTime,
            paused: room.paused
        });

        let onDeckWarned = false;

        activeIntervals[roomId] = setInterval(() => {
            if (!room.paused) {
                room.timeLeft--;
                
                io.to(roomId).emit('timer-tick', {
                    timeLeft: room.timeLeft,
                    paused: room.paused
                });

                if (room.timeLeft === 10 && !onDeckWarned && room.players.filter(p => !p.isBot).length > 1) {
                    onDeckWarned = true;
                    
                    let nextPlayerIdx = room.activePlayerIndex;
                    do {
                        nextPlayerIdx = (nextPlayerIdx + 1) % room.players.length;
                    } while (room.players[nextPlayerIdx].isBot && nextPlayerIdx !== room.activePlayerIndex);

                    const nextPlayer = room.players[nextPlayerIdx];
                    if (nextPlayer.id !== activePlayer.id) {
                        io.to(nextPlayer.id).emit('on-deck-alert', activePlayer.name);
                    }
                }

                if (room.timeLeft <= 0) {
                    clearInterval(activeIntervals[roomId]);
                    triggerAlarm(roomId);
                }
            }
        }, 1000);
    }

    function triggerAlarm(roomId) {
        const room = rooms[roomId];
        if (!room) return;
        const activePlayer = room.players[room.activePlayerIndex];

        activePlayer.totalTurnTime += room.currentTurnMax;
        activePlayer.turnCount++;

        if (room.syncNotification) {
            io.to(roomId).emit('time-out-alarm', { activePlayerName: activePlayer.name, sync: true });
        } else {
            io.to(activePlayer.id).emit('time-out-alarm', { activePlayerName: activePlayer.name, sync: false });
        }

        activeAutoPasses[roomId] = setTimeout(() => {
            io.to(roomId).emit('close-alarm-overlay');
            activePlayer.timeBank = 0;
            executeNextTurnTransition(roomId);
        }, 20000);
    }

    socket.on('request-extension', () => {
        const room = rooms[currentRoom];
        if (room && room.status === 'playing' && !room.paused) {
            const activePlayer = room.players[room.activePlayerIndex];
            
            if (!activePlayer.extensionsUsed) activePlayer.extensionsUsed = 0;
            
            if (activePlayer.extensionsUsed < 2) {
                room.timeLeft += 15;
                room.currentTurnMax += 15;
                activePlayer.extensionsUsed++;

                io.to(currentRoom).emit('timer-tick', {
                    timeLeft: room.timeLeft,
                    paused: room.paused
                });
                socket.emit('extension-applied', activePlayer.extensionsUsed);
            }
        }
    });

    socket.on('toggle-pause', () => {
        const room = rooms[currentRoom];
        if (room && room.status === 'playing') {
            room.paused = !room.paused;
            io.to(currentRoom).emit('timer-tick', {
                timeLeft: room.timeLeft,
                paused: room.paused
            });
        }
    });

    socket.on('end-turn', () => {
        const room = rooms[currentRoom];
        if (room) {
            if (activeAutoPasses[currentRoom]) clearTimeout(activeAutoPasses[currentRoom]);
            const activePlayer = room.players[room.activePlayerIndex];

            const elapsed = room.currentTurnMax - room.timeLeft;
            activePlayer.totalTurnTime += elapsed;
            activePlayer.turnCount++;

            if (room.accumulateUnused) {
                const unusedTime = room.timeLeft;
                activePlayer.timeBank = Math.min(room.maxAccumulated, (activePlayer.timeBank || 0) + unusedTime);
            } else {
                activePlayer.timeBank = 0;
            }

            executeNextTurnTransition(currentRoom);
        }
    });

    function executeNextTurnTransition(roomId) {
        const room = rooms[roomId];
        if (!room) return;

        let nextIndex = room.activePlayerIndex;
        let skippedBotsCount = 0;

        do {
            nextIndex = (nextIndex + 1) % room.players.length;
            if (room.players[nextIndex].isBot) {
                skippedBotsCount++; 
            }
        } while (room.players[nextIndex].isBot && nextIndex !== room.activePlayerIndex);

        room.activePlayerIndex = nextIndex;

        let botCompensationTime = 0;
        if (room.enableBotCompensation && skippedBotsCount > 0) {
            botCompensationTime = skippedBotsCount * room.botDelay;
        }

        startTurnTimer(roomId, botCompensationTime);
    }

    // KHI KẾT THÚC TRẬN ĐẤU -> TỰ ĐỘNG NÉN BẢNG ĐIỂM VÀ LƯU VĨNH VIỄN VÀO POSTGRESQL
    socket.on('end-game', async () => {
        const room = rooms[currentRoom];
        if (room && room.status === 'playing') {
            room.status = 'stats';
            if (activeIntervals[currentRoom]) clearInterval(activeIntervals[currentRoom]);
            if (activeAutoPasses[currentRoom]) clearTimeout(activeAutoPasses[currentRoom]);

            const stats = room.players.filter(p => !p.isBot).map(p => {
                const avg = p.turnCount > 0 ? Math.round(p.totalTurnTime / p.turnCount) : 0;
                return {
                    name: p.name,
                    avgTime: avg,
                    totalTime: p.totalTurnTime,
                    turns: p.turnCount
                };
            });

            // Tiến hành ghi dữ liệu vào PostgreSQL vĩnh viễn
            try {
                const hostName = onlineUsers[socket.userId] ? onlineUsers[socket.userId].username : 'Unknown';
                const roomName = currentRoom === hostName.toUpperCase() ? `${hostName}'s Permanent Lobby` : `Temp Room ${currentRoom}`;
                const scoreboardJson = JSON.stringify(stats);

                await db.query(
                    'INSERT INTO match_history (room_code, room_name, scoreboard_json) VALUES ($1, $2, $3)',
                    [currentRoom, roomName, scoreboardJson]
                );
                console.log(`[Database] Saved match history for Room ${currentRoom}.`);
            } catch (err) {
                console.error("Error saving match history to DB:", err);
            }

            io.to(currentRoom).emit('show-stats', stats);
        }
    });

    socket.on('leave-room', () => {
        socket.leave(currentRoom);
        if (socket.userId && onlineUsers[socket.userId]) {
            onlineUsers[socket.userId].status = 'online';
            io.emit('friend-status-changed', { userId: socket.userId, status: 'online' });
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            const room = rooms[currentRoom];
            room.players = room.players.filter(p => p.id !== userId);

            if (room.players.length === 0) {
                if (activeIntervals[currentRoom]) clearInterval(activeIntervals[currentRoom]);
                if (activeAutoPasses[currentRoom]) clearTimeout(activeAutoPasses[currentRoom]);
                delete rooms[currentRoom];
            } else {
                if (!room.players.some(p => p.isHost)) {
                    room.players[0].isHost = true;
                }
                io.to(currentRoom).emit('update-room', room);
            }
        }

        if (socket.userId) {
            delete onlineUsers[socket.userId];
            io.emit('friend-status-changed', { userId: socket.userId, status: 'offline' });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at: http://localhost:${PORT}`);
});