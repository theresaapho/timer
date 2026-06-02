const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Lưu trữ dữ liệu phòng có thể tuần tự hóa gửi đi
const rooms = {};

// BẢN ĐỒ BỘ NHỚ LƯU TRỮ TIMER ĐỘC LẬP (Sửa lỗi crash Maximum call stack size)
const activeIntervals = {};
const activeAutoPasses = {};

io.on('connection', (socket) => {
    let currentRoom = null;
    let userId = null;

    socket.on('join-room', ({ roomId, username, isHost }) => {
        userId = socket.id;
        currentRoom = roomId;
        socket.join(roomId);

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
                timeLeft: 0
            };
        }

        const hasHost = rooms[roomId].players.some(p => p.isHost);
        const playerIsHost = hasHost ? false : isHost;

        rooms[roomId].players.push({
            id: userId,
            name: username,
            isHost: playerIsHost,
            timeBank: 0 
        });

        io.to(roomId).emit('update-room', rooms[roomId]);
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
            room.status = 'playing';
            room.turnDuration = duration;
            room.activePlayerIndex = 0;
            room.players.forEach(p => p.timeBank = 0); 
            io.to(currentRoom).emit('game-started', room);
            startTurnTimer(currentRoom);
        }
    });

    function startTurnTimer(roomId) {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        // Dọn sạch các bộ đếm cũ an toàn từ bản đồ độc lập
        if (activeIntervals[roomId]) clearInterval(activeIntervals[roomId]);
        if (activeAutoPasses[roomId]) clearTimeout(activeAutoPasses[roomId]);

        const activePlayer = room.players[room.activePlayerIndex];
        const bonusTime = activePlayer.timeBank || 0;
        room.timeLeft = room.turnDuration + bonusTime;
        room.paused = false;

        io.to(roomId).emit('start-countdown', {
            activePlayerIndex: room.activePlayerIndex,
            duration: room.timeLeft,
            timeBank: bonusTime,
            paused: room.paused
        });

        activeIntervals[roomId] = setInterval(() => {
            if (!room.paused) {
                room.timeLeft--;
                
                io.to(roomId).emit('timer-tick', {
                    timeLeft: room.timeLeft,
                    paused: room.paused
                });

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

        if (room.syncNotification) {
            io.to(roomId).emit('time-out-alarm', { activePlayerName: activePlayer.name, sync: true });
        } else {
            io.to(activePlayer.id).emit('time-out-alarm', { activePlayerName: activePlayer.name, sync: false });
        }

        // Kích hoạt bộ đếm tự động chuyển lượt AFK an toàn
        activeAutoPasses[roomId] = setTimeout(() => {
            io.to(roomId).emit('close-alarm-overlay');
            activePlayer.timeBank = 0;
            nextTurn(roomId);
        }, 20000);
    }

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

            if (room.accumulateUnused) {
                const unusedTime = room.timeLeft;
                activePlayer.timeBank = Math.min(room.maxAccumulated, (activePlayer.timeBank || 0) + unusedTime);
            } else {
                activePlayer.timeBank = 0;
            }

            nextTurn(currentRoom);
        }
    });

    function nextTurn(roomId) {
        const room = rooms[roomId];
        if (!room) return;

        if (activeIntervals[roomId]) clearInterval(activeIntervals[roomId]);
        room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
        startTurnTimer(roomId);
    }

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
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at: http://localhost:${PORT}`);
});