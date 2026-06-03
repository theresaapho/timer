const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
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
                timeLeft: 0,
                autoSyncTohotopia: false
            };
        }

        const hasHost = rooms[roomId].players.some(p => p.isHost);
        const playerIsHost = hasHost ? false : isHost;

        rooms[roomId].players.push({
            id: userId,
            name: username,
            isHost: playerIsHost,
            timeBank: 0,
            totalTurnTime: 0,
            turnCount: 0,
            extensionsUsed: 0
        });

        io.to(roomId).emit('update-room', rooms[roomId]);

        // ĐỒNG BỘ LẬP TỨC CHO NGƯỜI CHƠI VÀO GIỮA TRẬN (FAST-FORWARD SYNC)
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
            room.players.forEach(p => {
                p.timeBank = 0;
                p.totalTurnTime = 0;
                p.turnCount = 0;
                p.extensionsUsed = 0;
            }); 
            io.to(currentRoom).emit('game-started', room);
            startTurnTimer(currentRoom);
        }
    });

    function startTurnTimer(roomId) {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        if (activeIntervals[roomId]) clearInterval(activeIntervals[roomId]);
        if (activeAutoPasses[roomId]) clearTimeout(activeAutoPasses[roomId]);

        const activePlayer = room.players[room.activePlayerIndex];
        const bonusTime = activePlayer.timeBank || 0;
        
        room.timeLeft = room.turnDuration + bonusTime;
        room.currentTurnMax = room.timeLeft;
        room.paused = false;

        io.to(roomId).emit('start-countdown', {
            activePlayerIndex: room.activePlayerIndex,
            duration: room.timeLeft,
            timeBank: bonusTime,
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

                if (room.timeLeft === 10 && !onDeckWarned && room.players.length > 1) {
                    onDeckWarned = true;
                    const nextPlayerIdx = (room.activePlayerIndex + 1) % room.players.length;
                    const nextPlayer = room.players[nextPlayerIdx];
                    io.to(nextPlayer.id).emit('on-deck-alert', activePlayer.name);
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
            nextTurn(roomId);
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

    socket.on('end-game', () => {
        const room = rooms[currentRoom];
        if (room && room.status === 'playing') {
            room.status = 'stats';
            if (activeIntervals[currentRoom]) clearInterval(activeIntervals[currentRoom]);
            if (activeAutoPasses[currentRoom]) clearTimeout(activeAutoPasses[currentRoom]);

            const stats = room.players.map(p => {
                const avg = p.turnCount > 0 ? Math.round(p.totalTurnTime / p.turnCount) : 0;
                return {
                    name: p.name,
                    avgTime: avg,
                    totalTime: p.totalTurnTime,
                    turns: p.turnCount
                };
            });

            io.to(currentRoom).emit('show-stats', stats);
        }
    });

    socket.on('leave-room', () => {
        socket.leave(currentRoom);
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
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at: http://localhost:${PORT}`);
});